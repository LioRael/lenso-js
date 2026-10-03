import type { InvocationContext } from "@lenso/contract-runtime";

import type {
  CapabilityProviderBinding,
  CapabilityProviderDescriptor,
  ProviderDispatchOutcome,
  DependencyTable,
  LegacyPluginOptions,
  LegacyPluginDefinition,
  LegacyPluginInputs,
  ProviderEventPublishOutcome,
  ProviderStreamOpenOutcome,
} from "./index.js";

/** A finite Host-owned scope used while constructing or stopping one instance. */
export interface LifecycleContext extends InvocationContext {
  readonly signal: AbortSignal;
  remainingTimeoutMs(): number;
}

/** Runtime projection emitted beside a generated request Capability client. */
export interface CapabilityDependencyBinding<
  Client,
  Runtime extends DependencyInvoker = DependencyInvoker,
> {
  readonly descriptor: CapabilityProviderDescriptor;
  createClient(invoke: Runtime): Client;
}

export type DependencyInvoker = (
  operation: string,
  context: InvocationContext,
  payload: unknown,
) => Promise<ProviderDispatchOutcome>;

/** @internal Host-backed interaction seam consumed by generated clients. */
export type InteractionDependencyInvoker = DependencyInvoker & {
  readonly providerInstance: string;
  openStream(
    operation: string,
    context: InvocationContext,
    payload: unknown,
  ): Promise<ProviderStreamOpenOutcome>;
  publishEvent(
    operation: string,
    context: InvocationContext,
    payload: unknown,
  ): Promise<ProviderEventPublishOutcome>;
};

export type DependencyCardinality = "one" | "optional" | "many";

export interface BoundCapabilityClient<Client> {
  readonly providerInstance: string;
  readonly client: Client;
}

export interface DependencyDeclaration<
  Client,
  Cardinality extends DependencyCardinality = "one",
> {
  readonly kind: "lenso.dependency";
  readonly id?: string;
  readonly contract: CapabilityDependencyBinding<Client, InteractionDependencyInvoker>;
  readonly cardinality: Cardinality;
}

export function dependency<
  Client,
  Cardinality extends DependencyCardinality = "one",
>(options: {
  readonly id: string;
  readonly contract: CapabilityDependencyBinding<Client, InteractionDependencyInvoker>;
  readonly cardinality?: Cardinality;
}): DependencyDeclaration<Client, Cardinality> {
  if (options.id.length === 0) throw new Error("dependency id must not be empty");
  return Object.freeze({
    kind: "lenso.dependency" as const,
    id: options.id,
    contract: options.contract,
    cardinality: options.cardinality ?? ("one" as Cardinality),
  });
}

/** A declaration that publishes a portable schema and decodes Plugin configuration. */
export interface ConfigDeclaration<Config> {
  readonly kind: "lenso.config";
  readonly schema: boolean | Readonly<Record<string, unknown>>;
  parse(input: unknown): Config;
}

/** Declares the portable schema and runtime decoder for one Plugin configuration. */
export function configuration<Config>(
  schema: boolean | Readonly<Record<string, unknown>>,
  parse: (input: unknown) => Config,
): ConfigDeclaration<Config> {
  if (
    typeof schema !== "boolean" &&
    (typeof schema !== "object" || schema === null || Array.isArray(schema))
  ) {
    throw new Error("configuration schema must be a JSON Schema object or boolean");
  }
  return Object.freeze({ kind: "lenso.config" as const, schema, parse });
}

export interface ProviderDeclaration<Instance extends object> {
  readonly kind: "lenso.provider";
  readonly descriptor: CapabilityProviderDescriptor;
  readonly bind: (instance: Instance) => CapabilityProviderBinding;
}

/** A generated Capability value used for both Provider and dependency authoring. */
export interface CapabilityProviderContract<Instance extends object> {
  readonly kind: "lenso.capability";
  readonly descriptor: CapabilityProviderDescriptor;
  bindProvider(instance: Instance): CapabilityProviderBinding;
}

