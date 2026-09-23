import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { reviewedRustRevision } from "./provenance.mjs";
import { send } from "./transport.mjs";
import { headerValues, workerRequestCollapsedHeaders } from "./diagnostics.mjs";

const base = new URL(process.env.WORKERS_PARITY_URL ?? "http://127.0.0.1:63737");
if (
  base.protocol !== "http:" ||
  base.hostname !== "127.0.0.1" ||
  !base.port ||
  base.pathname !== "/" ||
  base.search ||
  base.hash ||
  base.username ||
  base.password
) {
  throw new Error("WORKERS_PARITY_URL must be an explicit loopback HTTP origin");
}
if (!process.env.LENSO_RUST_ROOT) {
  throw new Error("LENSO_RUST_ROOT must identify the reviewed Rust checkout");
}
if (!process.env.LENSO_RUST_SHA) {
  throw new Error("LENSO_RUST_SHA must identify the reviewed Rust commit");
}

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const rustSha = reviewedRustRevision(process.env.LENSO_RUST_ROOT, process.env.LENSO_RUST_SHA);
const corpusPath = resolve(
  process.env.LENSO_RUST_ROOT,
  "tests/fixtures/http-parity-plugin/corpus.json",
);
const source = await readFile(corpusPath);
const sourceSha256 = createHash("sha256").update(source).digest("hex");
const origin = base.origin;
const provenance = JSON.parse(await readFile(resolve(fixtureDir, "pkg/parity-build.json"), "utf8"));
if (provenance.rust_sha !== rustSha) {
  throw new Error(`generated Wasm was built from ${provenance.rust_sha}, not ${rustSha}`);
}
for (const [name, file] of [
  ["wasm_sha256", "lenso_workers_http_parity_host_bg.wasm"],
  ["bindings_sha256", "lenso_workers_http_parity_host.js"],
]) {
  const digest = createHash("sha256")
    .update(await readFile(resolve(fixtureDir, "pkg", file)))
    .digest("hex");
  if (provenance[name] !== digest) throw new Error(`${file} differs from build provenance`);
}

