import { decodeBase64Url32, encodeBase64Url, handshakeProofPayload } from "./proof.js";
import {
  PROCESS_PROFILE,
  PROVIDE_REQUEST_PROFILE,
  VALUE_PROFILE,
  type CancelParams,
  type CapabilityDescriptor,
  type ControlAck,
  type HandshakeIdentity,
  type HandshakeParams,
  type HandshakeResult,
  type InvocationExtension,
  type JsonRpcRequest,
  type JsonRpcError,
  type JsonRpcSuccess,
  type PeerLimits,
  type RequestParams,
  type RequestResult,
  type ReadinessRecord,
  type ShutdownParams,
} from "./types.js";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/;
const TOKEN = /^[A-Za-z0-9._@/:-]{1,256}$/;
// serde_json's 128-level recursion limit includes the scalar leaf, so peers
// accept at most 127 nested object/array containers.
const MAX_STRICT_JSON_NESTING = 127;

/** Parses JSON after rejecting duplicate object keys at every nesting level. */
export function parseStrictJson(wire: string): unknown {
  try {
    new StrictJsonScanner(wire).scan();
    return JSON.parse(wire) as unknown;
  } catch {
    throw new Error("invalid strict JSON");
  }
}

/** Validates the dedicated one-line readiness record. */
export function validateReadinessRecord(value: unknown): asserts value is ReadinessRecord {
  const readiness = record(value, "readiness record");
  exactKeys(readiness, ["protocol", "data_port", "control_port"]);
  if (readiness.protocol !== PROCESS_PROFILE) {
    throw new Error("unsupported Process Protocol profile");
  }
  const dataPort = port(readiness.data_port, "data_port");
  const controlPort = port(readiness.control_port, "control_port");
  if (dataPort === controlPort) throw new Error("readiness listeners must be distinct");
}

/** Validates the exact immutable handshake identity. */
export function validateHandshakeIdentity(value: unknown): asserts value is HandshakeIdentity {
  const identity = record(value, "handshake identity");
  exactKeys(identity, [
    "protocol_profile",
    "value_profile",
    "plugin_instance",
    "plugin_generation",
    "generation_spec_digest",
    "artifact_digest",
    "effective_host_grant_set_digest",
    "interaction_profiles",
    "provided_capabilities",
    "outbound_bindings",
    "peer_limits",
  ]);
  if (identity.protocol_profile !== PROCESS_PROFILE) {
    throw new Error("unsupported Process Protocol profile");
  }
  if (identity.value_profile !== VALUE_PROFILE) {
    throw new Error("unsupported portable value profile");
  }
  token(identity.plugin_instance, "plugin_instance");
  decimal(identity.plugin_generation, "plugin_generation");
  digest(identity.generation_spec_digest, "generation_spec_digest");
  digest(identity.artifact_digest, "artifact_digest");
  digest(
    identity.effective_host_grant_set_digest,
    "effective_host_grant_set_digest",
  );
  const profiles = stringArray(identity.interaction_profiles, "interaction_profiles");
  sortedUnique(profiles, "interaction_profiles", (profile) => profile);
  if (profiles.length !== 1 || profiles[0] !== PROVIDE_REQUEST_PROFILE) {
    throw new Error("V1 requires exactly the provide-request-v1 interaction profile");
  }
  if (!Array.isArray(identity.provided_capabilities) || identity.provided_capabilities.length === 0) {
    throw new Error("at least one provided Capability is required");
  }
  for (const descriptor of identity.provided_capabilities) {
    validateCapabilityDescriptor(descriptor);
  }
  sortedUnique(
    identity.provided_capabilities as readonly CapabilityDescriptor[],
    "provided_capabilities",
    (descriptor) => descriptor.capability_id,
  );
  if (!Array.isArray(identity.outbound_bindings)) {
    throw new Error("outbound_bindings must be an array");
  }
  if (identity.outbound_bindings.length !== 0) {
    throw new Error("outbound bindings require a selected consume profile");
  }
  validatePeerLimits(identity.peer_limits);
}

