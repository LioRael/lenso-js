import type { StreamSession, StreamEvent } from "./index.js";

/**
 * Target-packaging lowering for generated server-output sessions. There is no
 * prefetch or queue: each receive performs one next(). closed only fulfills
 * after iterator termination, including asynchronous generator finally work.
 */
export function lowerProviderStreamWithCleanup<Message, DomainError>(
  stream: StreamSession<Message, DomainError> | AsyncIterable<Message>,
  inputError: () => Error,
): StreamSession<Message, DomainError> {
  if (!(Symbol.asyncIterator in stream)) return stream;
  const iterator = stream[Symbol.asyncIterator]();
  let resolveClosed!: () => void, rejectClosed!: (error: unknown) => void;
  const closed = new Promise<void>((resolve, reject) => {
    resolveClosed = resolve; rejectClosed = reject;
  });
  // Observe failure immediately; the owning adapter still observes the original.
  void closed.catch(() => undefined);
  let cancelled = false, finished = false, receiving = false;
  let cleanup: Promise<void> | undefined;
  const cancel = (): Promise<void> => {
    if (cleanup) return cleanup;
    cancelled = true;
    cleanup = (async () => {
      if (finished) return;
      if (!iterator.return) throw new Error("stream_cleanup_unconfirmed: iterator has no return");
      let result = await iterator.return();
      // finally blocks can yield too. Bound retained cleanup work and refuse
      // a clean receipt when the iterator still has not terminated.
      for (let turns = 0; !result.done && turns < 16; turns++) result = await iterator.next();
      if (!result.done) throw new Error("stream_cleanup_unconfirmed: cleanup yielded beyond bound");
      finished = true;
      resolveClosed();
    })().catch(error => { rejectClosed(error); throw error; });
    void cleanup.catch(() => undefined);
    return cleanup;
  };
  return {
    ...(iterator.return ? { closed } : {}),
    async send() { throw inputError(); },
    async receive(): Promise<StreamEvent<Message, DomainError>> {
      if (receiving) throw new Error("overlapping Stream receive");
      if (cancelled) {
        await closed;
        throw new Error("stream_cancelled");
      }
      receiving = true;
      try {
        const result = await iterator.next();
        if (cancelled) {
          await closed;
          throw new Error("stream_cancelled");
        }
        if (result.done) {
          finished = true;
          resolveClosed();
          return { kind: "terminal", outcome: { ok: true } };
        }
        return { kind: "message", message: result.value };
      } catch (error) {
        if (!cancelled) await cancel().catch(() => undefined);
        throw error;
      } finally {
        receiving = false;
      }
    },
    async closeSend() {},
    cancel,
  };
}
