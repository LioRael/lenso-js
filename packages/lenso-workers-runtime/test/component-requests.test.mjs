import assert from "node:assert/strict";
import test from "node:test";
import { createWorkersComponentRequestAdapter } from "../component-requests.mjs";

const CAPABILITY = "lenso.http.endpoint@1";
const DESCRIPTOR_DIGEST = "sha256:701deedf705cb1a3b2f35fcae72f20ae85d46c6da6a008405a519018bbcdd3fe";
const coreModule = new WebAssembly.Module(Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0]));

function plan() {
  return {
    schema_version: 4,
    terminal_policy: { kind: "required_path" },
    execution_lanes: [{ id: "main" }],
    capability_bindings: [],
    plugin_instances: [{
      authoring_version: 1,
      runtime_profile: "lenso.wasm-component@1",
      instance_key: "endpoint",
      package_id: "example.endpoint",
      entrypoint: "plugin",
      configuration: "{}",
      provided_capabilities: [{
        capability_id: CAPABILITY,
        descriptor_version: "1.1.0",
        operations: ["describe", "handle"],
        operation_kinds: {},
        default_admission: null,
        operation_admissions: {},
        event_admission: null,
        cross_lane_transfer: false,
      }],
      required_capabilities: [],
      required_target_capabilities: ["request", "wasm-component", "workers"],
      execution_class: "lenso.wasm-component@1",
      package_revision: "sha256:example",
      restart_policy: {
        mode: "never",
        max_attempts: 0,
        window: { secs: 0, nanos: 0 },
        backoff: { secs: 0, nanos: 0 },
        jitter: { secs: 0, nanos: 0 },
        stability: { secs: 0, nanos: 0 },
      },
      criticality: "non_critical",
      execution_lane: "main",
    }],
  };
}

function guest(description) {
  let created = 0;
  return {
    instantiate(getCoreModule, imports) {
      assert.equal(getCoreModule("guest.core.wasm"), coreModule);
      assert.deepEqual(imports, {});
      created++;
      return {
        describe: () => JSON.stringify(description),
        invoke: (_capability, operation, value) => JSON.stringify(`${operation}:${value}`),
      };
    },
    get created() { return created; },
  };
}

test("selected request-only Component is checked before readiness and gets a fresh Guest per invoke", () => {
  const loader = guest({
    abi: "lenso.json-request@1",
    capabilities: [{
      capability_id: CAPABILITY,
      descriptor_version: "1.1.0",
      request_operations: ["describe", "handle"],
    }],
  });
  const adapter = createWorkersComponentRequestAdapter({
    plan: plan(), instanceKey: "endpoint", coreModule, instantiate: loader.instantiate,
  });
  assert.equal(loader.created, 1);
  assert.equal(adapter.invoke(CAPABILITY, "handle", "{}"), '"handle:{}"');
  assert.equal(adapter.invoke(CAPABILITY, "describe", "{}"), '"describe:{}"');
  assert.equal(loader.created, 3);
  assert.throws(() => adapter.invoke(CAPABILITY, "stream", "{}"), /not selected/);
});

test("authoring V2 requires a trusted exact Descriptor digest and matches the Guest", () => {
  const selected = plan();
  selected.plugin_instances[0].authoring_version = 2;
  const loader = guest({
    abi: "lenso.json-request@1",
    capabilities: [{
      capability_id: CAPABILITY,
      descriptor_version: "1.1.0",
      descriptor_digest: DESCRIPTOR_DIGEST,
      request_operations: ["describe", "handle"],
    }],
  });
  const adapter = createWorkersComponentRequestAdapter({
    plan: selected, instanceKey: "endpoint", coreModule,
    instantiate: loader.instantiate,
    expectedDescriptorDigests: { [CAPABILITY]: DESCRIPTOR_DIGEST },
  });
  assert.equal(loader.created, 1);
  assert.equal(adapter.invoke(CAPABILITY, "handle", "{}"), '"handle:{}"');
});

