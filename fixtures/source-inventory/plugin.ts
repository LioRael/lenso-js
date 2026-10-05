import { configuration, definePlugin } from "@lenso/bun-plugin/authoring";
import { Profile, type InvocationContext, type CorpusRoundTripRequest, type RoundTripRequest } from "../../packages/lenso-bun-plugin/test/fixtures/generated/profile.ts";

// Profile is an existing generated Capability. No descriptor or codec is
// authored here. The optional named dependency becomes a typed ProfileClient.
export const greeting = definePlugin({
  metadata: { pluginId: "example.greeting", rootSlot: "tools" },
  config: configuration(
    {
      type: "object", additionalProperties: false,
      properties: { prefix: { type: "string" } }, required: ["prefix"],
    },
    (value) => {
      const config = value as { prefix?: unknown };
      if (typeof config?.prefix !== "string") throw new Error("prefix must be a string");
      return { prefix: config.prefix };
    },
  ),
  dependencies: { upstream: Profile.optional("upstream") },
  provides: [Profile],
  maxConcurrentRequests: 2,
  create({ config, dependencies }) {
    let calls = 0;
    return {
      async corpus_round_trip(context: InvocationContext, request: CorpusRoundTripRequest) {
        calls++;
        const upstream = dependencies.upstream
          ? await dependencies.upstream.corpus_round_trip(request, context) : undefined;
        if (upstream && !upstream.ok) return upstream;
        return {
          ok: true as const,
          value: { value: {
            message: `hello ${config.prefix}`,
            calls,
            input: request.value,
            ...(upstream?.ok ? { upstream: upstream.value.value } : {}),
          } },
        };
      },
      async round_trip(_context: InvocationContext, _request: RoundTripRequest) {
        return { ok: true as const, value: { accepted: true } };
      },
    };
  },
});

// A second available Plugin is deliberately not selected in runtime tests.
export const unused = definePlugin({
  metadata: { pluginId: "example.unused", releaseVersion: "2.0.0", rootSlot: "tools" },
  provides: [],
  create() { throw new Error("unselected Plugin must not start"); },
});

// Ordinary language helpers remain language modules.
export function helper(value: string) { return value.toUpperCase(); }
