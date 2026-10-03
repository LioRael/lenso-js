// A JS execution projection, not a resolver or an application runtime.
// The Host supplies already admitted endpoints and Plan-bound call functions.
import { createPluginStreamSession } from "./plugin-stream.mjs";
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

function contractDescriptor(contract) {
  if (contract.descriptor_digest !== undefined &&
      contract.descriptor.descriptor_digest !== undefined &&
      contract.descriptor_digest !== contract.descriptor.descriptor_digest) {
    throw new Error("generated Capability declares conflicting Descriptor digests");
  }
  return { ...contract.descriptor, descriptor_digest: contract.descriptor_digest ?? contract.descriptor.descriptor_digest };
}

function supported(descriptor, subject, profile, allowStreams) {
  if (descriptor.event_operations.length ||
      descriptor.stream_operations.length && (!allowStreams || profile !== "lenso.provider-stream-cleanup@1")) {
    throw new Error(
      `workers-js ${allowStreams ? "Request/Stream" : "Request"} slice rejects ${subject}: Event is unsupported; Stream requires the generated physical cleanup target lowering`,
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
  return prepareWorkersPluginInternal(definition, { providedEndpoints, dependencies, configuration, lifecycle }, false);
}

/** Request/Stream JS Host projection; Event remains rejected before create. */
export async function prepareWorkersPlugin(definition, options = {}) {
  return prepareWorkersPluginInternal(definition, options, true);
}

async function prepareWorkersPluginInternal(definition, {
  providedEndpoints, dependencies = {}, configuration, lifecycle,
  maxOpenStreams = Math.min(definition.maxConcurrentRequests, 32), maxStreamMessageBytes = 65536,
}, allowStreams) {
  active(lifecycle);
  if (!Number.isSafeInteger(maxOpenStreams) || maxOpenStreams < 1 || maxOpenStreams > 32 ||
      !Number.isSafeInteger(maxStreamMessageBytes) || maxStreamMessageBytes < 1 || maxStreamMessageBytes > 16777216) {
    throw new Error("invalid Workers Stream session/message capacity");
  }
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
    supported(declaration.descriptor, declaration.descriptor.capability_id, declaration.streamLifecycleProfile, allowStreams);
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
      const required = contractDescriptor(declaration.contract);
      supported(required, `dependency ${id}`, declaration.contract.streamLifecycleProfile, allowStreams);
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
            identity(route.descriptor) !== identity(required) ||
            typeof route.invokeRequest !== "function" ||
            required.stream_operations.length && typeof route.openStream !== "function") {
          throw new Error(`resolved dependency route mismatch: ${id}`);
        }
        providers.add(route.providerInstance);
        const invoke = Object.assign(
          (operation, context, payload) => route.invokeRequest(operation, context, payload),
          {
            providerInstance: route.providerInstance,
            openStream: (operation, context, payload) => {
              if (!required.stream_operations.includes(operation)) return Promise.resolve(fail("unknown_operation", operation));
              return route.openStream(operation, context, payload);
            },
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
      const boundDescriptor = {
        ...binding.descriptor,
        descriptor_digest: binding.descriptor.descriptor_digest ?? declaration.descriptor.descriptor_digest,
      };
      if (identity(boundDescriptor) !== identity(declaration.descriptor) ||
          typeof binding.invokeRequest !== "function") {
        throw new Error(`Capability binder mismatch: ${declaration.descriptor.capability_id}`);
      }
      bindings.set(binding.descriptor.capability_id, binding);
    }
  } catch (error) {
    await definition.stop?.(instance, lifecycle);
    throw error;
  }
  let pending = 0, stopping = false, cleanupUnconfirmed = false, opening = 0;
  const sessions = new Set();
  return Object.freeze({
    async invokeRequest(capability, operation, context, payload) {
      if (stopping || cleanupUnconfirmed) return fail("admission_closed", "Plugin is stopping or Stream cleanup is unconfirmed");
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
    async openStream(capability, operation, context, payload) {
      if (stopping || cleanupUnconfirmed) return fail("admission_closed", "Plugin generation unavailable");
      if (context.cancelled || context.signal?.aborted) return fail("cancelled", "Host Stream scope cancelled");
      const binding = bindings.get(capability);
      if (!allowStreams || !binding?.descriptor.stream_operations.includes(operation) || !binding.openStream) {
        return fail("unknown_operation", operation);
      }
      if (sessions.size + opening >= maxOpenStreams) return fail("resource_exhausted", operation);
      opening++;
      const controller = new AbortController();
      const abort = () => controller.abort();
      context.signal?.addEventListener("abort", abort, { once: true });
      const call = Object.freeze({
        ...context,
        get cancelled() { return context.cancelled || controller.signal.aborted; },
        signal: controller.signal,
        abort,
      });
      let retained = false;
      try {
        const result = await binding.openStream(operation, call, payload, instance);
        if (result.kind !== "opened") return result;
        let session;
        try {
          session = createPluginStreamSession(result.stream, call, {
            maxMessageBytes: maxStreamMessageBytes,
            onRelease() { sessions.delete(session); context.signal?.removeEventListener("abort", abort); },
            onUnconfirmed() { cleanupUnconfirmed = true; },
          });
        } catch (error) {
          cleanupUnconfirmed = true;
          try { await result.stream.cancel(); } catch {}
          return fail("unavailable", String(error));
        }
        sessions.add(session);
        retained = true;
        if (call.cancelled) {
          await session.cancel();
          return fail("cancelled", "Host Stream open cancelled");
        }
        return { kind: "opened", stream: session };
      } catch (error) {
        return fail("plugin_failure", String(error));
      } finally {
        opening--;
        if (!retained) context.signal?.removeEventListener("abort", abort);
      }
    },
    async stop(context) {
      active(context);
      if (stopping) throw new Error("Plugin stop attempted more than once");
      if (pending || opening || sessions.size || cleanupUnconfirmed) throw new Error("Plugin stop requires physically settled requests and Stream cleanup");
      stopping = true;
      await definition.stop?.(instance, context);
      active(context);
    },
  });
}
