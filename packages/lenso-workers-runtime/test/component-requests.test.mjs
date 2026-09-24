import assert from "node:assert/strict";
import test from "node:test";
import { createWorkersComponentRequestAdapter } from "../component-requests.mjs";

const CAPABILITY = "lenso.http.endpoint@1";
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
      restart_policy: { mode: "never" },
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