/** Validates host handshake params, including canonical nonce and proof encodings. */
export function validateHandshakeParams(value: unknown): asserts value is HandshakeParams {
  const params = record(value, "handshake params");
  exactKeys(params, ["identity", "host_nonce", "host_proof"]);
  validateHandshakeIdentity(params.identity);
  decodeBase64Url32(string(params.host_nonce, "host_nonce"), "host_nonce");
  decodeBase64Url32(string(params.host_proof, "host_proof"), "host_proof");
}

/** Validates an accepted child handshake against the exact expected identity. */
export function validateHandshakeResult(
  value: unknown,
  expected: HandshakeIdentity,
): asserts value is HandshakeResult {
  const result = record(value, "handshake result");
  exactKeys(result, ["identity", "session", "child_proof"]);
  validateHandshakeIdentity(result.identity);
  if (!sameIdentity(result.identity as unknown as HandshakeIdentity, expected)) {
    throw new Error("child handshake identity mismatch");
  }
  decodeBase64Url32(string(result.session, "session"), "session");
  decodeBase64Url32(string(result.child_proof, "child_proof"), "child_proof");
}

/** Validates host-owned request fields before Capability payload Schema decoding. */
export function validateRequestParams(value: unknown): asserts value is RequestParams {
  const params = record(value, "request params");
  exactKeys(params, [
    "session",
    "correlation_id",
    "capability_id",
    "descriptor_version",
    "descriptor_digest",
    "operation",
    "interaction",
    "caller_instance",
    "remaining_timeout_nanos",
    "extensions",
    "payload",
  ]);
  decodeBase64Url32(string(params.session, "session"), "session");
  decimal(params.correlation_id, "correlation_id");
  token(params.capability_id, "capability_id");
  token(params.descriptor_version, "descriptor_version");
  digest(params.descriptor_digest, "descriptor_digest");
  token(params.operation, "operation");
  if (params.interaction !== "request") throw new Error("interaction must be request");
  nullableToken(params.caller_instance, "caller_instance");
  nullableDecimal(params.remaining_timeout_nanos, "remaining_timeout_nanos");
  if (!Array.isArray(params.extensions)) throw new Error("extensions must be an array");
  for (const extension of params.extensions) validateExtension(extension);
  sortedUnique(
    params.extensions as readonly InvocationExtension[],
    "extensions",
    (extension) => extension.key,
  );
}

/** Validates child result identity and the narrow child Runtime Failure surface. */
export function validateRequestResult(value: unknown): asserts value is RequestResult {
  const result = record(value, "request result");
  exactKeys(result, ["session", "correlation_id", "outcome"]);
  decodeBase64Url32(string(result.session, "session"), "session");
  decimal(result.correlation_id, "correlation_id");
  const outcome = record(result.outcome, "request outcome");
  const kind = string(outcome.kind, "outcome kind");
  if (kind === "success") {
    exactKeys(outcome, ["kind", "value"]);
    return;
  }
  if (kind === "domain") {
    exactKeys(outcome, ["kind", "error"]);
    return;
  }
  if (kind !== "runtime") throw new Error("unknown request outcome kind");
  exactKeys(outcome, ["kind", "failure"]);
  const failure = record(outcome.failure, "child Runtime Failure");
  const failureKind = string(failure.kind, "child Runtime Failure kind");
  if (failureKind === "resource_exhausted") {
    exactKeys(failure, ["kind", "operation"]);
    token(failure.operation, "operation");
    return;
  }
  if (failureKind === "plugin_failure") {
    exactKeys(failure, ["kind", "detail"]);
    const detail = string(failure.detail, "Plugin Failure detail");
    if (detail.length === 0 || new TextEncoder().encode(detail).length > 1024) {
      throw new Error("Plugin Failure detail must contain 1..=1024 bytes");
    }
    return;
  }
  throw new Error("child Runtime Failure kind is host-authoritative or unknown");
}

export function validateCancelParams(value: unknown): asserts value is CancelParams {
  const params = record(value, "cancel params");
  exactKeys(params, ["session", "correlation_id"]);
  decodeBase64Url32(string(params.session, "session"), "session");
  decimal(params.correlation_id, "correlation_id");
}

