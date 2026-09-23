import { VALUE_PROFILE, type InvocationExtension } from "./types.js";
import { parseStrictJson, validateExtension } from "./validate.js";

export const AUTHORING_API_VERSION = 2 as const;
export const DEFAULT_MAX_FRAME_BYTES = 1_048_576 as const;

export interface SessionIdentity {
  readonly session: string;
  readonly plugin_instance: string;
  readonly plugin_generation: string;
  readonly artifact_digest: string;
  readonly contract_digest: string;
  readonly runtime_profile: string;
  readonly value_profile: typeof VALUE_PROFILE;
}

export interface AuthoringLimits {
  readonly max_frame_bytes: number;
  readonly max_active_invocations: number;
  readonly max_active_outbound_calls: number;
  readonly max_queued_calls: number;
  readonly max_unfinished_executions: number;
  readonly max_retired_ids: number;
}

export type RequirementCardinality = "one" | "optional" | "many";
export interface RequirementDeclaration {
  readonly requirement_id: string;
  readonly capability_id: string;
  readonly descriptor_version: string;
  readonly descriptor_digest: string;
  readonly cardinality: RequirementCardinality;
}
export interface RouteDescriptor {
  readonly route_id: string;
  readonly requirement_id: string;
  readonly capability_id: string;
  readonly descriptor_version: string;
  readonly descriptor_digest: string;
  readonly provider_instance: string;
  readonly provider_order: number;
}
export interface ProvidedEndpoint {
  readonly endpoint_id: string;
  readonly capability_id: string;
  readonly descriptor_version: string;
  readonly descriptor_digest: string;
}
export interface InitializeParams {
  readonly api_version: typeof AUTHORING_API_VERSION;
  readonly identity: SessionIdentity;
  readonly config: unknown;
  readonly required_declarations: readonly RequirementDeclaration[];
  readonly routes: readonly RouteDescriptor[];
  readonly provided_endpoints: readonly ProvidedEndpoint[];
  readonly limits: AuthoringLimits;
}
export type InitializedResult = InitializeParams;

export interface ConstructParams {
  readonly session: string;
  readonly lifecycle_scope_id: string;
  readonly remaining_budget_nanos: string;
}
export type FactoryOutcome =
  | { readonly kind: "constructed" }
  | { readonly kind: "failed"; readonly detail: string };
export interface ConstructedResult {
  readonly session: string;
  readonly lifecycle_scope_id: string;
  readonly outcome: FactoryOutcome;
}
export interface InvocationScope {
  readonly scope_id: string;
  readonly parent_scope_id: string | null;
  readonly remaining_budget_nanos: string;
  readonly permissions: readonly string[];
  readonly extensions: readonly InvocationExtension[];
}
export interface InvokeParams {
  readonly session: string;
  readonly correlation_id: string;
  readonly endpoint_id: string;
  readonly capability_id: string;
  readonly descriptor_version: string;
  readonly descriptor_digest: string;
  readonly operation: string;
  readonly scope: InvocationScope;
  readonly payload: unknown;
}
export type RuntimeFailure =
  | { readonly kind: "unavailable"; readonly capability: string }
  | {
      readonly kind: "unknown_operation";
      readonly capability: string;
      readonly operation: string;
    }
  | {
      readonly kind: "ambiguous_binding";
      readonly capability: string;
      readonly providers: number;
    }
  | { readonly kind: "protocol_violation"; readonly capability: string }
  | {
      readonly kind: "missing_plugin_factory";
      readonly instance: string;
      readonly package_id: string;
    }
  | {
      readonly kind: "unavailable_execution_class";
      readonly instance_key: string;
      readonly execution_class: string;
    }
  | { readonly kind: "invalid_resolved_plan"; readonly detail: string }
  | { readonly kind: "admission_closed" }
  | {
      readonly kind: "resource_exhausted";
      readonly capability: string;
      readonly operation: string;
    }
  | { readonly kind: "deadline_exceeded"; readonly request_id: string }
  | { readonly kind: "cancelled"; readonly request_id: string }
  | { readonly kind: "internal"; readonly detail: string }
  | { readonly kind: "plugin_failure"; readonly detail: string }
  | {
      readonly kind: "plugin_restart_exhausted";
      readonly instance: string;
      readonly attempts: number;
    };
export type InvocationOutcome =
  | { readonly kind: "success"; readonly value: unknown }
  | { readonly kind: "domain"; readonly error: unknown }
  | { readonly kind: "runtime"; readonly failure: RuntimeFailure };