/** Adapts a generated instance binder to the generic Plugin declaration. */
export function provider<Instance extends object>(
  descriptor: CapabilityProviderDescriptor,
  bind: (instance: Instance) => CapabilityProviderBinding,
): ProviderDeclaration<Instance> {
  return Object.freeze({ kind: "lenso.provider" as const, descriptor, bind });
}

export type DependencyDeclarations = Readonly<
  // `any` deliberately erases generated client/runtime types at this
  // structural boundary. `DependencyValue` recovers the client per property.
  Record<string, {
    readonly kind: "lenso.dependency";
    readonly id?: string;
    readonly contract: CapabilityDependencyBinding<any, any>;
    readonly cardinality: DependencyCardinality;
  }>
>;

type ConfigValue<Declaration> = Declaration extends ConfigDeclaration<infer Value>
  ? Value
  : never;

type DependencyValue<Declaration> =
  Declaration extends {
    readonly contract: CapabilityDependencyBinding<infer Client, any>;
    readonly cardinality: infer Cardinality;
  }
    ? Cardinality extends "optional"
      ? Client | undefined
      : Cardinality extends "many"
        ? ReadonlyArray<BoundCapabilityClient<Client>>
        : Client
    : never;

export type PluginInputs<
  Config extends ConfigDeclaration<unknown> | undefined,
  Dependencies extends DependencyDeclarations | undefined,
> = (Config extends ConfigDeclaration<unknown>
  ? { readonly config: ConfigValue<Config> }
  : object) &
  (Dependencies extends DependencyDeclarations
    ? {
        readonly dependencies: {
          readonly [Name in keyof Dependencies]: DependencyValue<Dependencies[Name]>;
        };
      }
    : object);

export type PluginProvider<Instance extends object> =
  | ProviderDeclaration<Instance>
  | CapabilityProviderBinding;

type DeclaredProviders<Instance extends object> =
  | {
      readonly provides: ReadonlyArray<CapabilityProviderContract<Instance>>;
      readonly providers?: never;
    }
  | {
      /** @deprecated Prefer generated Capability values in `provides`. */
      readonly providers: ReadonlyArray<PluginProvider<Instance>>;
      readonly provides?: never;
    };

export type PluginDefinition<
  Instance extends object,
  Config extends ConfigDeclaration<unknown> | undefined =
    | ConfigDeclaration<unknown>
    | undefined,
  Dependencies extends DependencyDeclarations | undefined =
    | DependencyDeclarations
    | undefined,
> = DeclaredInputs<Config, Dependencies> & {
  readonly providers: ReadonlyArray<PluginProvider<Instance>>;
  readonly create?: (
    inputs: object,
    lifecycle: LifecycleContext,
  ) => Instance | Promise<Instance>;
  readonly stop?: (
    instance: Instance,
    lifecycle: LifecycleContext,
  ) => void | Promise<void>;
  readonly maxConcurrentRequests: number;
};

type DeclaredInputs<
  Config extends ConfigDeclaration<unknown> | undefined,
  Dependencies extends DependencyDeclarations | undefined,
> = (Config extends ConfigDeclaration<unknown>
  ? { readonly config: Config }
  : { readonly config?: undefined }) &
  (Dependencies extends DependencyDeclarations
    ? { readonly dependencies: Dependencies }
    : { readonly dependencies?: undefined });

export type PluginOptionsWithCreate<
  Config extends ConfigDeclaration<unknown> | undefined,
  Dependencies extends DependencyDeclarations | undefined,
  Factory extends (...arguments_: never[]) => object | Promise<object>,
> = DeclaredInputs<Config, Dependencies> & DeclaredProviders<NoInfer<CreatedInstance<Factory>>> & {
  readonly create: Factory &
    ((
      inputs: PluginInputs<Config, Dependencies>,
      lifecycle: LifecycleContext,
    ) => object | Promise<object>);
  readonly stop?: (
    instance: NoInfer<CreatedInstance<Factory>>,
    lifecycle: LifecycleContext,
  ) => void | Promise<void>;
  readonly maxConcurrentRequests?: number;
};