export function validateShutdownParams(value: unknown): asserts value is ShutdownParams {
  const params = record(value, "shutdown params");
  exactKeys(params, ["session"]);
  decodeBase64Url32(string(params.session, "session"), "session");
}

export function validateControlAck(value: unknown): asserts value is ControlAck {
  const result = record(value, "control acknowledgement");
  exactKeys(result, ["session", "accepted"]);
  decodeBase64Url32(string(result.session, "session"), "session");
  if (result.accepted !== true) throw new Error("control acknowledgement must be accepted");
}

export function validateJsonRpcRequest<T>(
  value: unknown,
  expectedMethod: string,
  validateParams: (params: unknown) => asserts params is T,
): asserts value is JsonRpcRequest<T> {
  const envelope = record(value, "JSON-RPC request");
  exactKeys(envelope, ["jsonrpc", "id", "method", "params"]);
  if (envelope.jsonrpc !== "2.0") throw new Error("jsonrpc must equal 2.0");
  decimal(envelope.id, "JSON-RPC id");
  if (envelope.method !== expectedMethod) throw new Error("unexpected JSON-RPC method");
  validateParams(envelope.params);
}

export function validateJsonRpcSuccess<T>(
  value: unknown,
  expectedId: string,
  validateResult: (result: unknown) => asserts result is T,
): asserts value is JsonRpcSuccess<T> {
  const envelope = record(value, "JSON-RPC success");
  exactKeys(envelope, ["jsonrpc", "id", "result"]);
  if (envelope.jsonrpc !== "2.0") throw new Error("jsonrpc must equal 2.0");
  decimal(envelope.id, "JSON-RPC id");
  if (envelope.id !== expectedId) throw new Error("JSON-RPC response id mismatch");
  validateResult(envelope.result);
}

export function validateJsonRpcError(value: unknown): asserts value is JsonRpcError {
  const envelope = record(value, "JSON-RPC error");
  exactKeys(envelope, ["jsonrpc", "id", "error"]);
  if (envelope.jsonrpc !== "2.0") throw new Error("jsonrpc must equal 2.0");
  if (envelope.id !== null) decimal(envelope.id, "JSON-RPC id");
  const error = record(envelope.error, "JSON-RPC error object");
  exactKeys(error, ["code", "message"]);
  if (![-32700, -32600, -32601, -32602, -32603].includes(Number(error.code))) {
    throw new Error("unsupported JSON-RPC error code");
  }
  const message = string(error.message, "JSON-RPC error message");
  const length = new TextEncoder().encode(message).length;
  if (length === 0 || length > 256) {
    throw new Error("JSON-RPC error message must contain 1..=256 bytes");
  }
}

function sameIdentity(left: HandshakeIdentity, right: HandshakeIdentity): boolean {
  const zero = encodeBase64Url(new Uint8Array(32));
  const leftBytes = handshakeProofPayload({ identity: left, host_nonce: zero, host_proof: zero });
  const rightBytes = handshakeProofPayload({ identity: right, host_nonce: zero, host_proof: zero });
  return leftBytes.length === rightBytes.length && leftBytes.every((byte, index) => byte === rightBytes[index]);
}

function validateCapabilityDescriptor(value: unknown): asserts value is CapabilityDescriptor {
  const descriptor = record(value, "Capability Descriptor");
  exactKeys(descriptor, [
    "capability_id",
    "descriptor_version",
    "descriptor_digest",
    "operations",
  ]);
  token(descriptor.capability_id, "capability_id");
  token(descriptor.descriptor_version, "descriptor_version");
  digest(descriptor.descriptor_digest, "descriptor_digest");
  if (!Array.isArray(descriptor.operations) || descriptor.operations.length === 0) {
    throw new Error("provided Capability operations cannot be empty");
  }
  for (const value of descriptor.operations) {
    const operation = record(value, "operation");
    exactKeys(operation, ["operation", "interaction"]);
    token(operation.operation, "operation");
    if (operation.interaction !== "request") {
      throw new Error("V1 provided operation interaction must be request");
    }
  }
  sortedUnique(
    descriptor.operations as readonly { readonly operation: string }[],
    "operations",
    (operation) => operation.operation,
  );
}