export interface InvocationResult {
  readonly session: string;
  readonly correlation_id: string;
  readonly outcome: InvocationOutcome;
}
export interface OutboundCallParams {
  readonly session: string;
  readonly correlation_id: string;
  readonly requirement_id: string;
  readonly route_id: string;
  readonly operation: string;
  readonly scope: InvocationScope;
  readonly payload: unknown;
}
export type OutboundCallResult = InvocationResult;
export interface EventPublishParams {
  readonly session: string;
  readonly correlation_id: string;
  readonly endpoint_id: string;
  readonly capability_id: string;
  readonly descriptor_version: string;
  readonly descriptor_digest: string;
  readonly operation: string;
  readonly scope: InvocationScope;
  readonly event: unknown;
}
export interface OutboundEventPublishParams {
  readonly session: string;
  readonly correlation_id: string;
  readonly requirement_id: string;
  readonly route_id: string;
  readonly operation: string;
  readonly scope: InvocationScope;
  readonly event: unknown;
}
export type EventPublishOutcome =
  | { readonly kind: "accepted" }
  | { readonly kind: "runtime"; readonly failure: RuntimeFailure };
export interface EventPublishResult {
  readonly session: string;
  readonly correlation_id: string;
  readonly outcome: EventPublishOutcome;
}
export type OutboundEventPublishResult = EventPublishResult;
export interface StreamOpenParams {
  readonly session: string;
  readonly correlation_id: string;
  readonly endpoint_id: string;
  readonly capability_id: string;
  readonly descriptor_version: string;
  readonly descriptor_digest: string;
  readonly operation: string;
  readonly scope: InvocationScope;
  readonly request: unknown;
}
export interface OutboundStreamOpenParams {
  readonly session: string;
  readonly correlation_id: string;
  readonly requirement_id: string;
  readonly route_id: string;
  readonly operation: string;
  readonly scope: InvocationScope;
  readonly request: unknown;
}
export type StreamOpenOutcome =
  | { readonly kind: "opened"; readonly stream_id: string }
  | { readonly kind: "domain"; readonly error: unknown }
  | { readonly kind: "runtime"; readonly failure: RuntimeFailure };
export interface StreamOpenResult {
  readonly session: string;
  readonly correlation_id: string;
  readonly outcome: StreamOpenOutcome;
}
export type OutboundStreamOpenResult = StreamOpenResult;
export interface StreamSendParams {
  readonly session: string;
  readonly correlation_id: string;
  readonly stream_id: string;
  readonly sequence: string;
  readonly message: unknown;
}
export interface StreamReceiveParams {
  readonly session: string;
  readonly correlation_id: string;
  readonly stream_id: string;
}
export type StreamCloseSendParams = StreamReceiveParams;
export type StreamCancelParams = StreamReceiveParams;
export type StreamActionOutcome =
  | { readonly kind: "accepted" }
  | { readonly kind: "runtime"; readonly failure: RuntimeFailure };
export interface StreamActionResult {
  readonly session: string;
  readonly correlation_id: string;
  readonly stream_id: string;
  readonly outcome: StreamActionOutcome;
}
export type StreamTerminalOutcome =
  | { readonly kind: "success" }
  | { readonly kind: "domain"; readonly error: unknown };
export type StreamReceiveOutcome =
  | { readonly kind: "message"; readonly sequence: string; readonly message: unknown }
  | { readonly kind: "peer_half_closed" }
  | { readonly kind: "terminal"; readonly outcome: StreamTerminalOutcome }
  | { readonly kind: "runtime"; readonly failure: RuntimeFailure };
export interface StreamReceiveResult {
  readonly session: string;
  readonly correlation_id: string;
  readonly stream_id: string;
  readonly outcome: StreamReceiveOutcome;
}
export interface AuthoringCancelParams {
  readonly session: string;
  readonly scope_id: string;
  readonly correlation_id: string;
  readonly reason: string;
}
export interface CancelAck {
  readonly session: string;
  readonly scope_id: string;
  readonly correlation_id: string;
  readonly accepted: boolean;
}
export type SettlementState = "completed" | "cancelled" | "abandoned";
export interface Settlement {
  readonly session: string;
  readonly scope_id: string;
  readonly correlation_id: string;
  readonly state: SettlementState;
}
export interface StopParams {
  readonly session: string;
  readonly cleanup_scope_id: string;
  readonly remaining_budget_nanos: string;
}
export interface CleanupDiagnostic {
  readonly code: string;
  readonly detail: string;
}
export type StopHookOutcome = "not_declared" | "completed" | "failed";
export interface StoppedResult {
  readonly session: string;
  readonly cleanup_scope_id: string;
  readonly hook: StopHookOutcome;
  readonly diagnostics: readonly CleanupDiagnostic[];
}

const TOKEN = /^[A-Za-z0-9._@/:-]{1,256}$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const REQUIREMENT_ID = /^[a-z][a-z0-9_]{0,63}$/;