test("authoring V2 rejects missing, unexpected or malformed trusted digest before Guest creation", () => {
  const selected = plan();
  selected.plugin_instances[0].authoring_version = 2;
  const loader = guest({});
  for (const [name, expectedDescriptorDigests] of [
    ["missing", undefined],
    ["empty", {}],
    ["extra", { [CAPABILITY]: DESCRIPTOR_DIGEST, "other.capability@1": DESCRIPTOR_DIGEST }],
    ["malformed", { [CAPABILITY]: "sha256:wrong" }],
    ["uppercase", { [CAPABILITY]: DESCRIPTOR_DIGEST.toUpperCase() }],
  ]) {
    assert.throws(() => createWorkersComponentRequestAdapter({
      plan: selected, instanceKey: "endpoint", coreModule,
      instantiate: loader.instantiate, expectedDescriptorDigests,
    }), /Descriptor digest/, name);
  }
  assert.equal(loader.created, 0);
});

test("authoring V2 rejects a Guest digest not matching the trusted Host input", () => {
  const selected = plan();
  selected.plugin_instances[0].authoring_version = 2;
  for (const capability of [
    { capability_id: CAPABILITY, descriptor_version: "1.1.0", request_operations: ["describe", "handle"] },
    { capability_id: CAPABILITY, descriptor_version: "1.1.0", descriptor_digest: `sha256:${"a".repeat(64)}`, request_operations: ["describe", "handle"] },
    { capability_id: CAPABILITY, descriptor_version: "1.1.0", descriptor_digest: DESCRIPTOR_DIGEST, request_operations: ["describe", "handle"], unexpected: true },
  ]) {
    const loader = guest({ abi: "lenso.json-request@1", capabilities: [capability] });
    assert.throws(() => createWorkersComponentRequestAdapter({
      plan: selected, instanceKey: "endpoint", coreModule,
      instantiate: loader.instantiate,
      expectedDescriptorDigests: { [CAPABILITY]: DESCRIPTOR_DIGEST },
    }), /unexpected shape|descriptor differs/);
  }
});

test("authoring V1 keeps the no-digest descriptor shape", () => {
  const legacy = guest({
    abi: "lenso.json-request@1",
    capabilities: [{
      capability_id: CAPABILITY, descriptor_version: "1.1.0",
      descriptor_digest: DESCRIPTOR_DIGEST,
      request_operations: ["describe", "handle"],
    }],
  });
  assert.throws(() => createWorkersComponentRequestAdapter({
    plan: plan(), instanceKey: "endpoint", coreModule, instantiate: legacy.instantiate,
  }), /unexpected shape/);
  assert.throws(() => createWorkersComponentRequestAdapter({
    plan: plan(), instanceKey: "endpoint", coreModule, instantiate: legacy.instantiate,
    expectedDescriptorDigests: { [CAPABILITY]: DESCRIPTOR_DIGEST },
  }), /authoring V1/);
});

test("unsupported Plan closure and interaction kinds fail before Guest instantiation", () => {
  const loader = guest({});
  for (const [name, change, error] of [
    ["Host import", (value) => value.plugin_instances[0].required_capabilities.push({}), /Host imports/],
    ["stream", (value) => value.plugin_instances[0].provided_capabilities[0].operation_kinds.handle = "stream", /Request endpoints/],
    ["event", (value) => value.plugin_instances[0].provided_capabilities[0].operation_kinds.handle = "event", /Request endpoints/],
    ["WebSocket", (value) => value.plugin_instances[0].required_target_capabilities.push("websocket"), /exactly request/],
    ["egress binding", (value) => value.capability_bindings.push({}), /Capability bindings/],
    ["native fallback", (value) => value.plugin_instances[0].execution_class = "lenso.native-rust@1", /request-only Component/],
    ["second Instance", (value) => value.plugin_instances.push({}), /exactly one selected Instance/],
    ["restart", (value) => value.plugin_instances[0].restart_policy.mode = "on_failure", /Kernel supervision/],
    ["missing package revision", (value) => value.plugin_instances[0].package_revision = "", /exact package identity/],
  ]) {
    const candidate = plan();
    change(candidate);
    assert.throws(() => createWorkersComponentRequestAdapter({
      plan: candidate, instanceKey: "endpoint", coreModule, instantiate: loader.instantiate,
    }), error, name);
  }
  assert.equal(loader.created, 0);
});

