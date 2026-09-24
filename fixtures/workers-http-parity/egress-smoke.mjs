import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(fixtureDir, "pkg");
const provenance = JSON.parse(await readFile(resolve(pkgDir, "parity-build.json"), "utf8"));
if (!process.env.LENSO_RUST_SHA || provenance.rust_sha !== process.env.LENSO_RUST_SHA) {
  throw new Error("LENSO_RUST_SHA must match the generated Rust Wasm provenance");
}
for (const [name, file] of [
  ["wasm_sha256", "lenso_workers_http_parity_host_bg.wasm"],
  ["bindings_sha256", "lenso_workers_http_parity_host.js"],
]) {
  const digest = createHash("sha256").update(await readFile(resolve(pkgDir, file))).digest("hex");
  if (digest !== provenance[name]) throw new Error(`${file} differs from build provenance`);
}

const origin = base.origin;
const buildResponse = await send(origin, { method: "GET", uri: "/_parity/build", headers: [], body: [] });
if (buildResponse.status !== 200 ||
  JSON.stringify(JSON.parse(buildResponse.body.toString("utf8"))) !== JSON.stringify(provenance)) {
  throw new Error("running Worker build provenance differs from local generated artifact");
}

const cases = [
  {
    name: "binary_response",
    path: "/egress/get",
    outcome: { kind: "response", status: 207, body: [0, 255, 128, 1] },
    started: "1",
    aborted: "0",
    cancelled: "false",
  },
  {
    name: "origin_denied_before_fetch",
    path: "/egress/denied",
    outcome: { kind: "destination_not_allowed" },
    started: "0",
    aborted: "0",
    cancelled: "false",
  },
  {
    name: "cancel_aborts_fetch",
    path: "/egress/cancel",
    outcome: { kind: "cancelled" },
    started: "1",
    aborted: "1",
    cancelled: "true",
  },
  {
    name: "healthy_after_cancel",
    path: "/egress/get",
    outcome: { kind: "response", status: 207, body: [0, 255, 128, 1] },
    started: "1",
    aborted: "0",
    cancelled: "false",
  },
];

const results = [];
for (const probe of cases) {
  try {
    const response = await send(origin, { method: "GET", uri: probe.path, headers: [], body: [] });
    const outcome = JSON.parse(response.body.toString("utf8"));
    const expectedHeaders = {
      "x-lenso-parity-ready": "true",
      "x-lenso-parity-shutdown": "clean",
      "x-lenso-parity-cancelled": probe.cancelled,
      "x-egress-started": probe.started,
      "x-egress-aborted": probe.aborted,
    };
    const failures = [];
    if (response.status !== 200) failures.push(`status ${response.status}`);
    if (!isDeepStrictEqual(outcome, probe.outcome)) failures.push("outcome differs");
    for (const [name, expected] of Object.entries(expectedHeaders)) {
      if (response.headers[name]?.[0] !== expected) failures.push(`${name} differs`);
    }
    results.push({ name: probe.name, passed: failures.length === 0, ...(failures.length ? { failures, status: response.status, outcome } : {}) });
  } catch (error) {
    results.push({ name: probe.name, passed: false, error: String(error) });
  }
}
const passed = results.every((result) => result.passed);
process.stdout.write(`${JSON.stringify({ passed, origin, ...provenance, results }, null, 2)}\n`);
if (!passed) process.exitCode = 1;
