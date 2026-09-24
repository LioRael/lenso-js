import core from "./pkg/guest.core.wasm";
import { instantiate } from "./pkg/guest.js";
import build from "./pkg/component-build.mjs";
import { createWorkersComponentRequestAdapter } from "../../packages/lenso-workers-runtime/component-requests.mjs";

const CAPABILITY = "lenso.http.endpoint@1";
const MAX_BODY = 65_536;
const selectedPlan = {
  schema_version: 4,
  terminal_policy: { kind: "required_path" },
  execution_lanes: [{ id: "main" }],
  capability_bindings: [],
  plugin_instances: [{
    authoring_version: 1,
    runtime_profile: "lenso.wasm-component@1",
    instance_key: "endpoint",
    package_id: "lenso.portable-http-endpoint-fixture",
    entrypoint: "plugin",
    configuration: "{}",
    provided_capabilities: [{
      capability_id: CAPABILITY,
      descriptor_version: "1.1.0",
      operations: ["describe", "handle"],
      operation_kinds: {},
      default_admission: null,
      operation_admissions: {},
      event_admission: null,
      cross_lane_transfer: false,
    }],
    required_capabilities: [],
    required_target_capabilities: ["request", "wasm-component", "workers"],
    execution_class: "lenso.wasm-component@1",
    package_revision: `sha256:${build.component_sha256}`,
    restart_policy: {
      mode: "never",
      max_attempts: 0,
      window: { secs: 0, nanos: 0 },
      backoff: { secs: 0, nanos: 0 },
      jitter: { secs: 0, nanos: 0 },
      stability: { secs: 0, nanos: 0 },
    },
    criticality: "non_critical",
    execution_lane: "main",
  }],
};
const expectedRoutes = [
  { route_id: "method", method: "GET", path: "/method/{item}" },
  { route_id: "bytes", method: "POST", path: "/bytes" },
  { route_id: "reject", method: "GET", path: "/reject" },
  { route_id: "failure", method: "GET", path: "/failure" },
  { route_id: "evidence", method: "GET", path: "/evidence" },
];

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

const component = createWorkersComponentRequestAdapter({
  plan: selectedPlan,
  instanceKey: "endpoint",
  coreModule: core,
  instantiate,
});
if (!sameJson(JSON.parse(component.invoke(CAPABILITY, "describe", "{}")), { routes: expectedRoutes })) {
  throw new Error("portable Guest route table differs from this fixture's admitted routes");
}

function failure(status, code) {
  return Response.json({ error: code }, { status, headers: { "cache-control": "no-store" } });
}

function matchRoute(path, method) {
  const route = expectedRoutes.find(({ path: pattern }) =>
    pattern === "/method/{item}"
      ? /^\/method\/[^/]+$/.test(path)
      : pattern === path);
  if (!route) return { error: "not_found", status: 404 };
  if (route.method !== method) return { error: "method_not_allowed", status: 405 };
  return { route_id: route.route_id };
}

function credentialEvidence(headers) {
  const authorization = headers.get("authorization");
  if (authorization === null) return { credential: null };
  const separator = authorization.indexOf(" ");
  if (separator <= 0 || separator === authorization.length - 1) return { error: true };
  const scheme = authorization.slice(0, separator).toLowerCase();
  const value = authorization.slice(separator + 1);
  if ((scheme === "bearer" || scheme === "basic") && /[,\s]/.test(value)) {
    return { error: true };
  }
  return { credential: { scheme, value } };
}

async function readBoundedBody(request) {
  if (!request.body) return new Uint8Array();
  const chunks = [];
  let size = 0;
  const reader = request.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let cursor = 0;
  for (const chunk of chunks) {
    body.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  return body;
}

function encodeBody(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBody(value) {
  if (typeof value !== "string") throw new Error("Guest response body is not base64");
  const binary = atob(value);
  if (binary.length > MAX_BODY) throw new Error("Guest response body exceeds fixture bound");
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/_component/build") {
      if (request.method !== "GET") return failure(405, "method_not_allowed");
      return Response.json(build, { headers: { "cache-control": "no-store" } });
    }
    const route = matchRoute(url.pathname, request.method);
    if (route.error) return failure(route.status, route.error);
    const credential = credentialEvidence(request.headers);
    if (credential.error) return failure(400, "bad_request");
    const body = await readBoundedBody(request);
    if (body === null) return failure(413, "request_too_large");
    try {
      const result = JSON.parse(component.invoke(CAPABILITY, "handle", JSON.stringify({
        route_id: route.route_id,
        method: request.method,
        path: url.pathname,
        body: encodeBody(body),
        credential: credential.credential,
        headers: request.headers.has("x-test")
          ? [{ name: "x-test", value: request.headers.get("x-test") }]
          : [],
      })));
      if (result.status !== 200 || !sameJson(result.headers, [])) {
        throw new Error("unexpected Guest HTTP result shape");
      }
      return new Response(decodeBody(result.body), {
        status: result.status,
        headers: {
          "x-lenso-component-guest": "true",
          "x-lenso-plan-admitted": "request-only-v4",
        },
      });
    } catch (error) {
      if (error?.payload === '"rejected"') return failure(502, "endpoint_rejected");
      return failure(503, "endpoint_unavailable");
    }
  },
};