test("Guest descriptor and core imports are rejected before request admission", () => {
  const mismatch = guest({ abi: "lenso.json-request@1", capabilities: [] });
  assert.throws(() => createWorkersComponentRequestAdapter({
    plan: plan(), instanceKey: "endpoint", coreModule, instantiate: mismatch.instantiate,
  }), /descriptor differs/);
  const importedCore = new WebAssembly.Module(Uint8Array.from([
    0, 97, 115, 109, 1, 0, 0, 0,
    1, 4, 1, 96, 0, 0,
    2, 7, 1, 1, 120, 1, 121, 0, 0,
  ]));
  const loader = guest({});
  assert.throws(() => createWorkersComponentRequestAdapter({
    plan: plan(), instanceKey: "endpoint", coreModule: importedCore,
    instantiate: loader.instantiate,
  }), /import-free/);
  assert.equal(loader.created, 0);
});

test("endpoint admission flags must have exact unsupported values before Guest construction", () => {
  const loader = guest({});
  for (const [name, change] of [
    ["default admission omitted", (endpoint) => { delete endpoint.default_admission; }],
    ["default admission undefined", (endpoint) => { endpoint.default_admission = undefined; }],
    ["event admission omitted", (endpoint) => { delete endpoint.event_admission; }],
    ["event admission undefined", (endpoint) => { endpoint.event_admission = undefined; }],
    ["cross-lane transfer omitted", (endpoint) => { delete endpoint.cross_lane_transfer; }],
    ["cross-lane transfer undefined", (endpoint) => { endpoint.cross_lane_transfer = undefined; }],
    ["cross-lane transfer string", (endpoint) => { endpoint.cross_lane_transfer = "false"; }],
    ["cross-lane transfer null", (endpoint) => { endpoint.cross_lane_transfer = null; }],
    ["cross-lane transfer numeric", (endpoint) => { endpoint.cross_lane_transfer = 0; }],
    ["cross-lane transfer boxed boolean", (endpoint) => { endpoint.cross_lane_transfer = new Boolean(false); }],
    ["hidden operation admission", (endpoint) => {
      Object.defineProperty(endpoint.operation_admissions, "handle", {
        value: { max_concurrency: 1 }, enumerable: false,
      });
    }],
    ["hidden stream kind", (endpoint) => {
      Object.defineProperty(endpoint.operation_kinds, "handle", {
        value: "stream", enumerable: false,
      });
    }],
  ]) {
    const candidate = plan();
    change(candidate.plugin_instances[0].provided_capabilities[0]);
    assert.throws(() => createWorkersComponentRequestAdapter({
      plan: candidate, instanceKey: "endpoint", coreModule, instantiate: loader.instantiate,
    }), /unexpected shape|Request endpoints/, name);
  }
  assert.equal(loader.created, 0);
});

test("restart policy must be the exact serialized never policy", () => {
  const loader = guest({});
  for (const [name, change] of [
    ["missing attempts", (policy) => { delete policy.max_attempts; }],
    ["undefined attempts", (policy) => { policy.max_attempts = undefined; }],
    ["string attempts", (policy) => { policy.max_attempts = "0"; }],
    ["nonzero attempts", (policy) => { policy.max_attempts = 1; }],
    ["extra policy field", (policy) => { policy.fallback = "native"; }],
    ["hidden policy field", (policy) => {
      Object.defineProperty(policy, "fallback", { value: "native", enumerable: false });
    }],
    ["symbol policy field", (policy) => { policy[Symbol("fallback")] = "native"; }],
    ["missing duration", (policy) => { delete policy.window; }],
    ["null duration", (policy) => { policy.window = null; }],
    ["duration extra field", (policy) => { policy.window.fallback = true; }],
    ["duration string seconds", (policy) => { policy.window.secs = "0"; }],
    ["hidden duration field", (policy) => {
      Object.defineProperty(policy.window, "fallback", { value: true, enumerable: false });
    }],
    ["negative zero duration", (policy) => { policy.window.secs = -0; }],
    ["duration negative nanoseconds", (policy) => { policy.window.nanos = -1; }],
    ["nonzero duration", (policy) => { policy.stability.nanos = 1; }],
    ["undefined mode", (policy) => { policy.mode = undefined; }],
  ]) {
    const candidate = plan();
    change(candidate.plugin_instances[0].restart_policy);
    assert.throws(() => createWorkersComponentRequestAdapter({
      plan: candidate, instanceKey: "endpoint", coreModule, instantiate: loader.instantiate,
    }), /restart policy|Kernel supervision/, name);
  }
  assert.equal(loader.created, 0);
});
