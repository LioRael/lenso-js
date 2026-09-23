import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { send } from "./transport.mjs";

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

const corpusPath = resolve(
  process.env.LENSO_RUST_ROOT,
  "tests/fixtures/http-parity-plugin/corpus.json",
);
const source = await readFile(corpusPath);
const sourceSha256 = createHash("sha256").update(source).digest("hex");
const origin = base.origin;

function header(headers, name) {
  if (Array.isArray(headers)) {
    return headers.find(([key]) => key.toLowerCase() === name)?.[1];
  }
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function compare(vector, observed) {
  const failures = [];
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
  if (["route", "path", "query", "credential"].some((key) => Object.hasOwn(vector, key))) {
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
    } catch {
      failures.push("invalid JSON response body");
    }
  }
  return failures;
}

function assess(vector, response, inside = false) {
  if (inside && response.boundary !== "host") {
    return { name: vector.name, boundary: response.boundary, passed: false, error: response.error };
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
  const failures = compare(vector, observed);
  const inputChanges = inside ? response.input_changes : [];
  return {
    name: vector.name,
    boundary: !receipt
      ? inside ? "host_without_receipt" : "platform_without_host_receipt"
      : inputChanges.length ? "request_api_transformed" : failures.length ? "parity_mismatch" : "host",
    passed: Boolean(receipt) && inputChanges.length === 0 && failures.length === 0,
    status: observed.status,
    ...(inputChanges.length ? { input_changes: inputChanges } : {}),
    ...(failures.length ? { failures } : {}),
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
  const compiledCorpus = (await diagnostic("/_parity/corpus")).body;
  if (!compiledCorpus.equals(source)) {
    throw new Error(`compiled corpus differs from ${corpusPath} (${sourceSha256})`);
  }
  const corpus = JSON.parse(source);
  const network = [];
  const inside = [];
  for (const vector of corpus) {
    try {
      network.push(assess(vector, await send(origin, vector)));
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
        !header(response.headers, "x-lenso-parity-shutdown") &&
        header(response.headers, "x-content-type-options") === "nosniff",
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
  const passed =
    network.every((result) => result.passed) &&
    inside.every((result) => result.passed) &&
    oversized.passed &&
    healthyAfterLimit.passed;
  process.stdout.write(`${JSON.stringify({
    passed,
    origin,
    corpus_sha256: sourceSha256,
    corpus_count: corpus.length,
    network,
    inside,
    oversized_request: oversized,
    healthy_after_limit: healthyAfterLimit,
  }, null, 2)}\n`);
  if (!passed) process.exitCode = 1;
}

await main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
