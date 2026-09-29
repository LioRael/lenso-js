import { createEventScope } from "./scope.mjs";

const eventFacilities = new WeakMap();
const MAX_GRANTS = 128;
const SLOT = /^[A-Za-z0-9_-]+$/;
const BINDING = /^[A-Za-z_][A-Za-z0-9_]*$/;

function record(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${name} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new TypeError(`${name} must be a plain object`);
  return value;
}

function exactKeys(value, allowed, name) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new TypeError(`unknown ${name} field`);
  }
}

function freezeJson(value, depth = 0) {
  if (depth > 16) throw new RangeError("facility configuration nesting limit");
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map((item) => freezeJson(item, depth + 1)));
  record(value, "facility configuration");
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freezeJson(item, depth + 1)])));
}

/** Build an event lease from exact plan identities and source-owned factories. */
export function createInstanceFacilityScope({ instances, grants, factories, env, limits } = {}) {
  if (!Array.isArray(instances) || !Array.isArray(factories))
    throw new TypeError("facility plan and factories must be arrays");
  record(grants, "facility grants");
  exactKeys(grants, ["schema", "instances"], "facility grants");
  if (grants.schema !== "lenso.host-facilities.v1")
    throw new TypeError("unsupported facility grants schema");
  record(grants.instances, "facility instances");
  if (!env || typeof env !== "object") throw new TypeError("facility env must be an object");
  const selected = new Map();
  for (const instance of instances) {
    record(instance, "facility plan instance");
    exactKeys(instance, ["instanceKey", "packageId"], "facility plan instance");
    if (typeof instance.instanceKey !== "string" || !instance.instanceKey ||
        typeof instance.packageId !== "string" || !instance.packageId || selected.has(instance.instanceKey))
      throw new TypeError("invalid or duplicate facility plan instance");
    selected.set(instance.instanceKey, instance.packageId);
  }
  const owners = new Map();
  for (const factory of factories) {
    record(factory, "facility factory");
    exactKeys(factory, ["packageId", "slot", "create"], "facility factory");
    if (typeof factory.packageId !== "string" || !factory.packageId ||
        typeof factory.slot !== "string" || !SLOT.test(factory.slot) || typeof factory.create !== "function")
      throw new TypeError("invalid facility factory");
    const identity = JSON.stringify([factory.packageId, factory.slot]);
    if (owners.has(identity)) throw new TypeError("duplicate facility factory");
    owners.set(identity, factory.create);
  }
  const pending = new Map();
  let count = 0;
  for (const [instanceKey, slots] of Object.entries(grants.instances)) {
    const packageId = selected.get(instanceKey);
    if (!packageId) throw new TypeError("facility grant names an unselected instance");
    record(slots, "facility slots");
    for (const [slot, grant] of Object.entries(slots)) {
      if (++count > MAX_GRANTS) throw new RangeError("facility grant count limit");
      if (!SLOT.test(slot)) throw new TypeError("invalid facility slot");
      const create = owners.get(JSON.stringify([packageId, slot]));
      if (!create) throw new TypeError("facility slot has no source-owned factory");
      record(grant, "facility grant");
      exactKeys(grant, ["binding", "configuration"], "facility grant");
      if (!(grant.binding === null || typeof grant.binding === "string" && BINDING.test(grant.binding)))
        throw new TypeError("facility binding must be a name or explicit null");
      if (grant.binding !== null && !Object.hasOwn(env, grant.binding))
        throw new TypeError("facility binding is unavailable");
      const binding = grant.binding === null ? undefined : env[grant.binding];
      const configuration = freezeJson(grant.configuration);
      pending.set(JSON.stringify([instanceKey, slot]), { create, binding, configuration });
    }
  }
  const scope = createEventScope({}, limits);
  eventFacilities.set(scope, pending);
  return scope;
}

/** Called by generated Host glue; business Plugins receive only their typed value. */
export function facility(scope, instanceKey, slot) {
  if (!scope || scope.closed) throw new Error("event_scope_closed");
  const entry = eventFacilities.get(scope)?.get(JSON.stringify([instanceKey, slot]));
  if (!entry) throw new Error("instance_facility_unavailable");
  if (!("value" in entry)) {
    const value = entry.create(entry.binding, scope, entry.configuration);
    if (!value || typeof value !== "object" || typeof value.then === "function")
      throw new TypeError("facility factory must synchronously return its private adapter");
    entry.value = value;
    delete entry.create;
    delete entry.binding;
    delete entry.configuration;
  }
  return entry.value;
}