function validatePeerLimits(value: unknown): asserts value is PeerLimits {
  const limits = record(value, "peer limits");
  const maxima = {
    max_http_body_bytes: 1_048_576,
    max_control_http_body_bytes: 65_536,
    max_concurrent_requests: 256,
    child_request_queue_capacity: 1_024,
    max_retired_correlation_ids: 1_048_576,
    control_queue_capacity: 256,
  } as const;
  exactKeys(limits, Object.keys(maxima));
  for (const [name, maximum] of Object.entries(maxima)) {
    const candidate = limits[name];
    if (!Number.isSafeInteger(candidate) || Number(candidate) <= 0 || Number(candidate) > maximum) {
      throw new Error(`${name} must be within 1..=${maximum}`);
    }
  }
}

export function validateExtension(value: unknown): asserts value is InvocationExtension {
  const extension = record(value, "Invocation Extension");
  exactKeys(
    extension,
    ["key", "value"],
    ["issuer", "audience", "proof", "sealed"],
  );
  token(extension.key, "extension key");
  canonicalPaddedBase64(extension.value, "extension value");
  if (extension.issuer !== undefined) string(extension.issuer, "extension issuer");
  if (extension.audience !== undefined) {
    const audience = stringArray(extension.audience, "extension audience");
    sortedUnique(audience, "extension audience", (entry) => entry);
  }
  if (extension.proof !== undefined) string(extension.proof, "extension proof");
  if (extension.sealed !== undefined && typeof extension.sealed !== "boolean") {
    throw new Error("extension sealed must be boolean");
  }
}

function record(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`unknown field ${key}`);
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) throw new Error(`missing field ${key}`);
  }
}

function string(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  return value;
}

