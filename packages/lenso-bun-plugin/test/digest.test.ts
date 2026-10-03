import { expect, test } from "bun:test";
import { definePlugin } from "../src/authoring.ts";
import { Profile, DESCRIPTOR_DIGEST } from "./fixtures/generated/profile.ts";

test("source-first declarations retain the generated Capability digest for Host admission", () => {
  const definition = definePlugin({
    provides: [Profile],
    create: () => ({
      async corpus_round_trip() { return { ok: true as const, value: { value: {} } }; },
      async round_trip() { return { ok: true as const, value: { accepted: true } }; },
    }),
  });
  expect(definition.providers[0]!.descriptor.descriptor_digest).toBe(DESCRIPTOR_DIGEST);
  expect(() => definePlugin({
    provides: [{
      ...Profile,
      descriptor: { ...Profile.descriptor, descriptor_digest: "sha256:" + "0".repeat(64) },
    }],
    create: () => ({
      async corpus_round_trip() { return { ok: true as const, value: { value: {} } }; },
      async round_trip() { return { ok: true as const, value: { accepted: true } }; },
    }),
  })).toThrow("conflicting Descriptor digests");
});