export function defaultAuthoringLimits(): AuthoringLimits {
  return {
    max_frame_bytes: DEFAULT_MAX_FRAME_BYTES,
    max_active_invocations: 32,
    max_active_outbound_calls: 32,
    max_queued_calls: 32,
    max_unfinished_executions: 32,
    max_retired_ids: 1_024,
  };
}

export function validateInitialize(
  value: unknown,
): asserts value is InitializeParams {
  const input = object(value, "initialize");
  exact(input, [
    "api_version",
    "identity",
    "config",
    "required_declarations",
    "routes",
    "provided_endpoints",
    "limits",
  ]);
  if (input.api_version !== AUTHORING_API_VERSION)
    fail("unsupported Authoring API version");
  validateIdentity(input.identity);
  validateLimits(input.limits);
  const declarations = array(
    input.required_declarations,
    "required_declarations",
  );
  const routes = array(input.routes, "routes");
  const endpoints = array(input.provided_endpoints, "provided_endpoints");
  const byId = new Map<string, Record<string, unknown>>();
  let previous = "";
  for (const candidate of declarations) {
    const declaration = object(candidate, "requirement declaration");
    exact(declaration, [
      "requirement_id",
      "capability_id",
      "descriptor_version",
      "descriptor_digest",
      "cardinality",
    ]);
    descriptor(declaration);
    const id = requirementIdValue(declaration.requirement_id);
    if (id <= previous) fail("required_declarations must be sorted and unique");
    previous = id;
    if (!["one", "optional", "many"].includes(String(declaration.cardinality)))
      fail("unknown requirement cardinality");
    byId.set(id, declaration);
  }
  const counts = new Map<string, number>();
  const orders = new Map<string, number>();
  const routeIds = new Set<string>();
  const providers = new Set<string>();
  let previousRoute: readonly [string, number, string] | undefined;
  for (const candidate of routes) {
    const route = object(candidate, "route");
    exact(route, [
      "route_id",
      "requirement_id",
      "capability_id",
      "descriptor_version",
      "descriptor_digest",
      "provider_instance",
      "provider_order",
    ]);
    descriptor(route);
    const routeId = token(route.route_id, "route_id");
    if (routeIds.has(routeId)) fail("route_id must be unique within a session");
    routeIds.add(routeId);
    const requirementId = requirementIdValue(route.requirement_id);
    const provider = token(route.provider_instance, "provider_instance");
    const declaration = byId.get(requirementId);
    if (!declaration) fail("route references an unknown requirement_id");
    if (
      route.capability_id !== declaration.capability_id ||
      route.descriptor_version !== declaration.descriptor_version ||
      route.descriptor_digest !== declaration.descriptor_digest
    )
      fail("route descriptor does not match its named requirement");
    const expected = orders.get(requirementId) ?? 0;
    const providerOrder = integer(
      route.provider_order,
      "provider_order",
      0,
      1_048_576,
    );
    const sortKey = [requirementId, providerOrder, provider] as const;
    if (previousRoute && compareRoute(previousRoute, sortKey) >= 0)
      fail(
        "routes must be sorted by requirement_id, provider_order and provider_instance",
      );
    previousRoute = sortKey;
    if (providerOrder !== expected)
      fail("requirement routes must use contiguous provider_order values");
    const providerKey = `${requirementId}\0${provider}`;
    if (providers.has(providerKey))
      fail("one requirement cannot bind the same provider twice");
    providers.add(providerKey);
    orders.set(requirementId, expected + 1);
    counts.set(requirementId, (counts.get(requirementId) ?? 0) + 1);
  }
  for (const [id, declaration] of byId) {
    const count = counts.get(id) ?? 0;
    if (declaration.cardinality === "one" && count !== 1)
      fail("one requirement must bind exactly one route");
    if (declaration.cardinality === "optional" && count > 1)
      fail("optional requirement may bind at most one route");
  }
  previous = "";
  for (const candidate of endpoints) {
    const endpoint = object(candidate, "provided endpoint");
    exact(endpoint, [
      "endpoint_id",
      "capability_id",
      "descriptor_version",
      "descriptor_digest",
    ]);
    descriptor(endpoint);
    const id = token(endpoint.endpoint_id, "endpoint_id");
    if (id <= previous) fail("provided_endpoints must be sorted and unique");
    previous = id;
  }
}

export function validateInitializeForRuntimeProfile(
  value: unknown,
  expected: string,
): asserts value is InitializeParams {
  validateInitialize(value);
  if (value.identity.runtime_profile !== expected)
    fail("runtime profile does not match the selected Adapter profile");
}

