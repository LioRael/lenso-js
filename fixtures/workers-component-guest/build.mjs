import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { reviewedRustRevision } from "../workers-http-parity/provenance.mjs";

const rustRoot = process.env.LENSO_RUST_ROOT;
const expectedSha = process.env.LENSO_RUST_SHA;
const jco = process.env.JCO;
if (!rustRoot || !expectedSha || !jco) {
  throw new Error("LENSO_RUST_ROOT, LENSO_RUST_SHA and JCO are required");
}
const rustSha = reviewedRustRevision(rustRoot, expectedSha);
const jcoVersion = execFileSync(jco, ["--version"], { encoding: "utf8" }).trim();
if (jcoVersion !== "1.35.0") throw new Error(`jco 1.35.0 required; found ${jcoVersion}`);

const directory = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(directory, "pkg");
mkdirSync(outDir, { recursive: true });
const metadataPath = resolve(outDir, "component-build.json");
const modulePath = resolve(outDir, "component-build.mjs");
rmSync(metadataPath, { force: true });
rmSync(modulePath, { force: true });

const targetDir = resolve(outDir, "cargo-target", rustSha);
const manifest = resolve(rustRoot, "tests/fixtures/portable-http-endpoint/guest/Cargo.toml");
const cargo = process.env.CARGO || "cargo";
execFileSync(cargo, [
  "build", "--locked", "--release", "--target", "wasm32-unknown-unknown",
  "--manifest-path", manifest, "--target-dir", targetDir,
], { stdio: "inherit" });

const core = resolve(targetDir, "wasm32-unknown-unknown/release/lenso_portable_http_test_guest.wasm");
const component = resolve(outDir, "guest.component.wasm");
execFileSync(jco, ["new", core, "-o", component], { stdio: "inherit" });
execFileSync(jco, [
  "transpile", component, "--instantiation", "sync", "--no-wasi-shim",
  "--name", "guest", "-o", outDir,
], { stdio: "inherit" });

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
const provenance = {
  rust_sha: rustSha,
  guest_source_sha256: sha256(resolve(rustRoot, "tests/fixtures/portable-http-endpoint/guest/src/lib.rs")),
  shared_handler_sha256: sha256(resolve(rustRoot, "tests/fixtures/portable-http-endpoint/src/lib.rs")),
  component_sha256: sha256(component),
  core_sha256: sha256(resolve(outDir, "guest.core.wasm")),
  bindings_sha256: sha256(resolve(outDir, "guest.js")),
  jco_version: jcoVersion,
};
writeFileSync(metadataPath, `${JSON.stringify(provenance, null, 2)}\n`);
writeFileSync(modulePath, `export default ${JSON.stringify(provenance)};\n`);
process.stdout.write(`${JSON.stringify(provenance)}\n`);
