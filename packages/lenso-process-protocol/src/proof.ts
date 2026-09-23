import type { HandshakeParams } from "./types.js";
import { validateInitialize, type InitializeParams } from "./authoring.js";

const encoder = new TextEncoder();
const HOST_DOMAIN = encoder.encode("lenso-process-host-v1");
const CHILD_DOMAIN = encoder.encode("lenso-process-child-v1");
const AUTHORING_HOST_DOMAIN = encoder.encode("lenso-authoring-host-v2");
const AUTHORING_CHILD_DOMAIN = encoder.encode("lenso-authoring-child-v2");
const AUTHORING_CALLBACK_DOMAIN = encoder.encode("lenso-authoring-callback-v2");
const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** RFC 8785-compatible canonical JSON for the restricted proof value profile. */
export function canonicalizeProofValue(value: unknown): Uint8Array {
  return encoder.encode(canonical(value));
}

/** Canonical bytes hashed to obtain `handshake_params_digest`. */
export function handshakeProofPayload(params: HandshakeParams): Uint8Array {
  return canonicalizeProofValue({
    identity: params.identity,
    host_nonce: params.host_nonce,
  });
}

/** Exact bytes authenticated by `host_proof`. */
export function hostProofMessage(handshakeDigest: Uint8Array): Uint8Array {
  exactLength(handshakeDigest, 32, "handshake digest");
  return concatenate(HOST_DOMAIN, Uint8Array.of(0), handshakeDigest);
}

/** Exact bytes authenticated by `child_proof`. */
export function childProofMessage(
  handshakeDigest: Uint8Array,
  session: string,
): Uint8Array {
  exactLength(handshakeDigest, 32, "handshake digest");
  return concatenate(
    CHILD_DOMAIN,
    Uint8Array.of(0),
    handshakeDigest,
    decodeBase64Url32(session, "session"),
  );
}

export interface AuthoringHandshakeProofInput {
  readonly initialize: InitializeParams;
  readonly callback_origin: string;
  readonly host_nonce: string;
}

/** Canonical bytes hashed before authenticating one Authoring V2 initialization. */
export function authoringHandshakeProofPayload(
  input: AuthoringHandshakeProofInput,
): Uint8Array {
  validateInitialize(input.initialize);
  if (!isLoopbackHttpOrigin(input.callback_origin)) {
    throw new Error("callback_origin must be an exact loopback HTTP origin");
  }
  decodeBase64Url32(input.host_nonce, "host_nonce");
  return canonicalizeProofValue(input);
}

/** Exact bytes authenticated by the Authoring V2 Host proof. */
export function authoringHostProofMessage(handshakeDigest: Uint8Array): Uint8Array {
  exactLength(handshakeDigest, 32, "handshake digest");
  return concatenate(AUTHORING_HOST_DOMAIN, Uint8Array.of(0), handshakeDigest);
}

/** Exact bytes authenticated by the Authoring V2 child proof. */
export function authoringChildProofMessage(
  handshakeDigest: Uint8Array,
  childNonce: string,
): Uint8Array {
  exactLength(handshakeDigest, 32, "handshake digest");
  return concatenate(
    AUTHORING_CHILD_DOMAIN,
    Uint8Array.of(0),
    handshakeDigest,
    decodeBase64Url32(childNonce, "child_nonce"),
  );
}

/** Exact bytes authenticating one child-to-Host callback request. */
export function authoringCallbackProofMessage(
  session: string,
  method:
    | "lenso.call"
    | "lenso.event.publish"
    | "lenso.stream.open"
    | "lenso.stream.send"
    | "lenso.stream.receive"
    | "lenso.stream.close_send"
    | "lenso.stream.cancel"
    | "lenso.settled",
  params: unknown,
): Uint8Array {
  const sessionBytes = decodeBase64Url32(session, "session");
  return concatenate(
    AUTHORING_CALLBACK_DOMAIN,
    Uint8Array.of(0),
    sessionBytes,
    Uint8Array.of(0),
    encoder.encode(method),
    Uint8Array.of(0),
    canonicalizeProofValue(params),
  );
}

/** Decodes one canonical unpadded base64url value containing exactly 32 bytes. */
export function decodeBase64Url32(value: string, name = "value"): Uint8Array {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new Error(`${name} must encode exactly 32 canonical base64url bytes`);
  }
  const decoded = decodeBase64Url(value);
  exactLength(decoded, 32, name);
  if (encodeBase64Url(decoded) !== value) {
    throw new Error(`${name} must use canonical unpadded base64url`);
  }
  return decoded;
}

/** Encodes bytes as canonical unpadded base64url. */
export function encodeBase64Url(value: Uint8Array): string {
  let output = "";
  for (let index = 0; index < value.length; index += 3) {
    const first = value[index] as number;
    const second = value[index + 1];
    const third = value[index + 2];
    const bits = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    output += BASE64URL[(bits >>> 18) & 63];
    output += BASE64URL[(bits >>> 12) & 63];
    if (second !== undefined) output += BASE64URL[(bits >>> 6) & 63];
    if (third !== undefined) output += BASE64URL[bits & 63];
  }
  return output;
}

function decodeBase64Url(value: string): Uint8Array {
  let buffer = 0;
  let bits = 0;
  const output: number[] = [];
  for (const character of value) {
    const digit = BASE64URL.indexOf(character);
    if (digit < 0) throw new Error("invalid base64url character");
    buffer = (buffer << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output.push((buffer >>> bits) & 0xff);
      buffer &= (1 << bits) - 1;
    }
  }
  if (bits > 0 && buffer !== 0) throw new Error("non-canonical base64url tail bits");
  return Uint8Array.from(output);
}

function canonical(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error("proof JSON permits only portable safe integers");
    }
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const candidate = value as Record<string, unknown>;
    const entries = Object.keys(candidate)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(candidate[key])}`);
    return `{${entries.join(",")}}`;
  }
  throw new Error("proof JSON contains an unsupported value");
}

function concatenate(...values: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(values.reduce((length, value) => length + value.length, 0));
  let offset = 0;
  for (const value of values) {
    output.set(value, offset);
    offset += value.length;
  }
  return output;
}

function exactLength(value: Uint8Array, expected: number, name: string): void {
  if (value.length !== expected) throw new Error(`${name} must contain ${expected} bytes`);
}

function isLoopbackHttpOrigin(value: string): boolean {
  const match = /^http:\/\/(?:127\.0\.0\.1|\[::1\]):([1-9][0-9]{0,4})\/$/.exec(value);
  return match !== null && Number(match[1]) <= 65_535;
}
