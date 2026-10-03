import type { InvocationContext } from "@lenso/contract-runtime";
import type {
  ConfigDeclaration, DependencyDeclarations, LifecycleContext, PluginDefinition,
} from "@lenso/bun-plugin/authoring";
import type {
  CapabilityProviderDescriptor, ProviderDispatchOutcome, ProviderStreamOpenOutcome,
} from "@lenso/bun-plugin";

/** An already resolved and authorized Host route, never an ambient lookup. */
export interface WorkersRequestRoute {
  readonly providerInstance: string;
  readonly descriptor: CapabilityProviderDescriptor;
  invokeRequest(operation: string, context: InvocationContext, payload: unknown): Promise<ProviderDispatchOutcome>;
  openStream?(operation: string, context: InvocationContext, payload: unknown): Promise<ProviderStreamOpenOutcome>;
}

export interface WorkersRequestPlugin {
  invokeRequest(capability: string, operation: string, context: InvocationContext, payload: unknown): Promise<ProviderDispatchOutcome>;
  stop(lifecycle: LifecycleContext): Promise<void>;
}

export interface WorkersPlugin extends WorkersRequestPlugin {
  openStream(capability: string, operation: string, context: InvocationContext, payload: unknown): Promise<ProviderStreamOpenOutcome>;
}

export function prepareWorkersPlugin<
  Instance extends object,
  Config extends ConfigDeclaration<unknown> | undefined,
  Dependencies extends DependencyDeclarations | undefined,
>(
  definition: PluginDefinition<Instance, Config, Dependencies>,
  options: {
    readonly providedEndpoints: readonly CapabilityProviderDescriptor[];
    readonly dependencies?: Readonly<Record<string, readonly WorkersRequestRoute[]>>;
    readonly configuration?: unknown;
    readonly lifecycle: LifecycleContext;
    readonly maxOpenStreams?: number;
    readonly maxStreamMessageBytes?: number;
  },
): Promise<WorkersPlugin>;

/** Request-only projection; the owning Host retains Plan and lifecycle authority. */
export function prepareWorkersRequestPlugin<
  Instance extends object,
  Config extends ConfigDeclaration<unknown> | undefined,
  Dependencies extends DependencyDeclarations | undefined,
>(
  definition: PluginDefinition<Instance, Config, Dependencies>,
  options: {
    readonly providedEndpoints: readonly CapabilityProviderDescriptor[];
    readonly dependencies?: Readonly<Record<string, readonly WorkersRequestRoute[]>>;
    readonly configuration?: unknown;
    readonly lifecycle: LifecycleContext;
  },
): Promise<WorkersRequestPlugin>;
