import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { reviewedRustRevision } from "./provenance.mjs";
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
) throw new Error("WORKERS_PARITY_URL must be an explicit loopback HTTP origin");
if (!process.env.LENSO_RUST_ROOT || !process.env.LENSO_RUST_SHA) {
  throw new Error("LENSO_RUST_ROOT and LENSO_RUST_SHA are required");
}

const rustSha = reviewedRustRevision(process.env.LENSO_RUST_ROOT, process.env.LENSO_RUST_SHA);
const fixtureDir = dirname(fileURLToPath(import.meta.url));
const provenance = JSON.parse(await readFile(resolve(fixtureDir, "pkg/parity-build.json"), "utf8"));
if (provenance.rust_sha !== rustSha) throw new Error("running build uses another Rust revision");
for (const [field, file] of [
  ["wasm_sha256", "lenso_workers_http_parity_host_bg.wasm"],
  ["bindings_sha256", "lenso_workers_http_parity_host.js"],
]) {
  const digest = createHash("sha256").update(await readFile(resolve(fixtureDir, "pkg", file))).digest("hex");
  if (provenance[field] !== digest) throw new Error(`${file} differs from build provenance`);
}
const running = await send(base.origin, { method: "GET", uri: "/_parity/build", headers: [], body: [] });
if (running.status !== 200 ||
  !isDeepStrictEqual(JSON.parse(running.body.toString("utf8")), provenance)) {
  throw new Error("running Worker differs from local generated artifact");
}

const source = await readFile(resolve(
  process.env.LENSO_RUST_ROOT,
  "tests/fixtures/portable-http-endpoint/src/lib.rs",
));
const sharedSourceSha256 = createHash("sha256").update(source).digest("hex");
const cases = [
  ["method", "GET", "/_shared/method/42", [], 200, Buffer.from("GET /method/42")],
  ["binary", "POST", "/_shared/bytes", [0, 255, 128, 13, 10, 1], 200, Buffer.from([0, 255, 128, 13, 10, 1])],
  ["method_not_allowed", "POST", "/_shared/method/42", [], 405, Buffer.from('{"error":"method_not_allowed"}')],
  ["not_found", "GET", "/_shared/absent", [], 404, Buffer.from('{"error":"not_found"}')],
  ["domain_error", "GET", "/_shared/reject", [], 502, Buffer.from('{"error":"endpoint_rejected"}')],
  ["runtime_failure", "GET", "/_shared/failure", [], 503, Buffer.from('{"error":"endpoint_unavailable"}')],
  ["healthy_after_failure", "GET", "/_shared/method/42", [], 200, Buffer.from("GET /method/42")],
];

const results = [];
for (const [name, method, uri, body, status, expectedBody] of cases) {
  try {
    const response = await send(base.origin, { method, uri, headers: [], body });
    const failures = [];
    if (response.status !== status) failures.push(`status ${response.status} != ${status}`);
    if (!response.body.equals(expectedBody)) failures.push("body differs");
    for (const [header, expected] of [
      ["x-lenso-parity-worker", "true"],
      ["x-lenso-parity-ready", "true"],
      ["x-lenso-parity-shutdown", "clean"],
      ["x-lenso-parity-cancelled", "false"],
    ]) {
      if (response.headers[header] !== expected) failures.push(`${header} differs`);
    }
    results.push({ name, passed: failures.length === 0, ...(failures.length ? { failures } : {}) });
  } catch (error) {
    results.push({ name, passed: false, error: String(error) });
  }
}
const passed = results.every((result) => result.passed);
process.stdout.write(`${JSON.stringify({
  passed,
  scope: "one shared Rust business handler via Native loopback, Wasmtime Component, and Workers linked Host",
  excluded: "Workers Component Guest and general target admission",
  rust_sha: rustSha,
  shared_source_sha256: sharedSourceSha256,
  ...provenance,
  results,
}, null, 2)}\n`);
if (!passed) process.exitCode = 1;
