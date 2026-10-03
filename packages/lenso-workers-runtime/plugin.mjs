// A JS execution projection, not a resolver or an application runtime.
// The Host supplies already admitted endpoints and Plan-bound call functions.
const fail = (kind, detail) => ({ kind: "runtime", failure: { kind, detail } });

function identity(descriptor) {
  return JSON.stringify([
    descriptor.capability_id, descriptor.descriptor_version,
    descriptor.descriptor_digest ?? null,
    [...descriptor.operations].sort(),
    [...descriptor.stream_operations].sort(),
    [...descriptor.event_operations].sort(),
  ]);
}

function requestOnly(descriptor, subject) {
  if (descriptor.stream_operations.length || descriptor.event_operations.length) {
    throw new Error(
      `workers-js Request slice rejects ${subject}: Stream/Event require a Kernel-connected JS session adapter with terminal cleanup evidence; select Native Bun V2 for those interactions`,
    );
  }
}

function active(context) {
  if (!context || !context.signal || typeof context.remainingTimeoutMs !== "function") {
    throw new TypeError("Host must supply a finite lifecycle context");
  }
  const remaining = context.remainingTimeoutMs();
  if (context.cancelled || context.signal.aborted || !Number.isFinite(remaining) || remaining <= 0) {
    throw new Error("Plugin lifecycle scope is cancelled or expired");
  }
}

/**
 * Project one source-first complete-object Plugin into a Workers JS Host.
 *
 * Call this inside its owning event/generation. The Host, backed by its Kernel,
 * must validate configuration, endpoints, grants and resolved dependency routes
 * before preparation; own deadlines/cancellation and event cleanup; and stop
 * the instance only after physical work settles. This function never invents
 * bindings, acquires resources, caches a generation or substitutes a runtime.
 *
 * The first supported slice is Request. Stream/Event fail before create.
 */
export async function prepareWorkersRequestPlugin(definition, {
  providedEndpoints,
  dependencies = {},
  configuration,
  lifecycle,
} = {}) {
  active(lifecycle);
  if (!Array.isArray(providedEndpoints)) {
    throw new TypeError("Host must supply the exact admitted providedEndpoints");
  }
  const declarations = definition.providers;
  if (!Array.isArray(declarations)) throw new TypeError("invalid Plugin definition");
  const declared = new Map();
  for (const declaration of declarations) {
    if (declaration.kind !== "lenso.provider" || typeof declaration.bind !== "function") {
      throw new Error("workers-js requires source-first instance-bound Capability declarations");
    }
    requestOnly(declaration.descriptor, declaration.descriptor.capability_id);
    const key = declaration.descriptor.capability_id;
    if (declared.has(key)) throw new Error(`duplicate Capability ${key}`);
    declared.set(key, declaration);
  }
  const admitted = new Set();
  for (const endpoint of providedEndpoints) {
    const declaration = declared.get(endpoint.capability_id);
    if (admitted.has(endpoint.capability_id) || !declaration ||
        identity(endpoint) !== identity(declaration.descriptor)) {
      throw new Error(`admitted endpoint mismatch: ${endpoint.capability_id}`);
    }
    admitted.add(endpoint.capability_id);
  }
  if (admitted.size !== declared.size) throw new Error("admitted endpoint set is incomplete");
  if (!Number.isSafeInteger(definition.maxConcurrentRequests) || definition.maxConcurrentRequests < 1) {
    throw new Error("invalid Plugin request capacity");
  }

  const inputs = {};
  if (definition.config) inputs.config = definition.config.parse(configuration);
  const requirementIds = new Set();
  if (definition.dependencies) {
    const clients = Object.create(null);
    for (const [name, declaration] of Object.entries(definition.dependencies)) {
      if (declaration.kind !== "lenso.dependency") throw new Error("workers-js requires dependency(...) declarations");
      const id = declaration.id ?? name;
      if (requirementIds.has(id)) throw new Error(`duplicate dependency ${id}`);
      requirementIds.add(id);
      requestOnly(declaration.contract.descriptor, `dependency ${id}`);
      const routes = Object.hasOwn(dependencies, id) ? dependencies[id] : undefined;
      if (!Array.isArray(routes)) throw new Error(`Host must supply resolved routes for dependency ${id}`);
      if (declaration.cardinality === "one" && routes.length !== 1 ||
          declaration.cardinality === "optional" && routes.length > 1 ||
          !["one", "optional", "many"].includes(declaration.cardinality)) {
        throw new Error(`resolved dependency cardinality mismatch: ${id}`);
      }
      const providers = new Set();
      const bound = routes.map((route) => {
        if (!route.providerInstance || providers.has(route.providerInstance) ||
            identity(route.descriptor) !== identity(declaration.contract.descriptor) ||
            typeof route.invokeRequest !== "function") {
          throw new Error(`resolved dependency route mismatch: ${id}`);
        }
        providers.add(route.providerInstance);
        const invoke = Object.assign(
          (operation, context, payload) => route.invokeRequest(operation, context, payload),
          {
            providerInstance: route.providerInstance,
            openStream: async () => fail("unavailable", "workers-js Request slice does not admit Stream"),
            publishEvent: async () => fail("unavailable", "workers-js Request slice does not admit Event"),
          },
        );
        return Object.freeze({
          providerInstance: route.providerInstance,
          client: declaration.contract.createClient(invoke),
        });
      });
      clients[name] = declaration.cardinality === "many"
        ? Object.freeze(bound) : bound[0]?.client;
    }
    inputs.dependencies = Object.freeze(clients);
  }
  for (const id of Object.keys(dependencies)) {
    if (!requirementIds.has(id)) throw new Error(`undeclared dependency route: ${id}`);
  }
  const instance = definition.create
    ? await definition.create(Object.freeze(inputs), lifecycle) : Object.freeze(inputs);
  if (!instance || typeof instance !== "object" || Array.isArray(instance)) {
    throw new Error("Plugin create must return one complete object");
  }
  const bindings = new Map();
  try {
    active(lifecycle);
    for (const declaration of declarations) {
      const binding = declaration.bind(instance);
      if (identity(binding.descriptor) !== identity(declaration.descriptor) ||
          typeof binding.invokeRequest !== "function") {
        throw new Error(`Capability binder mismatch: ${declaration.descriptor.capability_id}`);
      }
      bindings.set(binding.descriptor.capability_id, binding);
    }
  } catch (error) {
    await definition.stop?.(instance, lifecycle);
    throw error;
  }
  let pending = 0, stopping = false;
  return Object.freeze({
    async invokeRequest(capability, operation, context, payload) {
      if (stopping) return fail("admission_closed", "Plugin is stopping");
      if (context.cancelled) return fail("cancelled", "Host invocation scope cancelled");
      const binding = bindings.get(capability);
      if (!binding?.descriptor.operations.includes(operation)) {
        return fail("unknown_operation", operation);
      }
      if (pending >= definition.maxConcurrentRequests) return fail("resource_exhausted", operation);
      pending++;
      try {
        const outcome = await binding.invokeRequest(operation, context, payload, instance);
        return context.cancelled ? fail("cancelled", "Host invocation scope cancelled") : outcome;
      } catch (error) {
        return fail("plugin_failure", error instanceof Error ? error.message : String(error));
      } finally {
        pending--;
      }
    },
    async stop(context) {
      active(context);
      if (stopping) throw new Error("Plugin stop attempted more than once");
      if (pending) throw new Error("Plugin stop requires physically settled requests");
      stopping = true;
      await definition.stop?.(instance, context);
      active(context);
    },
  });
}
