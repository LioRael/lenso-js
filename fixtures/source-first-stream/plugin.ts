import { configuration, definePlugin } from "@lenso/bun-plugin/authoring";
import { Profile, type InvocationContext } from "../../packages/lenso-bun-plugin/test/fixtures/generated/profile.ts";
import { Conversation, type ChatRequest } from "../../packages/lenso-bun-plugin/test/fixtures/generated/conversation.ts";

type Context = InvocationContext & { readonly signal?: AbortSignal };

export default definePlugin({
  config: configuration(
    { type: "object", additionalProperties: false, properties: { prefix: { type: "string" } }, required: ["prefix"] },
    value => {
      if (typeof (value as { prefix?: unknown })?.prefix !== "string") throw new Error("prefix must be a string");
      return value as { prefix: string };
    },
  ),
  dependencies: { upstream: Conversation.optional("upstream") },
  provides: [Profile, Conversation],
  maxConcurrentRequests: 2,
  create({ config, dependencies }) {
    let produced = 0, cleaned = 0;
    return {
      async corpus_round_trip() {
        return { ok: true as const, value: { value: { produced, cleaned } } };
      },
      async round_trip() { return { ok: true as const, value: { accepted: true } }; },
      chat(context: Context, request: ChatRequest) {
        if (request.room === "closed") {
          return { ok: false as const, error: { kind: "domain" as const, error: "room_closed" as const } };
        }
        return (async function* () {
          let upstream;
          try {
            if (dependencies.upstream) {
              const result = await dependencies.upstream.chat(request, context);
              if (!result.ok) throw new Error("upstream unavailable");
              upstream = result.value;
              while (true) {
                const event = await upstream.receive();
                if (event.kind === "terminal") break;
                if (event.kind === "message") {
                  produced++;
                  yield { text: `${config.prefix}: ${event.message.text}` };
                }
              }
            } else {
              for (let index = 0; index < 3; index++) {
                if (request.room === "blocked" && index === 1) {
                  if (!context.signal) throw new Error("Stream Host must supply cancellation signal");
                  await new Promise<void>(resolve => {
                    if (context.signal!.aborted) resolve();
                    else context.signal!.addEventListener("abort", () => resolve(), { once: true });
                  });
                  if (context.cancelled) return;
                }
                produced++;
                yield { text: `${config.prefix}: ${index}` };
              }
            }
          } finally {
            if (upstream) await upstream.cancel();
            // Real asynchronous, event-owned cleanup on both runtimes.
            await new Promise(resolve => setTimeout(resolve, 5));
            cleaned++;
          }
        })();
      },
    };
  },
});