export function definePlugin<
  Factory extends (...arguments_: never[]) => object | Promise<object>,
  Config extends ConfigDeclaration<unknown> | undefined = undefined,
  Dependencies extends DependencyDeclarations | undefined = undefined,
>(
  options: PluginOptionsWithCreate<Config, Dependencies, Factory>,
): PluginDefinition<
  import("./authoring.js").CreatedInstance<Factory>,
  Config,
  Dependencies
>;
export function definePlugin<
  Config extends ConfigDeclaration<unknown> | undefined = undefined,
  Dependencies extends DependencyDeclarations | undefined = undefined,
>(
  options: PluginOptionsWithDefaultInstance<Config, Dependencies>,
): PluginDefinition<
  PluginOptionsInstance<Config, Dependencies>,
  Config,
  Dependencies
>;
export function definePlugin<
  Dependencies extends DependencyTable = Readonly<Record<never, never>>,
  Config = unknown,
  Instance extends object = LegacyPluginInputs<Dependencies, Config>,
>(
  options: LegacyPluginOptions<Dependencies, Config, Instance>,
): LegacyPluginDefinition<Dependencies, Config, Instance>;
export function definePlugin(
  options: object,
): object {
  const candidate = options as {
    readonly provides?: ReadonlyArray<CapabilityProviderContract<object>>;
    readonly providers?: ReadonlyArray<PluginProvider<object>>;
    readonly dependencies?: Readonly<Record<string, unknown>>;
    readonly config?: ConfigDeclaration<unknown>;
    readonly configurationSchema?: boolean | Readonly<Record<string, unknown>>;
    readonly decodeConfig?: (value: unknown) => unknown;
    readonly create?: (...arguments_: never[]) => object | Promise<object>;
    readonly stop?: (...arguments_: never[]) => void | Promise<void>;
    readonly maxConcurrentRequests?: number;
  };
  if ((candidate.provides === undefined) === (candidate.providers === undefined)) {
    throw new Error("definePlugin requires exactly one of provides or providers");
  }
  const providers: ReadonlyArray<PluginProvider<object>> = candidate.provides === undefined
    ? candidate.providers!
    : candidate.provides.map((contract) => {
        if (
          contract.kind !== "lenso.capability" ||
          typeof contract.bindProvider !== "function"
        ) {
          throw new Error("provides entries must be generated Capability contracts");
        }
        return Object.freeze({
          kind: "lenso.provider" as const,
          descriptor: contract.descriptor,
          bind: (instance: object) => contract.bindProvider(instance),
        });
      });
  const seen = new Set<string>();
  for (const provider of providers) {
    validateDescriptor(provider.descriptor);
    if (seen.has(provider.descriptor.capability_id)) {
      throw new Error(
        `duplicate Capability Provider ${provider.descriptor.capability_id}`,
      );
    }
    seen.add(provider.descriptor.capability_id);
  }
  if (candidate.dependencies !== undefined) {
    const dependencyIds = new Set<string>();
    for (const [name, raw] of Object.entries(candidate.dependencies)) {
      if (name.length === 0) throw new Error("dependency name must not be empty");
      if (typeof raw !== "object" || raw === null) {
        throw new Error(`dependency ${name} is invalid`);
      }
      if (!("kind" in raw)) {
        const legacy = raw as import("./authoring.js").CapabilityDependencyBinding<unknown>;
        validateDescriptor(legacy.descriptor);
        continue;
      }
      const declaration = raw as import("./authoring.js").DependencyDeclaration<
        unknown,
        import("./authoring.js").DependencyCardinality
      >;
      if (declaration.kind !== "lenso.dependency") {
        throw new Error(`dependency ${name} is not a dependency(...) declaration`);
      }
      const dependencyId = declaration.id ?? name;
      if (dependencyId.length === 0) throw new Error("dependency id must not be empty");
      if (dependencyIds.has(dependencyId)) throw new Error(`duplicate dependency id ${dependencyId}`);
      dependencyIds.add(dependencyId);
      validateDescriptor(declaration.contract.descriptor);
      if (
        declaration.cardinality !== "one" &&
        declaration.cardinality !== "optional" &&
        declaration.cardinality !== "many"
      ) {
        throw new Error(
          `dependency ${dependencyId} has invalid cardinality ${String(declaration.cardinality)}`,
        );
      }
    }
  }
  if (
    candidate.config !== undefined &&
    (candidate.config.kind !== "lenso.config" ||
      typeof candidate.config.parse !== "function" ||
      (typeof candidate.config.schema !== "boolean" &&
        (typeof candidate.config.schema !== "object" ||
          candidate.config.schema === null ||
          Array.isArray(candidate.config.schema))))
  ) {
    throw new Error("config must be a configuration(...) declaration");
  }
  const maxConcurrentRequests =
    candidate.maxConcurrentRequests ?? 32;
  if (!Number.isSafeInteger(maxConcurrentRequests) || maxConcurrentRequests <= 0) {
    throw new Error("maxConcurrentRequests must be a positive safe integer");
  }
  if (
    candidate.configurationSchema !== undefined &&
    typeof candidate.configurationSchema !== "boolean" &&
    (typeof candidate.configurationSchema !== "object" ||
      candidate.configurationSchema === null ||
      Array.isArray(candidate.configurationSchema))
  ) {
    throw new Error("configurationSchema must be a JSON Schema object or boolean");
  }
  return Object.freeze({
    ...(candidate.config === undefined ? {} : { config: candidate.config }),
    ...(candidate.dependencies === undefined
      ? {}
      : { dependencies: Object.freeze({ ...candidate.dependencies }) }),
    ...(candidate.configurationSchema === undefined
      ? {}
      : { configurationSchema: candidate.configurationSchema }),
    ...(candidate.decodeConfig === undefined
      ? {}
      : { decodeConfig: candidate.decodeConfig }),
    providers: Object.freeze([...providers]),
    ...(candidate.create === undefined ? {} : { create: candidate.create }),
    ...(candidate.stop === undefined ? {} : { stop: candidate.stop }),
    maxConcurrentRequests,
  });
}

