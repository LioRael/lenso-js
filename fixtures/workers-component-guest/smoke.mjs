import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { reviewedRustRevision } from "../workers-http-parity/provenance.mjs";
import { send } from "../workers-http-parity/transport.mjs";

const base = new URL(process.env.WORKERS_COMPONENT_URL ?? "http://127.0.0.1:63739");
if (base.protocol !== "http:" || base.hostname !== "127.0.0.1" || !base.port ||
  base.pathname !== "/" || base.search || base.hash || base.username || base.password) {
  throw new Error("WORKERS_COMPONENT_URL must be an explicit loopback HTTP origin");
}
if (!process.env.LENSO_RUST_ROOT || !process.env.LENSO_RUST_SHA) {
  throw new Error("LENSO_RUST_ROOT and LENSO_RUST_SHA are required");
}
const expectedSha = process.env.LENSO_RUST_SHA;
let rustSha;
if (process.env.LENSO_RUNTIME_ONLY === "1") {
  if (!/^[a-f0-9]{40}$/.test(expectedSha)) throw new Error("full Rust SHA required");
  rustSha = expectedSha;
} else {
  rustSha = reviewedRustRevision(process.env.LENSO_RUST_ROOT, expectedSha);
}
const fixtureDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(fixtureDir, "pkg");
const provenance = JSON.parse(await readFile(resolve(packageDir, "component-build.json"), "utf8"));
if (provenance.rust_sha !== rustSha) throw new Error("Component uses another Rust revision");
for (const [field, path] of [
  ["guest_source_sha256", "tests/fixtures/portable-http-endpoint/guest/src/lib.rs"],
  ["shared_handler_sha256", "tests/fixtures/portable-http-endpoint/src/lib.rs"],
]) {
  const source = await readFile(resolve(process.env.LENSO_RUST_ROOT, path));
  const digest = createHash("sha256").update(source).digest("hex");
  if (provenance[field] !== digest) throw new Error(`${path} differs from build provenance`);
}
for (const [field, file] of [
  ["component_sha256", "guest.component.wasm"],
  ["core_sha256", "guest.core.wasm"],
  ["bindings_sha256", "guest.js"],
]) {
  const digest = createHash("sha256").update(await readFile(resolve(packageDir, file))).digest("hex");
  if (provenance[field] !== digest) throw new Error(`${file} differs from build provenance`);
}
const running = await send(base.origin, { method: "GET", uri: "/_component/build", headers: [], body: [] });
if (running.status !== 200 || !isDeepStrictEqual(JSON.parse(running.body.toString("utf8")), provenance)) {
  throw new Error("running Worker differs from local Component build");
}

const cases = [
  ["method", "GET", "/method/42", [], 200, Buffer.from("GET /method/42")],
  ["binary", "POST", "/bytes", [0, 255, 128, 13, 10, 1], 200, Buffer.from([0, 255, 128, 13, 10, 1])],
  ["evidence", "GET", "/evidence", [], 200, Buffer.from("bearer:alpha"),
    [["x-test", "alpha"], ["authorization", "Bearer test-token"]],
  ],
  ["ambiguous_bearer", "GET", "/evidence", [], 400, Buffer.from('{"error":"bad_request"}'),
    [["authorization", "Bearer first"], ["authorization", "Bearer second"]],
  ],
  ["method_not_allowed", "POST", "/method/42", [], 405, Buffer.from('{"error":"method_not_allowed"}')],
  ["not_found", "GET", "/absent", [], 404, Buffer.from('{"error":"not_found"}')],
  ["domain_error", "GET", "/reject", [], 502, Buffer.from('{"error":"endpoint_rejected"}')],
  ["runtime_failure", "GET", "/failure", [], 503, Buffer.from('{"error":"endpoint_unavailable"}')],
  ["oversized_body", "POST", "/bytes", Array(65_537).fill(1), 413, Buffer.from('{"error":"request_too_large"}')],
  ["healthy_after_failure", "GET", "/method/42", [], 200, Buffer.from("GET /method/42")],
];
const results = [];
for (const [name, method, uri, body, status, expectedBody, headers = []] of cases) {
  try {
    const response = await send(base.origin, { method, uri, headers, body });
    const failures = [];
    if (response.status !== status) failures.push(`status ${response.status} != ${status}`);
    if (!response.body.equals(expectedBody)) failures.push("body differs");
    if (status === 200 && response.headers["x-lenso-component-guest"] !== "true") {
      failures.push("Guest execution marker missing");
    }
    results.push({ name, passed: failures.length === 0, ...(failures.length ? { failures } : {}) });
  } catch (error) {
    results.push({ name, passed: false, error: String(error) });
  }
}
const passed = results.every((result) => result.passed);
process.stdout.write(`${JSON.stringify({
  passed,
  scope: "exact portable HTTP Guest source compiled as Component and executed by Jco core Wasm inside local workerd",
  excluded: "general Plan/Kernel Component Adapter, lossless repeated headers, full Auth policy and persistent business App target parity",
  ...provenance,
  results,
}, null, 2)}\n`);
if (!passed) process.exitCode = 1;
