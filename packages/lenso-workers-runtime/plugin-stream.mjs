const failure = (kind, detail) => ({ kind: "runtime", failure: { kind, detail } });
const bytes = value => new TextEncoder().encode(JSON.stringify(value)).byteLength;

/**
 * One pull-owned session. A physical receipt plus settled actions release its
 * lease. A rejected/unavailable receipt fences the owning generation instead.
 */
export function createPluginStreamSession(binding, context, {
  maxMessageBytes, onRelease, onUnconfirmed,
}) {
  if (!binding.closed || typeof binding.closed.then !== "function") {
    throw new Error("workers-js Stream requires generated physical cleanup receipt");
  }
  let resolveClosed, rejectClosed;
  const closed = new Promise((resolve, reject) => {
    resolveClosed = resolve; rejectClosed = reject;
  });
  closed.catch(() => {});
  let physical = false, released = false, uncertain = false, cancelled = false;
  let sendClosed = false, receiving = false, sending = false, closingSend = false;
  let actions = 0;
  const unconfirmed = error => {
    if (uncertain) return;
    uncertain = true;
    onUnconfirmed();
    rejectClosed(error);
  };
  const release = () => {
    if (!physical || actions || uncertain || released) return;
    released = true;
    context.signal?.removeEventListener("abort", abort);
    onRelease();
    resolveClosed();
  };
  const cancelledOutcome = () => failure("cancelled", "Host Stream scope cancelled");
  const ended = () => cancelled || context.cancelled || released || uncertain;

  function cancel() {
    if (cancelled) return closed;
    cancelled = true;
    actions++;
    try {
      // The Host context supplied here owns the controller and its cancellation.
      context.abort?.();
      Promise.resolve(binding.cancel()).then(
        () => { actions--; release(); },
        error => { actions--; unconfirmed(error); },
      );
    } catch (error) {
      actions--;
      unconfirmed(error);
    }
    return closed;
  }
  function abort() { void cancel(); }
  context.signal?.addEventListener("abort", abort, { once: true });
  Promise.resolve(binding.closed).then(
    () => { physical = true; release(); },
    error => unconfirmed(error),
  );
  if (context.signal?.aborted || context.cancelled) abort();

  const session = {
    closed,
    cancel,
    async send(message) {
      if (ended()) return cancelled ? cancelledOutcome() : failure("admission_closed", "Stream closed");
      if (sending || closingSend) return failure("resource_exhausted", "overlapping Stream send");
      if (sendClosed) return failure("protocol_violation", "Stream send half is closed");
      try {
        if (bytes(message) > maxMessageBytes) return failure("resource_exhausted", "Stream message exceeds bound");
      } catch {
        return failure("protocol_violation", "Stream message must be a portable JSON value");
      }
      sending = true; actions++;
      try {
        const result = await binding.send(message);
        return cancelled || context.cancelled ? cancelledOutcome() : result;
      } catch (error) {
        void cancel();
        return failure("plugin_failure", String(error));
      } finally {
        sending = false; actions--; release();
      }
    },
    async receive() {
      if (ended()) return cancelled ? cancelledOutcome() : failure("admission_closed", "Stream closed");
      if (receiving) return failure("resource_exhausted", "overlapping Stream receive");
      receiving = true; actions++;
      try {
        const result = await binding.receive();
        if (cancelled || context.cancelled) return cancelledOutcome();
        if (result.kind === "message") {
          if (bytes(result.value) > maxMessageBytes) {
            void cancel();
            return failure("resource_exhausted", "Stream message exceeds bound");
          }
          return result;
        }
        if (result.kind === "terminal_success" || result.kind === "terminal_domain") {
          // Physical iterator completion is required before publishing terminal.
          await binding.closed;
          return result;
        }
        if (result.kind === "runtime") void cancel();
        return result;
      } catch (error) {
        if (cancelled || context.cancelled) return cancelledOutcome();
        void cancel();
        return failure("plugin_failure", String(error));
      } finally {
        receiving = false; actions--; release();
      }
    },
    async closeSend() {
      if (ended()) return cancelled ? cancelledOutcome() : failure("admission_closed", "Stream closed");
      if (closingSend || sending) return failure("resource_exhausted", "overlapping Stream send/close");
      if (sendClosed) return failure("protocol_violation", "Stream send half already closed");
      closingSend = true; actions++;
      try {
        const result = await binding.closeSend();
        if (result.kind === "accepted") sendClosed = true;
        return cancelled || context.cancelled ? cancelledOutcome() : result;
      } catch (error) {
        void cancel();
        return failure("plugin_failure", String(error));
      } finally {
        closingSend = false; actions--; release();
      }
    },
  };
  return session;
}