type PluginOptionsInstance<
  Config extends ConfigDeclaration<unknown> | undefined,
  Dependencies extends DependencyDeclarations | undefined,
> = import("./authoring.js").PluginInputs<Config, Dependencies>;

function validateDescriptor(descriptor: CapabilityProviderDescriptor): void {
  if (
    descriptor.capability_id.length === 0 ||
    descriptor.descriptor_version.length === 0 ||
    descriptor.operations.length === 0
  ) {
    throw new Error("Capability Provider descriptor is incomplete");
  }
  if (new Set(descriptor.operations).size !== descriptor.operations.length) {
    throw new Error(
      `Capability Provider ${descriptor.capability_id} declares duplicate Operations`,
    );
  }
  if (
    descriptor.descriptor_digest !== undefined &&
    !/^sha256:[0-9a-f]{64}$/u.test(descriptor.descriptor_digest)
  ) {
    throw new Error(
      `Capability Provider ${descriptor.capability_id} has an invalid descriptor digest`,
    );
  }
  for (const operation of [
    ...descriptor.stream_operations,
    ...descriptor.event_operations,
  ]) {
    if (!descriptor.operations.includes(operation)) {
      throw new Error(
        `Capability Provider ${descriptor.capability_id} classifies unknown Operation ${operation}`,
      );
    }
  }
}


export type CreatedInstance<
  Factory extends (...arguments_: never[]) => object | Promise<object>,
> = Awaited<ReturnType<Factory>>;

export type PluginOptionsWithDefaultInstance<
  Config extends ConfigDeclaration<unknown> | undefined,
  Dependencies extends DependencyDeclarations | undefined,
> = DeclaredInputs<Config, Dependencies> & DeclaredProviders<NoInfer<PluginInputs<Config, Dependencies>>> & {
  readonly create?: undefined;
  readonly stop?: (
    instance: NoInfer<PluginInputs<Config, Dependencies>>,
    lifecycle: LifecycleContext,
  ) => void | Promise<void>;
  readonly maxConcurrentRequests?: number;
};