function stringArray(value: unknown, name: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${name} must be a string array`);
  }
  return value as readonly string[];
}

function token(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !TOKEN.test(value)) {
    throw new Error(`${name} must be a 1..=256 byte portable token`);
  }
}

function decimal(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    throw new Error(`${name} must be a canonical non-negative decimal string`);
  }
  try {
    const parsed = BigInt(value);
    if (parsed > 18_446_744_073_709_551_615n) throw new Error();
  } catch {
    throw new Error(`${name} exceeds the unsigned 64-bit decimal profile`);
  }
}

function nullableToken(value: unknown, name: string): void {
  if (value !== null) token(value, name);
}

function nullableDecimal(value: unknown, name: string): void {
  if (value !== null) decimal(value, name);
}

function port(value: unknown, name: string): number {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 65_535) {
    throw new Error(`${name} must be a non-zero TCP port`);
  }
  return Number(value);
}

function digest(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new Error(`${name} must be a canonical SHA-256 digest`);
  }
}

function sortedUnique<T>(values: readonly T[], name: string, key: (value: T) => string): void {
  for (let index = 1; index < values.length; index += 1) {
    const previous = key(values[index - 1] as T);
    const current = key(values[index] as T);
    if (!(previous < current)) {
      throw new Error(`${name} must be strictly canonical-sorted and unique`);
    }
  }
}

function canonicalPaddedBase64(value: unknown, name: string): void {
  if (typeof value !== "string" || value.length % 4 !== 0) {
    throw new Error(`${name} must be canonical padded Base64`);
  }
  try {
    const decoded = atob(value);
    if (btoa(decoded) !== value) throw new Error();
  } catch {
    throw new Error(`${name} must be canonical padded Base64`);
  }
}

class StrictJsonScanner {
  private index = 0;

  constructor(private readonly wire: string) {}

  scan(): void {
    this.whitespace();
    this.value(0);
    this.whitespace();
    if (this.index !== this.wire.length) throw new Error("trailing JSON input");
  }

  private value(depth: number): void {
    this.whitespace();
    const candidate = this.wire[this.index];
    if (candidate === "{") {
      if (depth >= MAX_STRICT_JSON_NESTING) throw new Error("JSON nesting is too deep");
      return this.object(depth + 1);
    }
    if (candidate === "[") {
      if (depth >= MAX_STRICT_JSON_NESTING) throw new Error("JSON nesting is too deep");
      return this.array(depth + 1);
    }
    if (candidate === '"') {
      this.string();
      return;
    }
    if (candidate === "t") return this.literal("true");
    if (candidate === "f") return this.literal("false");
    if (candidate === "n") return this.literal("null");
    this.number();
  }

  private object(depth: number): void {
    this.index += 1;
    this.whitespace();
    const keys = new Set<string>();
    if (this.wire[this.index] === "}") {
      this.index += 1;
      return;
    }
    while (true) {
      const key = this.string();
      if (keys.has(key)) throw new Error("duplicate object key");
      keys.add(key);
      this.whitespace();
      this.expect(":");
      this.value(depth);
      this.whitespace();
      if (this.wire[this.index] === "}") {
        this.index += 1;
        return;
      }
      this.expect(",");
      this.whitespace();
    }
  }

  private array(depth: number): void {
    this.index += 1;
    this.whitespace();
    if (this.wire[this.index] === "]") {
      this.index += 1;
      return;
    }
    while (true) {
      this.value(depth);
      this.whitespace();
      if (this.wire[this.index] === "]") {
        this.index += 1;
        return;
      }
      this.expect(",");
      this.whitespace();
    }
  }

  private string(): string {
    if (this.wire[this.index] !== '"') throw new Error("expected JSON string");
    const start = this.index;
    this.index += 1;
    while (this.index < this.wire.length) {
      const character = this.wire[this.index] as string;
      if (character === '"') {
        this.index += 1;
        return JSON.parse(this.wire.slice(start, this.index)) as string;
      }
      if (character === "\\") {
        this.index += 1;
        const escape = this.wire[this.index];
        if (escape === "u") {
          const hex = this.wire.slice(this.index + 1, this.index + 5);
          if (!/^[0-9A-Fa-f]{4}$/.test(hex)) throw new Error("invalid JSON unicode escape");
          const codeUnit = Number.parseInt(hex, 16);
          if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
            if (
              this.wire[this.index + 5] !== "\\" ||
              this.wire[this.index + 6] !== "u"
            ) {
              throw new Error("unpaired JSON surrogate");
            }
            const lowHex = this.wire.slice(this.index + 7, this.index + 11);
            if (!/^[0-9A-Fa-f]{4}$/.test(lowHex)) {
              throw new Error("invalid JSON unicode escape");
            }
            const lowCodeUnit = Number.parseInt(lowHex, 16);
            if (lowCodeUnit < 0xdc00 || lowCodeUnit > 0xdfff) {
              throw new Error("unpaired JSON surrogate");
            }
            this.index += 11;
            continue;
          }
          if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
            throw new Error("unpaired JSON surrogate");
          }
          this.index += 5;
          continue;
        }
        if (!escape || !'"\\/bfnrt'.includes(escape)) throw new Error("invalid JSON escape");
        this.index += 1;
        continue;
      }
      if (character.charCodeAt(0) < 0x20) throw new Error("unescaped JSON control character");
      const codeUnit = character.charCodeAt(0);
      if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
        const lowCodeUnit = this.wire.charCodeAt(this.index + 1);
        if (lowCodeUnit < 0xdc00 || lowCodeUnit > 0xdfff) {
          throw new Error("unpaired JSON surrogate");
        }
        this.index += 2;
        continue;
      }
      if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
        throw new Error("unpaired JSON surrogate");
      }
      this.index += 1;
    }
    throw new Error("unterminated JSON string");
  }

  private number(): void {
    const match = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(
      this.wire.slice(this.index),
    );
    if (!match) throw new Error("invalid JSON value");
    const lexeme = match[0];
    if (!Number.isFinite(Number(lexeme))) throw new Error("JSON number is out of range");
    this.index += lexeme.length;
  }

  private literal(value: string): void {
    if (!this.wire.startsWith(value, this.index)) throw new Error("invalid JSON literal");
    this.index += value.length;
  }

  private whitespace(): void {
    while (/[\t\n\r ]/.test(this.wire[this.index] ?? "")) this.index += 1;
  }

  private expect(value: string): void {
    if (this.wire[this.index] !== value) throw new Error(`expected ${value}`);
    this.index += 1;
  }
}