export function validateInitialized(
  value: unknown,
  expected: InitializeParams,
): asserts value is InitializedResult {
  validateInitialize(value);
  if (canonicalJson(value) !== canonicalJson(expected))
    fail("initialized result does not exactly echo initialization");
}

export function validateInvocationScope(
  value: unknown,
): asserts value is InvocationScope {
  const scope = object(value, "invocation scope");
  exact(scope, [
    "scope_id",
    "parent_scope_id",
    "remaining_budget_nanos",
    "permissions",
    "extensions",
  ]);
  token(scope.scope_id, "scope_id");
  if (scope.parent_scope_id !== null)
    token(scope.parent_scope_id, "parent_scope_id");
  decimal(scope.remaining_budget_nanos, "remaining_budget_nanos");
  sortedTokens(scope.permissions, "permissions");
  const extensions = array(scope.extensions, "extensions");
  let previous = "";
  for (const candidate of extensions) {
    const extension = object(candidate, "extension");
    validateExtension(extension);
    const key = token(extension.key, "extension key");
    if (key <= previous) fail("extensions must be sorted and unique");
    previous = key;
  }
}

export function validateInvoke(
  value: unknown,
  initialize: InitializeParams,
): asserts value is InvokeParams {
  validateAuthoringMessage(value, "invoke", initialize.identity);
  const invoke = value as InvokeParams;
  const endpoint = initialize.provided_endpoints.find(
    (candidate) => candidate.endpoint_id === invoke.endpoint_id,
  );
  if (!endpoint) fail("invoke references an unknown endpoint_id");
  if (
    endpoint.capability_id !== invoke.capability_id ||
    endpoint.descriptor_version !== invoke.descriptor_version ||
    endpoint.descriptor_digest !== invoke.descriptor_digest
  )
    fail("invoke descriptor does not match its admitted endpoint");
}

export function validateOutboundCall(
  value: unknown,
  initialize: InitializeParams,
  parent: InvocationScope,
  parentActive: boolean,
): asserts value is OutboundCallParams {
  validateAuthoringMessage(value, "outbound_call", initialize.identity, parent);
  if (!parentActive) fail("closed parent scope cannot start an outbound call");
  const call = value as OutboundCallParams;
  const route = initialize.routes.find(
    (candidate) => candidate.route_id === call.route_id,
  );
  if (!route) fail("outbound call references an unknown route_id");
  if (route.requirement_id !== call.requirement_id)
    fail("outbound route belongs to another requirement");
}

export function validateEventPublish(
  value: unknown,
  initialize: InitializeParams,
): asserts value is EventPublishParams {
  validateAuthoringMessage(value, "event_publish", initialize.identity);
  validateProvidedOperation(
    value as EventPublishParams,
    initialize,
    "event publication",
  );
}

export function validateOutboundEventPublish(
  value: unknown,
  initialize: InitializeParams,
  parent: InvocationScope,
  parentActive: boolean,
): asserts value is OutboundEventPublishParams {
  validateAuthoringMessage(value, "outbound_event_publish", initialize.identity, parent);
  validateOutboundOperation(
    value as OutboundEventPublishParams,
    initialize,
    parentActive,
    "event publication",
  );
}

export function validateEventPublishResultFor(
  value: unknown,
  identity: SessionIdentity,
  correlationId: string,
): asserts value is EventPublishResult {
  validateAuthoringMessage(value, "event_publish_result", identity);
  if ((value as EventPublishResult).correlation_id !== correlationId)
    fail("response identity mismatch");
}

export function validateStreamOpen(
  value: unknown,
  initialize: InitializeParams,
): asserts value is StreamOpenParams {
  validateAuthoringMessage(value, "stream_open", initialize.identity);
  validateProvidedOperation(value as StreamOpenParams, initialize, "stream open");
}

export function validateOutboundStreamOpen(
  value: unknown,
  initialize: InitializeParams,
  parent: InvocationScope,
  parentActive: boolean,
): asserts value is OutboundStreamOpenParams {
  validateAuthoringMessage(value, "outbound_stream_open", initialize.identity, parent);
  validateOutboundOperation(
    value as OutboundStreamOpenParams,
    initialize,
    parentActive,
    "stream open",
  );
}

export function validateStreamOpenResultFor(
  value: unknown,
  identity: SessionIdentity,
  correlationId: string,
): asserts value is StreamOpenResult {
  validateAuthoringMessage(value, "stream_open_result", identity);
  if ((value as StreamOpenResult).correlation_id !== correlationId)
    fail("response identity mismatch");
}

export function validateStreamAction(
  value: unknown,
  identity: SessionIdentity,
  kind: "stream_send" | "stream_receive" | "stream_close_send" | "stream_cancel",
): asserts value is StreamSendParams | StreamReceiveParams {
  validateAuthoringMessage(value, kind, identity);
}

