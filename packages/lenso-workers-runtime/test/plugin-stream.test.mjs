import test from "node:test";
import assert from "node:assert/strict";
import { prepareWorkersPlugin } from "../plugin.mjs";

const descriptor = {
  capability_id: "example.stream@1", descriptor_version: "1.0.0",
  descriptor_digest: "sha256:" + "a".repeat(64),
  operations: ["read"], stream_operations: ["read"], event_operations: [],
};
const context = () => ({
  requestId: "1", cancelled: false,
  signal: new AbortController().signal, remainingTimeoutMs: () => 1000,
});
const options = extra => ({ providedEndpoints: [descriptor], lifecycle: context(), ...extra });
const definition = binding => ({
  providers: [{
    kind: "lenso.provider", descriptor, streamLifecycleProfile: "lenso.provider-stream-cleanup@1",
    bind: () => ({ descriptor, invokeRequest: async () => {}, openStream: async () => ({ kind: "opened", stream: binding }) }),
  }],
  maxConcurrentRequests: 1,
});

test("uncertain physical Stream cleanup fences admission and never permits stop", async () => {
  let reject;
  const closed = new Promise((_resolve, fail) => { reject = fail; });
  const binding = {
    closed, send: async () => ({ kind: "accepted" }), closeSend: async () => ({ kind: "accepted" }),
    receive: async () => ({ kind: "peer_half_closed" }),
    cancel() { reject(new Error("async cleanup failed")); },
  };
  const instance = await prepareWorkersPlugin(definition(binding), options());
  const result = await instance.openStream(descriptor.capability_id, "read", context(), {});
  assert.equal(result.kind, "opened");
  await assert.rejects(result.stream.cancel(), /async cleanup failed/);
  assert.equal((await instance.openStream(descriptor.capability_id, "read", context(), {})).failure.kind, "admission_closed");
  await assert.rejects(instance.stop(context()), /physically settled/);
});

test("unqualified Stream/Event metadata fails before create", async () => {
  let created = 0;
  const base = definition({});
  base.create = () => { created++; return {}; };
  delete base.providers[0].streamLifecycleProfile;
  await assert.rejects(prepareWorkersPlugin(base, options()), /generated physical cleanup target lowering/);
  base.providers[0].descriptor = { ...descriptor, stream_operations: [], event_operations: ["read"] };
  await assert.rejects(prepareWorkersPlugin(base, options()), /Event is unsupported/);
  assert.equal(created, 0);
});

test("session bound rejects a second open until physical receipt settles", async () => {
  let resolve;
  const closed = new Promise(done => { resolve = done; });
  const binding = {
    closed, send: async () => ({ kind: "accepted" }), closeSend: async () => ({ kind: "accepted" }),
    receive: async () => ({ kind: "message", value: "oversized" }),
    cancel() { resolve(); },
  };
  const instance = await prepareWorkersPlugin(definition(binding), options({ maxStreamMessageBytes: 2 }));
  const result = await instance.openStream(descriptor.capability_id, "read", context(), {});
  assert.equal((await instance.openStream(descriptor.capability_id, "read", context(), {})).failure.kind, "resource_exhausted");
  assert.equal((await result.stream.receive()).failure.kind, "resource_exhausted");
  await result.stream.closed;
  await instance.stop(context());
});
