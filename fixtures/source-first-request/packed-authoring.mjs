// Ordinary npm package qualification. No Plugin Bundle or Rust build is involved.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const workspace = fileURLToPath(new URL("../../", import.meta.url));
const output = process.argv[2];
if (!output) throw new Error("Pass the JSON qualification receipt path");
const directory = await fs.mkdtemp(path.join(os.tmpdir(), "lenso-packed-authoring-"));
const run = (command, args, cwd = directory) => {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 120_000 });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")}: ${result.error ?? result.stderr ?? result.stdout}`);
  return result.stdout;
};
const archives = JSON.parse(run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", directory,
  "./packages/lenso-contract-runtime", "./packages/lenso-bun-plugin"], workspace));
const dependencies = {};
for (const archive of archives) dependencies[archive.name] = "file:" + path.join(directory, archive.filename);
await fs.writeFile(path.join(directory, "package.json"), JSON.stringify({
  private: true, type: "module", dependencies,
  devDependencies: { typescript: "7.0.2", "@types/bun": "1.4.0" },
}, null, 2));
run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"]);
const lock = JSON.parse(await fs.readFile(path.join(directory, "package-lock.json")));
const protocolIdentity = lock.packages["node_modules/@lenso/process-protocol"];
assert.equal(protocolIdentity.version, "0.2.4");
assert.equal(protocolIdentity.resolved, "https://registry.npmjs.org/@lenso/process-protocol/-/process-protocol-0.2.4.tgz");
assert.equal(typeof protocolIdentity.integrity, "string");
const pluginManifest = JSON.parse(await fs.readFile(path.join(directory, "node_modules/@lenso/bun-plugin/package.json")));
const runtimeManifest = JSON.parse(await fs.readFile(path.join(directory, "node_modules/@lenso/contract-runtime/package.json")));
assert.equal(pluginManifest.dependencies["@lenso/contract-runtime"], runtimeManifest.version);
assert.equal(pluginManifest.dependencies["@lenso/process-protocol"], "0.2.4");
assert.equal(JSON.parse(await fs.readFile(path.join(directory, "node_modules/@lenso/process-protocol/package.json"))).version, "0.2.4");
for (const subpath of ["./authoring", "./targets"]) {
  for (const condition of ["import", "types"]) {
    const entry = pluginManifest.exports[subpath]?.[condition];
    assert.equal(typeof entry, "string", `${subpath} ${condition}`);
    await fs.access(path.join(directory, "node_modules/@lenso/bun-plugin", entry));
  }
}
await fs.writeFile(path.join(directory, "consume.mjs"), `
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { definePlugin, configuration, dependency } from '@lenso/bun-plugin/authoring';
import { lowerProviderStreamWithCleanup } from '@lenso/contract-runtime';
for (const value of [definePlugin, configuration, dependency, lowerProviderStreamWithCleanup]) assert.equal(typeof value, 'function');
assert.equal(typeof createRequire(import.meta.url)('@lenso/contract-runtime').lowerProviderStreamWithCleanup, 'function');
let produced = 0, cleaned = false;
const stream = lowerProviderStreamWithCleanup((async function* () {
  try { produced++; yield 7; }
  finally { await Promise.resolve(); cleaned = true; }
})(), () => new Error('no inbound'));
assert.equal(produced, 0);
assert.deepEqual(await stream.receive(), { kind: 'message', message: 7 });
await stream.cancel(); await stream.closed;
assert.equal(cleaned, true);
console.log('packed authoring + ESM/CJS runtime + physical cleanup passed');
`);
const node = run("node", ["consume.mjs"]);
const bun = run("bun", ["consume.mjs"]);
await fs.writeFile(path.join(directory, "plugin.ts"), `import { definePlugin } from '@lenso/bun-plugin/authoring';
export default definePlugin({ provides: [], create() { throw new Error('build must not execute create'); } });
`);
await fs.writeFile(path.join(directory, "build.ts"), `import { buildPluginTarget, createPluginTargetBuildPlugin } from '@lenso/bun-plugin/targets';
if (typeof createPluginTargetBuildPlugin !== 'function') throw new Error('missing target compiler hook');
await buildPluginTarget({ entrypoint: './plugin.ts', outfile: './native.mjs', target: 'native-bun' });
await buildPluginTarget({ entrypoint: './plugin.ts', outfile: './worker.mjs', target: 'workers-js' });
`);
run("bun", ["build.ts"]);
assert.equal(typeof (await import(path.join(directory, "worker.mjs"))).default.create, "function");
await fs.writeFile(path.join(directory, "tsconfig.json"), JSON.stringify({
  compilerOptions: { noEmit: true, strict: true, target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", types: ["bun"], skipLibCheck: false },
  include: ["plugin.ts", "build.ts"],
}));
run(path.join(directory, "node_modules/.bin/tsc"), ["-p", "tsconfig.json"]);
const artifacts = [];
for (const archive of archives) {
  const bytes = await fs.readFile(path.join(directory, archive.filename));
  artifacts.push({ name: archive.name, version: archive.version, filename: archive.filename,
    path: path.join(directory, archive.filename), integrity: archive.integrity,
    sha256: createHash("sha256").update(bytes).digest("hex") });
}
const receipt = { schema: "lenso.packed-authoring.v1", source_sha: run("git", ["rev-parse", "HEAD"], workspace).trim(),
  source_dirty: Boolean(run("git", ["status", "--porcelain"], workspace).trim()),
  directory, artifacts, node: node.trim(), bun: bun.trim(),
  process_protocol: "0.2.4", process_protocol_identity: protocolIdentity,
  target_builds: ["native-bun", "workers-js"], typecheck: "passed", result: "passed",
  scope: "ordinary isolated npm package install, exports/types and target build; no Relay App or publication proof" };
await fs.writeFile(output, JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify(receipt));
