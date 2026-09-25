const EXECUTION_CLASS = "lenso.wasm-component@1";
const PROFILE = "lenso.wasm-component@1";
const REQUIRED_TARGET_CAPABILITIES = ["request", "wasm-component", "workers"];
const MAX_JSON_BYTES = 1_048_576;
const encoder = new TextEncoder();

function compareId(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function record(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError(`${name} must be an object`);
  return value;
}

function exactKeys(value, keys, name) {
  if (Reflect.ownKeys(value).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(value, key))) {
    throw new TypeError(`${name} has an unexpected shape`);
  }
}

function zeroDuration(value, name) {
  const duration = record(value, name);
  exactKeys(duration, ["secs", "nanos"], name);
  if (!Object.is(duration.secs, 0) || !Object.is(duration.nanos, 0))
    throw new TypeError(`${name} must be an exact zero Duration`);
}

function neverRestartPolicy(value) {
  const policy = record(value, "restart policy");
  exactKeys(policy, ["mode", "max_attempts", "window", "backoff", "jitter",
    "stability"], "restart policy");
  if (policy.mode !== "never" || !Object.is(policy.max_attempts, 0))
    throw new TypeError("Workers Component requests do not implement Kernel supervision");
  for (const name of ["window", "backoff", "jitter", "stability"])
    zeroDuration(policy[name], `restart policy ${name}`);
}

function boundedJson(value, name) {
  if (typeof value !== "string" || encoder.encode(value).byteLength > MAX_JSON_BYTES)
    throw new TypeError(`${name} must be at most ${MAX_JSON_BYTES} UTF-8 bytes`);
  JSON.parse(value);
  return value;
}

function selectedInstance(plan, instanceKey) {
  record(plan, "Plan");
  exactKeys(plan, ["schema_version", "terminal_policy", "execution_lanes",
    "capability_bindings", "plugin_instances"], "Plan");
  if (plan.schema_version !== 4 || plan.terminal_policy?.kind !== "required_path")
    throw new TypeError("Workers Component requests require a V4 required-path Plan");
  exactKeys(record(plan.terminal_policy, "terminal policy"), ["kind"], "terminal policy");
  if (!Array.isArray(plan.execution_lanes) || plan.execution_lanes.length !== 1 ||
      plan.execution_lanes[0]?.id !== "main")
    throw new TypeError("Workers Component requests support only the main execution lane");
  exactKeys(record(plan.execution_lanes[0], "execution lane"), ["id"], "execution lane");
  if (!Array.isArray(plan.capability_bindings) || plan.capability_bindings.length !== 0)
    throw new TypeError("Workers Component requests do not support Capability bindings");
  if (!Array.isArray(plan.plugin_instances) || plan.plugin_instances.length !== 1)
    throw new TypeError("Workers Component requests require exactly one selected Instance");
  const instance = record(plan.plugin_instances[0], "selected Instance");
  exactKeys(instance, ["authoring_version", "runtime_profile", "instance_key",
    "package_id", "entrypoint", "configuration", "provided_capabilities",
    "required_capabilities", "required_target_capabilities", "execution_class",
    "package_revision", "restart_policy", "criticality", "execution_lane"],
  "selected Instance");
  if (instance.instance_key !== instanceKey || !instanceKey)
    throw new TypeError("selected Component Instance key differs from the Plan");
  if (typeof instance.package_id !== "string" || !instance.package_id ||
      typeof instance.package_revision !== "string" || !instance.package_revision)
    throw new TypeError("selected Component needs an exact package identity");
  if (instance.execution_class !== EXECUTION_CLASS || instance.runtime_profile !== PROFILE ||
      ![1, 2].includes(instance.authoring_version) || instance.entrypoint !== "plugin")
    throw new TypeError("selected Instance is not a supported request-only Component");
  if (instance.configuration !== "{}" ||
      !Array.isArray(instance.required_capabilities) || instance.required_capabilities.length !== 0)
    throw new TypeError("Workers Component requests cannot inject configuration or Host imports");
  if (!Array.isArray(instance.required_target_capabilities) ||
      JSON.stringify(instance.required_target_capabilities) !==
        JSON.stringify(REQUIRED_TARGET_CAPABILITIES))
    throw new TypeError("selected Component needs exactly request, wasm-component and workers");
  neverRestartPolicy(instance.restart_policy);
  if (instance.criticality !== "non_critical")
    throw new TypeError("Workers Component requests do not implement Kernel supervision");
  if (instance.execution_lane !== "main")
    throw new TypeError("selected Component is not on the main execution lane");
  if (!Array.isArray(instance.provided_capabilities) ||
      instance.provided_capabilities.length === 0)
    throw new TypeError("selected Component has no request endpoints");
  return instance;
}

