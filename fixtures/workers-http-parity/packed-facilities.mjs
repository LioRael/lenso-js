import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../../packages/lenso-workers-runtime", import.meta.url));
const consumer = await mkdtemp(join(tmpdir(), "lenso-packed-facilities-"));
const artifacts = join(consumer, "artifacts");
await mkdir(artifacts);
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env: { ...process.env, npm_config_cache: join(consumer, "npm-cache") } });
  assert.equal(result.status, 0, `${command} failed: ${result.stderr}\n${result.stdout}`);
  return result.stdout;
}
run("npm", ["run", "build"], packageRoot);
const packed = JSON.parse(run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", artifacts], packageRoot))[0];
await writeFile(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", join(artifacts, packed.filename)], consumer);
const testSource = (await readFile(new URL("../../packages/lenso-workers-runtime/test/facilities.test.mjs", import.meta.url), "utf8"))
  .replace('from "../facilities.mjs"', 'from "@lenso/workers-runtime/facilities"');
await writeFile(join(consumer, "facilities.test.mjs"), testSource);
const result = run(process.execPath, ["--test", "facilities.test.mjs"], consumer);
const tarball = await readFile(join(artifacts, packed.filename));
const receipt = {
  schema: "lenso.workers-packed-facilities.v1",
  package: packed.name, version: packed.version,
  tarball_sha256: `sha256:${createHash("sha256").update(tarball).digest("hex")}`,
  consumer_directory: consumer, package_integrity: packed.integrity,
  node_version: process.version, runner: "node:test",
  source_imports: false, tests: 4, result: "passed",
  remote_deployment: "not_run", hyperdrive: "not_run",
};
const output = process.argv[2];
if (output) await writeFile(resolve(output), JSON.stringify(receipt, null, 2) + "\n");
console.log(result);
console.log(JSON.stringify(receipt, null, 2));
