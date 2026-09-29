import assert from "node:assert/strict";
import test from "node:test";
import { createInstanceFacilityScope, facility } from "../facilities.mjs";

const instances = [
  { instanceKey: "state/primary", packageId: "example.state" },
  { instanceKey: "state/secondary", packageId: "example.state" },
];
const grants = {
  schema: "lenso.host-facilities.v1",
  instances: {
    "state/primary": { state: { binding: "PRIMARY", configuration: { label: "primary" } } },
    "state/secondary": { state: { binding: "SECONDARY", configuration: { label: "secondary" } } },
  },
};

test("exact grants isolate same-package instances and event leases", async () => {
  const calls = [];
  const factories = [{
    packageId: "example.state", slot: "state",
    create(binding, scope, configuration) {
      calls.push({ binding, scope, configuration });
      return Object.freeze({ read: () => scope.run(() => Promise.resolve(binding.value + configuration.label)) });
    },
  }];
  const first = createInstanceFacilityScope({ instances, grants, factories, env: { PRIMARY: { value: "A-" }, SECONDARY: { value: "B-" }, PRIVATE: "never granted" } });
  const second = createInstanceFacilityScope({ instances, grants, factories, env: { PRIMARY: { value: "C-" }, SECONDARY: { value: "D-" } } });
  const primary = facility(first, "state/primary", "state");
  const secondary = facility(first, "state/secondary", "state");
  assert.equal(facility(first, "state/primary", "state"), primary);
  assert.equal(await primary.read(), "A-primary");
  assert.equal(await secondary.read(), "B-secondary");
  assert.equal(await facility(second, "state/primary", "state").read(), "C-primary");
  assert.equal(calls.length, 3);
  assert.ok(Object.isFrozen(calls[0].configuration));
  first.abort();
  assert.throws(() => facility(first, "state/primary", "state"), /event_scope_closed/);
  await assert.rejects(primary.read(), /event_scope_closed/);
  assert.equal(await facility(second, "state/primary", "state").read(), "C-primary");
  assert.equal(await first.settled(), true);
  second.abort();
  assert.equal(await second.settled(), true);
});

test("unselected, unknown, malformed and inherited grants fail before factory construction", () => {
  let called = false;
  const factories = [{ packageId: "example.state", slot: "state", create() { called = true; return {}; } }];
  const input = { instances, factories, env: { PRIMARY: {}, SECONDARY: {} } };
  for (const invalid of [
    { ...grants, schema: "unknown" },
    { ...grants, instances: { outsider: grants.instances["state/primary"] } },
    { ...grants, instances: { "state/primary": { global: { binding: "PRIMARY", configuration: {} } } } },
    { ...grants, instances: { "state/primary": { state: { binding: "MISSING", configuration: {} } } } },
    { ...grants, instances: { "state/primary": { state: { binding: "toString", configuration: {} } } } },
    { ...grants, instances: { "state/primary": { state: { binding: "PRIMARY", configuration: {}, factory: "override" } } } },
  ]) assert.throws(() => createInstanceFacilityScope({ ...input, grants: invalid }));
  assert.equal(called, false);
});

test("explicit none and independently named facilities survive a new event", async () => {
  const configured = { schema: grants.schema, instances: {
    "state/primary": {
      state: { binding: "PG_SCHEMA_A", configuration: { schema: "private_a" } },
      cache: { binding: null, configuration: { enabled: false } },
    },
    "state/secondary": { state: { binding: "D1_SECONDARY", configuration: {} } },
  } };
  const factories = ["cache", "state"].map((slot) => ({ packageId: "example.state", slot,
    create(binding, _scope, configuration) { return Object.freeze({ binding, configuration }); },
  }));
  for (let event = 0; event < 2; event++) {
    const env = { D1_SECONDARY: { driver: "d1-stand-in" }, PG_SCHEMA_A: { driver: "pg-stand-in" } };
    const scope = createInstanceFacilityScope({ instances: [...instances].reverse(), grants: configured, factories, env });
    assert.equal(facility(scope, "state/primary", "cache").binding, undefined);
    assert.equal(facility(scope, "state/primary", "cache").configuration.enabled, false);
    assert.equal(facility(scope, "state/primary", "state").binding, env.PG_SCHEMA_A);
    assert.equal(facility(scope, "state/secondary", "state").binding, env.D1_SECONDARY);
    assert.equal(facility(scope, "state/primary", "state").configuration.schema, "private_a");
    scope.abort();
    assert.equal(await scope.settled(), true);
  }
});

test("uncertain write cleanup never replays and cannot project into a later event", async () => {
  let complete, writes = 0;
  const nativeWrite = new Promise((resolve) => { complete = resolve; });
  const factories = [{ packageId: "example.state", slot: "state", create(_binding, scope) {
    return { write() { return scope.run(() => { writes++; return nativeWrite; }); } };
  } }];
  const scope = createInstanceFacilityScope({ instances, grants, factories, env: { PRIMARY: {}, SECONDARY: {} }, limits: { cleanupTimeoutMs: 10 } });
  let projected = false;
  const pending = facility(scope, "state/primary", "state").write().then(() => { projected = true; });
  scope.abort();
  assert.equal(await scope.settled(), false);
  complete("committed-after-cancel");
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(writes, 1);
  assert.equal(projected, false);
  assert.equal(scope.invalidated, true);
  void pending;
});