function expectedDescriptor(instance, expectedDescriptorDigests) {
  const capabilities = instance.provided_capabilities.map((endpoint) => {
    record(endpoint, "Capability endpoint");
    exactKeys(endpoint, ["capability_id", "descriptor_version", "operations",
      "operation_kinds", "default_admission", "operation_admissions",
      "event_admission", "cross_lane_transfer"], "Capability endpoint");
    const operations = endpoint.operations;
    const kinds = record(endpoint.operation_kinds, "operation kinds");
    const admissions = record(endpoint.operation_admissions, "operation admissions");
    if (typeof endpoint.capability_id !== "string" || !endpoint.capability_id ||
        typeof endpoint.descriptor_version !== "string" || !endpoint.descriptor_version ||
        !Array.isArray(operations) || operations.length === 0 ||
        operations.some((name) => typeof name !== "string" || !name) ||
        new Set(operations).size !== operations.length ||
        Reflect.ownKeys(kinds).some((name) =>
          typeof name !== "string" || !operations.includes(name) ||
          kinds[name] !== "request") ||
        endpoint.default_admission !== null ||
        Reflect.ownKeys(admissions).length !== 0 ||
        endpoint.event_admission !== null || endpoint.cross_lane_transfer !== false) {
      throw new TypeError("Workers Component requests support only uncustomized Request endpoints");
    }
    return {
      capability_id: endpoint.capability_id,
      descriptor_version: endpoint.descriptor_version,
      request_operations: operations,
    };
  }).sort((left, right) => compareId(left.capability_id, right.capability_id));
  if (capabilities.some((entry, index) => index > 0 &&
      entry.capability_id === capabilities[index - 1].capability_id))
    throw new TypeError("selected Component has duplicate Capability endpoints");
  if (instance.authoring_version === 2) {
    const digests = record(expectedDescriptorDigests, "trusted Descriptor digests");
    exactKeys(digests, capabilities.map((capability) => capability.capability_id),
      "trusted Descriptor digests");
    for (const capability of capabilities) {
      const digest = digests[capability.capability_id];
      if (typeof digest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(digest))
        throw new TypeError("trusted Descriptor digest must be an exact SHA-256 identity");
      capability.descriptor_digest = digest;
    }
  } else if (expectedDescriptorDigests !== undefined) {
    throw new TypeError("authoring V1 Guest does not admit Descriptor digests");
  }
  return { abi: "lenso.json-request@1", capabilities };
}

function checkedGuest(instantiate, coreModule, coreModulePath) {
  const guest = record(instantiate((path) => {
    if (path !== coreModulePath)
      throw new TypeError(`unexpected Component core module: ${path}`);
    return coreModule;
  }, {}), "Component Guest");
  exactKeys(guest, ["describe", "invoke"], "Component Guest");
  if (typeof guest.describe !== "function" || typeof guest.invoke !== "function")
    throw new TypeError("Component Guest must export describe and invoke");
  return guest;
}

/**
 * Admit one selected, dependency-free Component's JSON Request ABI for a
 * Workers event Host. This is not a Kernel runner or a Workers App builder.
 * The Host still owns verified artifact selection and HTTP ingress policy.
 */
export function createWorkersComponentRequestAdapter({
  plan, instanceKey, coreModule, instantiate, coreModulePath = "guest.core.wasm",
  expectedDescriptorDigests,
} = {}) {
  const instance = selectedInstance(plan, instanceKey);
  const expected = expectedDescriptor(instance, expectedDescriptorDigests);
  if (!(coreModule instanceof WebAssembly.Module) ||
      WebAssembly.Module.imports(coreModule).length !== 0)
    throw new TypeError("Workers Component core module must be precompiled and import-free");
  if (typeof instantiate !== "function" ||
      typeof coreModulePath !== "string" || !coreModulePath)
    throw new TypeError("exact Component instantiate function and core path are required");
  const probe = checkedGuest(instantiate, coreModule, coreModulePath);
  const actual = record(JSON.parse(boundedJson(probe.describe(), "Guest descriptor")),
    "Guest descriptor");
  exactKeys(actual, ["abi", "capabilities"], "Guest descriptor");
  if (!Array.isArray(actual.capabilities))
    throw new TypeError("Guest capabilities must be an array");
  const capabilities = actual.capabilities.map((capability) => {
    record(capability, "Guest Capability");
    exactKeys(capability, instance.authoring_version === 2
      ? ["capability_id", "descriptor_version", "descriptor_digest", "request_operations"]
      : ["capability_id", "descriptor_version", "request_operations"], "Guest Capability");
    return capability;
  }).sort((left, right) => compareId(String(left.capability_id), String(right.capability_id)));
  const normalized = {
    abi: actual.abi,
    capabilities: capabilities.map((capability) => ({
      capability_id: capability.capability_id,
      descriptor_version: capability.descriptor_version,
      request_operations: capability.request_operations,
      ...(instance.authoring_version === 2
        ? { descriptor_digest: capability.descriptor_digest } : {}),
    })),
  };
  if (JSON.stringify(normalized) !== JSON.stringify(expected))
    throw new TypeError("Guest descriptor differs from the resolved Plan Instance");
  const selected = new Map(expected.capabilities.map((capability) =>
    [capability.capability_id, new Set(capability.request_operations)]));
  return Object.freeze({
    invoke(capability, operation, requestJson) {
      if (!selected.get(capability)?.has(operation))
        throw new TypeError("Capability Operation was not selected by the Plan");
      boundedJson(requestJson, "Guest request");
      const guest = checkedGuest(instantiate, coreModule, coreModulePath);
      return boundedJson(guest.invoke(capability, operation, requestJson), "Guest response");
    },
  });
}
