import * as bindings from "./pkg/lenso_workers_http_parity_host.js";
import wasmModule from "./pkg/lenso_workers_http_parity_host_bg.wasm";
import buildProvenance from "./pkg/parity-build.mjs";
import { createWorkersHttpHost } from "@lenso/workers-runtime";

const host = createWorkersHttpHost({
  bindings,
  wasmModule,
  limits: {
    eventLimitMs: 1000,
    cancellationLimitMs: 1000,
    maxRequestBodyBytes: 65_536,
    maxResponseBodyBytes: 65_536,
    maxRequestHeadBytes: 16_384,
    bodyReadTimeoutMs: 250,
  },
  onReceipt(result, response) {
    response.headers.set("x-lenso-parity-ready", String(result.ready));
    response.headers.set("x-lenso-parity-shutdown", result.shutdown);
    response.headers.set("x-lenso-parity-cancelled", String(result.cancelled));
    response.headers.set("x-lenso-parity-generation", String(result.generation));
    response.headers.set("x-lenso-parity-wasm-memory", String(result.wasm_memory_bytes));
  },
});

// The Host initializes this generated module before the corpus is read. No
// request may be admitted while the one-time, pure Wasm export is called.
const corpusSource = bindings.parity_corpus();
const corpus = JSON.parse(corpusSource);
const byName = new Map(corpus.map((vector) => [vector.name, vector]));
if (byName.size !== corpus.length) throw new Error("duplicate parity vector name");

function inputChanges(vector, request, origin) {
  const changes = [];
  if (request.method !== vector.method) changes.push("method");
  if (request.url.slice(origin.length) !== vector.uri) changes.push("uri");
  const expected = vector.headers
    .map(([name, value]) => [name.toLowerCase(), value])
    .sort(([leftName, leftValue], [rightName, rightValue]) =>
      leftName.localeCompare(rightName) || leftValue.localeCompare(rightValue),
    );
  const actual = [...request.headers].sort(
    ([leftName, leftValue], [rightName, rightValue]) =>
      leftName.localeCompare(rightName) || leftValue.localeCompare(rightValue),
  );
  if (JSON.stringify(actual) !== JSON.stringify(expected)) changes.push("headers");
  return changes;
}

async function inspectInside(vector, origin, env, ctx) {
  let request;
  try {
    request = new Request(origin + vector.uri, {
      method: vector.method,
      headers: vector.headers,
      body: vector.body.length ? Uint8Array.from(vector.body) : undefined,
    });
  } catch (error) {
    return { boundary: "request_constructor_rejected", error: String(error) };
  }
  const changes = inputChanges(vector, request, origin);
  const response = await host.fetch(request, env, ctx);
  return {
    boundary: "host",
    input_changes: changes,
    status: response.status,
    headers: [...response.headers],
    set_cookie_count: response.headers.getSetCookie().length,
    body: [...new Uint8Array(await response.arrayBuffer())],
  };
}

function diagnostic(value, status = 200) {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/_parity/corpus") {
      if (request.method !== "GET") return diagnostic({ error: "method_not_allowed" }, 405);
      return new Response(corpusSource, {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }
    if (url.pathname === "/_parity/build") {
      if (request.method !== "GET") return diagnostic({ error: "method_not_allowed" }, 405);
      return diagnostic(buildProvenance);
    }
    if (url.pathname === "/_parity/request-headers") {
      if (request.method !== "GET") return diagnostic({ error: "method_not_allowed" }, 405);
      const vector = byName.get(url.searchParams.get("name"));
      if (!vector?.header_values) return diagnostic({ error: "unknown_vector" }, 404);
      const values = Object.fromEntries(Object.keys(vector.header_values).map((name) => [
        name,
        [...request.headers]
          .filter(([key]) => key.toLowerCase() === name.toLowerCase())
          .map(([, value]) => value),
      ]));
      return diagnostic({ name: vector.name, header_values: values });
    }
    if (url.pathname === "/_parity/inside") {
      if (request.method !== "GET") return diagnostic({ error: "method_not_allowed" }, 405);
      const vector = byName.get(url.searchParams.get("name"));
      if (!vector) return diagnostic({ error: "unknown_vector" }, 404);
      try {
        return diagnostic(await inspectInside(vector, url.origin, env, ctx));
      } catch (error) {
        return diagnostic({ boundary: "fixture_error", error: String(error) }, 500);
      }
    }
    const response = await host.fetch(request, env, ctx);
    response.headers.set("x-lenso-parity-worker", "true");
    return response;
  },
};
