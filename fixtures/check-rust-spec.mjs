import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rustRoot = process.env.LENSO_RUST_ROOT;
if (!rustRoot || !isAbsolute(rustRoot)) {
  throw new Error("LENSO_RUST_ROOT must be an absolute Lenso Rust checkout path");
}

const jsRoot = fileURLToPath(new URL("../", import.meta.url));
const vectors = [
  "portable-contract/portable-pattern-conformance.json",
  "process-protocol/authoring-v2-conformance.json",
  "execution-target-capability-profile/conformance.json",
];

for (const vector of vectors) {
  const canonical = readFileSync(resolve(rustRoot, "spec/fixtures", vector));
  const mirror = readFileSync(resolve(jsRoot, "fixtures", vector));
  if (!canonical.equals(mirror)) {
    throw new Error(`Protocol vector mirror differs from Rust spec: ${vector}`);
  }
}

console.log(`Verified ${vectors.length} protocol vector mirrors against ${rustRoot}`);