function header(headers, name) {
  if (Array.isArray(headers)) {
    return headers.find(([key]) => key.toLowerCase() === name)?.[1];
  }
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function compare(vector, observed) {
  const failures = [];
  const headerValueDifferences = [];
  if (observed.status !== vector.status) {
    failures.push(`status: ${observed.status} != ${vector.status}`);
  }
  if (header(observed.headers, "x-lenso-parity-ready") !== "true") failures.push("not ready");
  if (header(observed.headers, "x-lenso-parity-shutdown") !== "clean") failures.push("no clean shutdown receipt");
  if (header(observed.headers, "x-lenso-parity-cancelled") !== "false") failures.push("unexpected cancellation");
  if (header(observed.headers, "x-content-type-options") !== "nosniff") failures.push("missing nosniff");
  if (header(observed.headers, "x-request-id") === "untrusted") failures.push("trusted external request id");
  if (Object.hasOwn(vector, "response_body") && !Buffer.from(vector.response_body).equals(observed.body)) {
    failures.push("response body differs");
  }
  if (Object.hasOwn(vector, "set_cookie_count") && observed.setCookieCount !== vector.set_cookie_count) {
    failures.push(`set-cookie count: ${observed.setCookieCount} != ${vector.set_cookie_count}`);
  }
  if (["route", "path", "query", "credential", "header_values"].some((key) => Object.hasOwn(vector, key))) {
    try {
      const decoded = JSON.parse(observed.body.toString("utf8"));
      for (const [sourceKey, responseKey] of [
        ["route", "route_id"],
        ["path", "path"],
        ["query", "query"],
        ["credential", "credential"],
      ]) {
        if (Object.hasOwn(vector, sourceKey) && JSON.stringify(decoded[responseKey]) !== JSON.stringify(vector[sourceKey])) {
          failures.push(`${sourceKey} differs`);
        }
      }
      for (const [name, expectedValues] of Object.entries(vector.header_values ?? {})) {
        if (!Array.isArray(decoded.headers)) {
          failures.push("response headers missing from endpoint body");
          break;
        }
        const actualValues = headerValues(decoded.headers, name);
        if (JSON.stringify(actualValues) !== JSON.stringify(expectedValues)) {
          failures.push(`${name} request header values differ`);
          headerValueDifferences.push({ name, expected: expectedValues, observed: actualValues });
        }
      }
    } catch {
      failures.push("invalid JSON response body");
    }
  }
  return { failures, headerValueDifferences };
}

function assess(vector, response, inside = false, workerIngressValues) {
  if (inside && response.boundary !== "host") {
    const expectedTraceRejection =
      response.boundary === "request_constructor_rejected" &&
      vector.name === "method-TRACE" &&
      vector.method === "TRACE" &&
      /^TypeError(?::|$)/.test(response.error ?? "") &&
      /\b(?:TRACE|forbidden|unsupported)\b/i.test(response.error);
    return {
      name: vector.name,
      boundary: expectedTraceRejection ? "request_api_trace_unsupported" : response.boundary,
      passed: false,
      error: response.error,
    };
  }
  const observed = inside
    ? {
        status: response.status,
        headers: response.headers,
        body: Buffer.from(response.body),
        setCookieCount: response.set_cookie_count,
      }
    : {
        ...response,
        setCookieCount: response.headers["set-cookie"]?.length ?? 0,
      };
  const receipt = header(observed.headers, "x-lenso-parity-shutdown");
  const { failures, headerValueDifferences } = compare(vector, observed);
  const inputChanges = inside ? response.input_changes : [];
  const workerRequestHeaderLoss =
    !inside && failures.length === headerValueDifferences.length &&
    workerRequestCollapsedHeaders(headerValueDifferences, workerIngressValues);
  return {
    name: vector.name,
    boundary: !receipt
      ? inside ? "host_without_receipt" : "platform_without_host_receipt"
      : inputChanges.length ? "request_api_transformed"
      : workerRequestHeaderLoss ? "worker_request_headers_non_lossless"
      : failures.length ? "parity_mismatch" : "host",
    passed: Boolean(receipt) && inputChanges.length === 0 && failures.length === 0,
    status: observed.status,
    ...(inputChanges.length ? { input_changes: inputChanges } : {}),
    ...(failures.length ? { failures } : {}),
    ...(headerValueDifferences.length ? { header_value_differences: headerValueDifferences } : {}),
    ...(workerIngressValues ? { worker_request_header_values: workerIngressValues } : {}),
  };
}

async function diagnostic(path) {
  const response = await send(origin, { method: "GET", uri: path, headers: [], body: [] });
  if (response.status !== 200) {
    throw new Error(`diagnostic ${path} returned ${response.status}: ${response.body.toString("utf8")}`);
  }
  return response;
}

async function main() {
  const runningBuild = JSON.parse((await diagnostic("/_parity/build")).body.toString("utf8"));
  if (JSON.stringify(runningBuild) !== JSON.stringify(provenance)) {
    throw new Error("running Worker build provenance differs from local generated artifact");
  }
  const compiledCorpus = (await diagnostic("/_parity/corpus")).body;
  if (!compiledCorpus.equals(source)) {
    throw new Error(`compiled corpus differs from ${corpusPath} (${sourceSha256})`);
  }
  const corpus = JSON.parse(source);
  const network = [];
  const inside = [];
  const headerProbes = [];
  for (const vector of corpus) {
    let workerIngressValues;
    if (vector.header_values) {
      try {
        const path = `/_parity/request-headers?name=${encodeURIComponent(vector.name)}`;
        const probe = await send(origin, { ...vector, uri: path });
        if (probe.status !== 200) throw new Error(`header probe returned ${probe.status}`);
        const observed = JSON.parse(probe.body.toString("utf8"));
        const expectedNames = Object.keys(vector.header_values).sort();
        const actualNames = observed.header_values && typeof observed.header_values === "object" &&
          !Array.isArray(observed.header_values) ? Object.keys(observed.header_values).sort() : [];
        if (observed.name !== vector.name ||
          JSON.stringify(actualNames) !== JSON.stringify(expectedNames) ||
          actualNames.some((name) => !Array.isArray(observed.header_values[name]) ||
            observed.header_values[name].some((value) => typeof value !== "string"))) {
          throw new Error("header probe returned the wrong vector");
        }
        workerIngressValues = observed.header_values;
        headerProbes.push({ name: vector.name, captured: true, header_values: workerIngressValues });
      } catch (error) {
        headerProbes.push({ name: vector.name, captured: false, error: String(error) });
      }
    }
    try {
      network.push(assess(vector, await send(origin, vector), false, workerIngressValues));
    } catch (error) {
      network.push({ name: vector.name, boundary: "transport_error", passed: false, error: String(error) });
    }
    try {
      const path = `/_parity/inside?name=${encodeURIComponent(vector.name)}`;
      const result = JSON.parse((await diagnostic(path)).body.toString("utf8"));
      inside.push(assess(vector, result, true));
    } catch (error) {
      inside.push({ name: vector.name, boundary: "diagnostic_error", passed: false, error: String(error) });
    }
  }
  let oversized;
  try {
    const response = await send(origin, {
      method: "POST",
      uri: "/bytes",
      headers: [],
      body: new Uint8Array(65_537),
    });
    oversized = {
      status: response.status,
      passed:
        response.status === 413 &&
        header(response.headers, "x-lenso-parity-worker") === "true" &&
        !header(response.headers, "x-lenso-parity-shutdown") &&
        header(response.headers, "x-content-type-options") === "nosniff" &&
        response.body.equals(Buffer.from('{"error":"payload_too_large"}')),
    };
  } catch (error) {
    oversized = { passed: false, boundary: "transport_error", error: String(error) };
  }
  let healthyAfterLimit;
  try {
    const healthy = corpus.find((vector) => vector.name === "method-GET");
    if (!healthy) throw new Error("canonical corpus has no method-GET vector");
    healthyAfterLimit = assess(healthy, await send(origin, healthy));
  } catch (error) {
    healthyAfterLimit = { passed: false, boundary: "transport_error", error: String(error) };
  }
  const syntheticRequestLimits = inside.filter((result) =>
    ["request_api_transformed", "request_api_trace_unsupported"].includes(result.boundary),
  );
  const syntheticFailures = inside.filter(
    (result) => !result.passed && !syntheticRequestLimits.includes(result),
  );
  const passed =
    network.every((result) => result.passed) &&
    headerProbes.every((probe) => probe.captured) &&
    syntheticFailures.length === 0 &&
    oversized.passed &&
    healthyAfterLimit.passed;
  process.stdout.write(`${JSON.stringify({
    passed,
    origin,
    rust_sha: rustSha,
    wasm_sha256: provenance.wasm_sha256,
    bindings_sha256: provenance.bindings_sha256,
    corpus_sha256: sourceSha256,
    corpus_count: corpus.length,
    network,
    worker_request_header_probes: headerProbes,
    inside,
    synthetic_request_limited_support: syntheticRequestLimits,
    synthetic_request_failures: syntheticFailures,
    oversized_request: oversized,
    healthy_after_limit: healthyAfterLimit,
  }, null, 2)}\n`);
  if (!passed) process.exitCode = 1;
}

await main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