export function validateStreamResultFor(
  value: unknown,
  identity: SessionIdentity,
  correlationId: string,
  streamId: string,
  kind: "stream_action_result" | "stream_receive_result",
): asserts value is StreamActionResult | StreamReceiveResult {
  validateAuthoringMessage(value, kind, identity);
  const result = value as StreamActionResult | StreamReceiveResult;
  if (result.correlation_id !== correlationId) fail("response identity mismatch");
  if (result.stream_id !== streamId) fail("stream result identity mismatch");
}

export function validateResultFor(
  value: unknown,
  identity: SessionIdentity,
  correlationId: string,
): asserts value is InvocationResult {
  validateAuthoringMessage(value, "result", identity);
  if ((value as InvocationResult).correlation_id !== correlationId)
    fail("response identity mismatch");
}

export function validateChildScope(
  value: unknown,
  parent: InvocationScope,
): asserts value is InvocationScope {
  validateInvocationScope(value);
  validateInvocationScope(parent);
  if (value.parent_scope_id !== parent.scope_id)
    fail("outbound scope must name its exact parent scope");
  if (
    BigInt(value.remaining_budget_nanos) > BigInt(parent.remaining_budget_nanos)
  )
    fail("outbound remaining budget may not increase");
  if (
    canonicalJson(value.permissions) !== canonicalJson(parent.permissions) ||
    canonicalJson(value.extensions) !== canonicalJson(parent.extensions)
  )
    fail("outbound scope must preserve permissions and extensions");
}

