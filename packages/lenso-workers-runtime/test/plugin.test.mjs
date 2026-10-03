import test from "node:test";
import assert from "node:assert/strict";
import { prepareWorkersRequestPlugin } from "../plugin.mjs";

const descriptor = {
  capability_id: "example.echo@1", descriptor_version: "1.0.0",
  descriptor_digest: "sha256:" + "a".repeat(64),
  operations: ["echo"], stream_operations: [], event_operations: [],
};
const context = () => ({
  requestId: "1", cancelled: false,
  signal: new AbortController().signal, remainingTimeoutMs: () => 1000,
});
const definition = (invokeRequest, extra = {}) => ({
  providers: [{ kind: "lenso.provider", descriptor, bind: () => ({ descriptor, invokeRequest }) }],
  maxConcurrentRequests: 1, ...extra,
});
const options = () => ({ providedEndpoints: [descriptor], lifecycle: context() });

test("Request projection forwards the exact Host-bound dependency context", async () => {
  let received;
  const plugin = definition(async (_op, call, payload, instance) => instance.client(call, payload), {
    dependencies: { store: {
      kind: "lenso.dependency", id: "upstream", cardinality: "one",
      contract: { descriptor, createClient: invoke => (call, value) => invoke("echo", call, value) },
    } },
    create: ({ dependencies }) => ({ client: dependencies.store }),
  });
  const instance = await prepareWorkersRequestPlugin(plugin, {
    ...options(), dependencies: { upstream: [{
      providerInstance: "source-a", descriptor,
      invokeRequest: async (op, call, value) => { received = [op, call, value]; return { kind: "domain", value: "denied" }; },
    }] },
  });
  const call = { ...context(), callerInstance: "consumer", extensions: { grant: "host-owned" } };
  assert.deepEqual(await instance.invokeRequest(descriptor.capability_id, "echo", call, 7), { kind: "domain", value: "denied" });
  assert.deepEqual(received, ["echo", call, 7]);
  assert.equal(received[1], call);
  await instance.stop(context());
});

test("preparation rejects target/endpoint/binding mismatch before construction", async () => {
  let created = 0;
  const base = definition(async () => ({ kind: "success", value: 1 }), { create: () => { created++; return {}; } });
  await assert.rejects(prepareWorkersRequestPlugin(base, { ...options(), providedEndpoints: [] }), /incomplete/);
  await assert.rejects(prepareWorkersRequestPlugin(base, { ...options(), dependencies: { ambient: [] } }), /undeclared/);
  await assert.rejects(prepareWorkersRequestPlugin(base, { ...options(), providedEndpoints: [{ ...descriptor, descriptor_version: "2" }] }), /mismatch/);
  const stream = { ...descriptor, stream_operations: ["echo"] };
  await assert.rejects(prepareWorkersRequestPlugin({ ...base, providers: [{ ...base.providers[0], descriptor: stream }] }, { ...options(), providedEndpoints: [stream] }), /Request slice rejects/);
  assert.equal(created, 0);
});

test("cancellation retains physical capacity and prevents premature stop", async () => {
  let finish, stopped = 0;
  const plugin = definition(() => new Promise(resolve => { finish = resolve; }), { stop() { stopped++; } });
  const instance = await prepareWorkersRequestPlugin(plugin, options());
  const call = context();
  const pending = instance.invokeRequest(descriptor.capability_id, "echo", call, {});
  call.cancelled = true;
  assert.equal((await instance.invokeRequest(descriptor.capability_id, "echo", context(), {})).failure.kind, "resource_exhausted");
  await assert.rejects(instance.stop(context()), /physically settled/);
  finish({ kind: "success", value: "late" });
  assert.equal((await pending).failure.kind, "cancelled");
  await instance.stop(context());
  assert.equal(stopped, 1);
  await assert.rejects(instance.stop(context()), /more than once/);
  assert.equal((await instance.invokeRequest(descriptor.capability_id, "echo", context(), {})).failure.kind, "admission_closed");
});

test("binder failure cleans the complete instance before leaving preparation", async () => {
  let stopped = 0;
  const plugin = definition(async () => {}, { create: () => ({}), stop() { stopped++; } });
  plugin.providers[0].bind = () => ({ descriptor: { ...descriptor, descriptor_version: "2" } });
  await assert.rejects(prepareWorkersRequestPlugin(plugin, options()), /binder mismatch/);
  assert.equal(stopped, 1);
});

test("generated split Descriptor digest is checked for dependency admission", async () => {
  const withoutDigest = { ...descriptor };
  delete withoutDigest.descriptor_digest;
  let created = 0;
  const plugin = definition(async () => ({ kind: "success", value: 1 }), {
    dependencies: { upstream: {
      kind: "lenso.dependency", cardinality: "optional",
      contract: {
        descriptor: withoutDigest, descriptor_digest: descriptor.descriptor_digest,
        createClient: invoke => invoke,
      },
    } },
    create() { created++; return {}; },
  });
  await assert.rejects(prepareWorkersRequestPlugin(plugin, {
    ...options(), dependencies: { upstream: [{
      providerInstance: "source", descriptor: { ...descriptor, descriptor_digest: "sha256:" + "b".repeat(64) },
      invokeRequest: async () => ({ kind: "success", value: 1 }),
    }] },
  }), /route mismatch/);
  assert.equal(created, 0);
  const prepared = await prepareWorkersRequestPlugin(plugin, {
    ...options(), dependencies: { upstream: [{
      providerInstance: "source", descriptor, invokeRequest: async () => ({ kind: "success", value: 1 }),
    }] },
  });
  assert.equal(created, 1);
  await prepared.stop(context());
});
