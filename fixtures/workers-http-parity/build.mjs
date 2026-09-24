import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../../packages/lenso-workers-runtime/build.mjs";
import { reviewedRustRevision } from "./provenance.mjs";

if (!process.env.LENSO_RUST_ROOT || !process.env.LENSO_RUST_SHA) {
  throw new Error("LENSO_RUST_ROOT and LENSO_RUST_SHA are required");
}

const rustSha = reviewedRustRevision(process.env.LENSO_RUST_ROOT, process.env.LENSO_RUST_SHA);
const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "pkg");
const metadataPath = resolve(outDir, "parity-build.json");
const modulePath = resolve(outDir, "parity-build.mjs");
rmSync(metadataPath, { force: true });
rmSync(modulePath, { force: true });

// Worktrees may share a Cargo target directory. Its mtime-based fingerprint can
// reuse a Wasm artifact embedding an older corpus after the reviewed SHA moves.
process.env.CARGO_TARGET_DIR = resolve(outDir, "cargo-target", rustSha);

build({
  manifest: resolve(process.env.LENSO_RUST_ROOT, "tests/fixtures/workers-http-parity-host/Cargo.toml"),
  packageName: "lenso-workers-http-parity-host",
  outDir,
});

function digest(file) {
  return createHash("sha256").update(readFileSync(resolve(outDir, file))).digest("hex");
}

const provenance = {
  rust_sha: rustSha,
  wasm_sha256: digest("lenso_workers_http_parity_host_bg.wasm"),
  bindings_sha256: digest("lenso_workers_http_parity_host.js"),
};
writeFileSync(metadataPath, `${JSON.stringify(provenance, null, 2)}\n`);
writeFileSync(modulePath, `export default ${JSON.stringify(provenance)};\n`);
process.stdout.write(`${JSON.stringify(provenance)}\n`);