export function validateAuthoringMessage(
  value: unknown,
  kind:
    | "construct"
    | "constructed"
    | "invoke"
    | "result"
    | "outbound_call"
    | "event_publish"
    | "outbound_event_publish"
    | "event_publish_result"
    | "stream_open"
    | "outbound_stream_open"
    | "stream_open_result"
    | "stream_send"
    | "stream_receive"
    | "stream_close_send"
    | "stream_cancel"
    | "stream_action_result"
    | "stream_receive_result"
    | "cancel"
    | "cancel_ack"
    | "settlement"
    | "stop"
    | "stopped",
  identity: SessionIdentity,
  parent?: InvocationScope,
): void {
  validateIdentity(identity);
  const message = object(value, kind);
  const session = token(message.session, "session");
  if (session !== identity.session)
    fail("message session does not match admitted session");
  switch (kind) {
    case "construct":
      exact(message, [
        "session",
        "lifecycle_scope_id",
        "remaining_budget_nanos",
      ]);
      token(message.lifecycle_scope_id, "lifecycle_scope_id");
      decimal(message.remaining_budget_nanos, "remaining_budget_nanos");
      return;
    case "constructed":
      exact(message, ["session", "lifecycle_scope_id", "outcome"]);
      token(message.lifecycle_scope_id, "lifecycle_scope_id");
      validateOutcome(message.outcome, true);
      return;
    case "invoke":
      exact(message, [
        "session",
        "correlation_id",
        "endpoint_id",
        "capability_id",
        "descriptor_version",
        "descriptor_digest",
        "operation",
        "scope",
        "payload",
      ]);
      decimal(message.correlation_id, "correlation_id");
      token(message.endpoint_id, "endpoint_id");
      descriptor(message);
      token(message.operation, "operation");
      validateInvocationScope(message.scope);
      return;
    case "result":
      exact(message, ["session", "correlation_id", "outcome"]);
      decimal(message.correlation_id, "correlation_id");
      validateOutcome(message.outcome, false);
      return;
    case "outbound_call":
      exact(message, [
        "session",
        "correlation_id",
        "requirement_id",
        "route_id",
        "operation",
        "scope",
        "payload",
      ]);
      decimal(message.correlation_id, "correlation_id");
      requirementIdValue(message.requirement_id);
      token(message.route_id, "route_id");
      token(message.operation, "operation");
      if (!parent) fail("outbound call requires its parent scope");
      validateChildScope(message.scope, parent);
      return;
    case "event_publish":
      validateProvidedWireOperation(message, "event");
      return;
    case "outbound_event_publish":
      validateOutboundWireOperation(message, "event", parent);
      return;
    case "event_publish_result": {
      exact(message, ["session", "correlation_id", "outcome"]);
      decimal(message.correlation_id, "correlation_id");
      const outcome = object(message.outcome, "event publish outcome");
      if (outcome.kind === "accepted") exact(outcome, ["kind"]);
      else if (outcome.kind === "runtime") {
        exact(outcome, ["kind", "failure"]);
        validateRuntimeFailure(outcome.failure);
      } else fail("unknown event publish outcome");
      return;
    }
    case "stream_open":
      validateProvidedWireOperation(message, "request");
      return;
    case "outbound_stream_open":
      validateOutboundWireOperation(message, "request", parent);
      return;
    case "stream_open_result": {
      exact(message, ["session", "correlation_id", "outcome"]);
      decimal(message.correlation_id, "correlation_id");
      const outcome = object(message.outcome, "stream open outcome");
      if (outcome.kind === "opened") {
        exact(outcome, ["kind", "stream_id"]);
        decimal(outcome.stream_id, "stream_id");
      } else if (outcome.kind === "domain") exact(outcome, ["kind", "error"]);
      else if (outcome.kind === "runtime") {
        exact(outcome, ["kind", "failure"]);
        validateRuntimeFailure(outcome.failure);
      } else fail("unknown stream open outcome");
      return;
    }
    case "stream_send":
      exact(message, ["session", "correlation_id", "stream_id", "sequence", "message"]);
      validateStreamWireIdentity(message);
      decimal(message.sequence, "sequence");
      return;
    case "stream_receive":
    case "stream_close_send":
    case "stream_cancel":
      exact(message, ["session", "correlation_id", "stream_id"]);
      validateStreamWireIdentity(message);
      return;
    case "stream_action_result": {
      exact(message, ["session", "correlation_id", "stream_id", "outcome"]);
      validateStreamWireIdentity(message);
      const outcome = object(message.outcome, "stream action outcome");
      if (outcome.kind === "accepted") exact(outcome, ["kind"]);
      else if (outcome.kind === "runtime") {
        exact(outcome, ["kind", "failure"]);
        validateRuntimeFailure(outcome.failure);
      } else fail("unknown stream action outcome");
      return;
    }
    case "stream_receive_result": {
      exact(message, ["session", "correlation_id", "stream_id", "outcome"]);
      validateStreamWireIdentity(message);
      validateStreamReceiveOutcome(message.outcome);
      return;
    }
    case "cancel":
      exact(message, ["session", "scope_id", "correlation_id", "reason"]);
      token(message.scope_id, "scope_id");
      decimal(message.correlation_id, "correlation_id");
      detail(message.reason);
      return;
    case "cancel_ack":
      exact(message, ["session", "scope_id", "correlation_id", "accepted"]);
      token(message.scope_id, "scope_id");
      decimal(message.correlation_id, "correlation_id");
      if (message.accepted !== true)
        fail("cancel acknowledgement must be accepted");
      return;
    case "settlement":
      exact(message, ["session", "scope_id", "correlation_id", "state"]);
      token(message.scope_id, "scope_id");
      decimal(message.correlation_id, "correlation_id");
      if (
        !["completed", "cancelled", "abandoned"].includes(String(message.state))
      )
        fail("unknown settlement state");
      return;
    case "stop":
      exact(message, ["session", "cleanup_scope_id", "remaining_budget_nanos"]);
      token(message.cleanup_scope_id, "cleanup_scope_id");
      decimal(message.remaining_budget_nanos, "remaining_budget_nanos");
      return;
    case "stopped":
      exact(message, ["session", "cleanup_scope_id", "hook", "diagnostics"]);
      token(message.cleanup_scope_id, "cleanup_scope_id");
      if (
        !["not_declared", "completed", "failed"].includes(String(message.hook))
      )
        fail("unknown stop hook outcome");
      for (const candidate of array(message.diagnostics, "diagnostics")) {
        const diagnostic = object(candidate, "diagnostic");
        exact(diagnostic, ["code", "detail"]);
        token(diagnostic.code, "diagnostic code");
        detail(diagnostic.detail);
      }
      return;
  }
}

export function parseAuthoringFrame(
  wire: string,
  maxBytes: number = DEFAULT_MAX_FRAME_BYTES,
): unknown {
  if (new TextEncoder().encode(wire).byteLength > maxBytes)
    fail("Authoring frame exceeds max_frame_bytes");
  return parseStrictJson(wire);
}

function validateProvidedOperation(
  value: EventPublishParams | StreamOpenParams,
  initialize: InitializeParams,
  interaction: string,
): void {
  const endpoint = initialize.provided_endpoints.find(
    (candidate) => candidate.endpoint_id === value.endpoint_id,
  );
  if (!endpoint) fail(`${interaction} references an unknown endpoint_id`);
  if (
    endpoint.capability_id !== value.capability_id ||
    endpoint.descriptor_version !== value.descriptor_version ||
    endpoint.descriptor_digest !== value.descriptor_digest
  )
    fail(`${interaction} descriptor does not match its admitted endpoint`);
}

function validateOutboundOperation(
  value: OutboundEventPublishParams | OutboundStreamOpenParams,
  initialize: InitializeParams,
  parentActive: boolean,
  interaction: string,
): void {
  if (!parentActive)
    fail(`closed parent scope cannot start an outbound ${interaction}`);
  const route = initialize.routes.find(
    (candidate) => candidate.route_id === value.route_id,
  );
  if (!route) fail(`outbound ${interaction} references an unknown route_id`);
  if (route.requirement_id !== value.requirement_id)
    fail("outbound route belongs to another requirement");
}

function validateProvidedWireOperation(
  message: Record<string, unknown>,
  valueField: "event" | "request",
): void {
  exact(message, [
    "session",
    "correlation_id",
    "endpoint_id",
    "capability_id",
    "descriptor_version",
    "descriptor_digest",
    "operation",
    "scope",
    valueField,
  ]);
  decimal(message.correlation_id, "correlation_id");
  token(message.endpoint_id, "endpoint_id");
  descriptor(message);
  token(message.operation, "operation");
  validateInvocationScope(message.scope);
}

function validateOutboundWireOperation(
  message: Record<string, unknown>,
  valueField: "event" | "request",
  parent: InvocationScope | undefined,
): void {
  exact(message, [
    "session",
    "correlation_id",
    "requirement_id",
    "route_id",
    "operation",
    "scope",
    valueField,
  ]);
  decimal(message.correlation_id, "correlation_id");
  requirementIdValue(message.requirement_id);
  token(message.route_id, "route_id");
  token(message.operation, "operation");
  if (!parent) fail("outbound operation requires its parent scope");
  validateChildScope(message.scope, parent);
}

function validateStreamWireIdentity(message: Record<string, unknown>): void {
  decimal(message.correlation_id, "correlation_id");
  decimal(message.stream_id, "stream_id");
}

function validateStreamReceiveOutcome(value: unknown): void {
  const outcome = object(value, "stream receive outcome");
  if (outcome.kind === "message") {
    exact(outcome, ["kind", "sequence", "message"]);
    decimal(outcome.sequence, "sequence");
    return;
  }
  if (outcome.kind === "peer_half_closed") {
    exact(outcome, ["kind"]);
    return;
  }
  if (outcome.kind === "terminal") {
    exact(outcome, ["kind", "outcome"]);
    const terminal = object(outcome.outcome, "stream terminal outcome");
    if (terminal.kind === "success") exact(terminal, ["kind"]);
    else if (terminal.kind === "domain") exact(terminal, ["kind", "error"]);
    else fail("unknown stream terminal outcome");
    return;
  }
  if (outcome.kind === "runtime") {
    exact(outcome, ["kind", "failure"]);
    validateRuntimeFailure(outcome.failure);
    return;
  }
  fail("unknown stream receive outcome");
}

function validateIdentity(value: unknown): asserts value is SessionIdentity {
  const identity = object(value, "session identity");
  exact(identity, [
    "session",
    "plugin_instance",
    "plugin_generation",
    "artifact_digest",
    "contract_digest",
    "runtime_profile",
    "value_profile",
  ]);
  token(identity.session, "session");
  token(identity.plugin_instance, "plugin_instance");
  decimal(identity.plugin_generation, "plugin_generation");
  digest(identity.artifact_digest, "artifact_digest");
  digest(identity.contract_digest, "contract_digest");
  token(identity.runtime_profile, "runtime_profile");
  if (identity.value_profile !== VALUE_PROFILE)
    fail("unsupported portable value profile");
}
function validateLimits(value: unknown): asserts value is AuthoringLimits {
  const limits = object(value, "limits");
  exact(limits, [
    "max_frame_bytes",
    "max_active_invocations",
    "max_active_outbound_calls",
    "max_queued_calls",
    "max_unfinished_executions",
    "max_retired_ids",
  ]);
  integer(
    limits.max_frame_bytes,
    "max_frame_bytes",
    1,
    DEFAULT_MAX_FRAME_BYTES,
  );
  integer(limits.max_active_invocations, "max_active_invocations", 1, 1_024);
  integer(
    limits.max_active_outbound_calls,
    "max_active_outbound_calls",
    1,
    1_024,
  );
  integer(limits.max_queued_calls, "max_queued_calls", 1, 65_536);
  integer(
    limits.max_unfinished_executions,
    "max_unfinished_executions",
    1,
    65_536,
  );
  integer(limits.max_retired_ids, "max_retired_ids", 1, 1_048_576);
}
function validateOutcome(value: unknown, factory: boolean): void {
  const outcome = object(value, "outcome");
  const kind = String(outcome.kind);
  if (factory) {
    if (kind === "constructed") {
      exact(outcome, ["kind"]);
      return;
    }
    if (kind === "failed") {
      exact(outcome, ["kind", "detail"]);
      detail(outcome.detail);
      return;
    }
    fail("unknown factory outcome");
  }
  if (kind === "success") {
    exact(outcome, ["kind", "value"]);
    return;
  }
  if (kind === "domain") {
    exact(outcome, ["kind", "error"]);
    return;
  }
  if (kind === "runtime") {
    exact(outcome, ["kind", "failure"]);
    validateRuntimeFailure(outcome.failure);
    return;
  }
  fail("unknown invocation outcome");
}
function validateRuntimeFailure(
  value: unknown,
): asserts value is RuntimeFailure {
  const failure = object(value, "runtime failure");
  const kind = String(failure.kind);
  switch (kind) {
    case "unavailable":
    case "protocol_violation":
      exact(failure, ["kind", "capability"]);
      token(failure.capability, "capability");
      return;
    case "unknown_operation":
    case "resource_exhausted":
      exact(failure, ["kind", "capability", "operation"]);
      token(failure.capability, "capability");
      token(failure.operation, "operation");
      return;
    case "ambiguous_binding":
      exact(failure, ["kind", "capability", "providers"]);
      token(failure.capability, "capability");
      integer(failure.providers, "providers", 1, 1_048_576);
      return;
    case "missing_plugin_factory":
      exact(failure, ["kind", "instance", "package_id"]);
      token(failure.instance, "instance");
      token(failure.package_id, "package_id");
      return;
    case "unavailable_execution_class":
      exact(failure, ["kind", "instance_key", "execution_class"]);
      token(failure.instance_key, "instance_key");
      token(failure.execution_class, "execution_class");
      return;
    case "invalid_resolved_plan":
    case "internal":
    case "plugin_failure":
      exact(failure, ["kind", "detail"]);
      detail(failure.detail);
      return;
    case "admission_closed":
      exact(failure, ["kind"]);
      return;
    case "deadline_exceeded":
    case "cancelled":
      exact(failure, ["kind", "request_id"]);
      decimal(failure.request_id, "request_id");
      return;
    case "plugin_restart_exhausted":
      exact(failure, ["kind", "instance", "attempts"]);
      token(failure.instance, "instance");
      integer(failure.attempts, "attempts", 1, 1_048_576);
      return;
    default:
      fail("unknown runtime failure kind");
  }
}
function descriptor(value: Record<string, unknown>): void {
  token(value.capability_id, "capability_id");
  token(value.descriptor_version, "descriptor_version");
  digest(value.descriptor_digest, "descriptor_digest");
}
function requirementIdValue(value: unknown): string {
  if (typeof value !== "string" || !REQUIREMENT_ID.test(value))
    fail("requirement_id must match ^[a-z][a-z0-9_]{0,63}$");
  return value;
}
function compareRoute(
  left: readonly [string, number, string],
  right: readonly [string, number, string],
): number {
  return (
    left[0].localeCompare(right[0]) ||
    left[1] - right[1] ||
    left[2].localeCompare(right[2])
  );
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}
function object(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail(`${name} must be an object`);
  return value as Record<string, unknown>;
}
function array(value: unknown, name: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(`${name} must be an array`);
  return value;
}
function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  )
    fail("object contains missing or unknown fields");
}
function token(value: unknown, name: string): string {
  if (typeof value !== "string" || !TOKEN.test(value))
    fail(`${name} must be a portable token`);
  return value;
}
function decimal(value: unknown, name: string): string {
  if (typeof value !== "string" || !DECIMAL.test(value))
    fail(`${name} must be a canonical decimal string`);
  try {
    const parsed = BigInt(value);
    if (parsed > 18_446_744_073_709_551_615n)
      fail(`${name} exceeds unsigned 64-bit range`);
  } catch {
    fail(`${name} must be a canonical decimal string`);
  }
  return value;
}
function digest(value: unknown, name: string): void {
  if (typeof value !== "string" || !DIGEST.test(value))
    fail(`${name} must be a canonical SHA-256 digest`);
}
function integer(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < minimum ||
    Number(value) > maximum
  )
    fail(`${name} must be within ${minimum}..=${maximum}`);
  return Number(value);
}
function sortedTokens(value: unknown, name: string): void {
  const values = array(value, name);
  let previous = "";
  for (const candidate of values) {
    const current = token(candidate, name);
    if (current <= previous) fail(`${name} must be sorted and unique`);
    previous = current;
  }
}
function detail(value: unknown): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    new TextEncoder().encode(value).byteLength > 1_024
  )
    fail("detail must contain 1..=1024 bytes");
}
function fail(message: string): never {
  throw new Error(message);
}
