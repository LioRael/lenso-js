import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const targets = new Map([
  ['darwin-arm64', { binary: 'lenso', triple: 'aarch64-apple-darwin', os: 'macOS', arch: 'ARM64' }],
  ['darwin-x64', { binary: 'lenso', triple: 'x86_64-apple-darwin', os: 'macOS', arch: 'X64' }],
  ['linux-x64', { binary: 'lenso', triple: 'x86_64-unknown-linux-gnu', os: 'Linux', arch: 'X64' }],
  ['win32-x64', { binary: 'lenso.exe', triple: 'x86_64-pc-windows-msvc', os: 'Windows', arch: 'X64' }],
]);
const sha = /^[0-9a-f]{40}$/;
const digest = /^sha256:[0-9a-f]{64}$/;
const runId = /^[1-9][0-9]*$/;
const receiptSchema = 'lenso.cli.native.v1';
const manifestSchema = 'lenso.cli.npm-candidate.v1';
const workflowPath = '.github/workflows/release-cli-npm.yml';
const workflowId = 368640610;

function regularFile(path) {
  const stat = lstatSync(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), `${path} must be a regular file`);
  return stat;
}

function sha256(path) {
  const hash = createHash('sha256');
  const fd = openSync(path, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const count = readSync(fd, buffer, 0, buffer.length, null);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    closeSync(fd);
  }
  return `sha256:${hash.digest('hex')}`;
}

function inputContext(jsSha, rustSha, id, attempt) {
  assert.match(jsSha, sha, 'JS source must be an exact commit');
  assert.match(rustSha, sha, 'Rust source must be an exact commit');
  assert.match(id, runId, 'workflow run ID must be numeric');
  assert.match(attempt, runId, 'workflow run attempt must be numeric');
  return { js_source_sha: jsSha, rust_source_sha: rustSha, run_id: id, run_attempt: attempt };
}

function metadataFor(artifacts, name, id, jsSha) {
  const matches = artifacts.filter((artifact) => artifact.name === name);
  assert.equal(matches.length, 1, `expected one ${name} artifact`);
  const artifact = matches[0];
  assert.ok(Number.isSafeInteger(artifact.id) && artifact.id > 0, `invalid ${name} artifact ID`);
  assert.match(artifact.digest, digest, `missing ${name} artifact digest`);
  assert.equal(artifact.expired, false, `${name} artifact expired`);
  assert.equal(String(artifact.workflow_run?.id), id, `${name} artifact belongs to another run`);
  assert.equal(artifact.workflow_run?.head_sha, jsSha, `${name} artifact has another source`);
  return { github_artifact_id: artifact.id, github_artifact_digest: artifact.digest };
}

function artifactList(value) {
  assert.ok(Array.isArray(value?.artifacts), 'GitHub artifact list is missing');
  return value.artifacts;
}

function selectNativeArtifact(tag, id, jsSha, api) {
  assert.ok(targets.has(tag), `unsupported target ${tag}`);
  const artifact = metadataFor(artifactList(api), `cli-native-${tag}`, id, jsSha);
  process.stdout.write(`${artifact.github_artifact_id}\t${artifact.github_artifact_digest}\n`);
}

function verifyNativeArchive(archive, tag, expectedDigest) {
  const target = targets.get(tag);
  assert.ok(target, `unsupported target ${tag}`);
  assert.match(expectedDigest, digest);
  regularFile(archive);
  assert.equal(sha256(archive), expectedDigest, `${tag} artifact ZIP digest differs`);
  const entries = execFileSync('unzip', ['-Z1', archive], { encoding: 'utf8' })
    .trimEnd().split('\n');
  const allowed = new Set([`${tag}/`, `${tag}/${target.binary}`, `${tag}/receipt.json`]);
  assert.ok(entries.every((entry) => allowed.has(entry)), `${tag} artifact ZIP has an unexpected path`);
  assert.equal(entries.filter((entry) => entry === `${tag}/${target.binary}`).length, 1);
  assert.equal(entries.filter((entry) => entry === `${tag}/receipt.json`).length, 1);
  assert.equal(new Set(entries).size, entries.length, `${tag} artifact ZIP has duplicate paths`);
}

function exactEntries(directory, names) {
  const stat = lstatSync(directory);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), `${directory} must be a regular directory`);
  assert.deepEqual(readdirSync(directory).sort(), [...names].sort(), `unexpected entries in ${directory}`);
}

function verifyReceipt(receipt, tag, context, artifact) {
  const target = targets.get(tag);
  assert.ok(target, `unsupported target ${tag}`);
  assert.equal(receipt.schema, receiptSchema);
  assert.equal(receipt.tag, tag);
  assert.equal(receipt.target, target.triple);
  assert.equal(receipt.runner_os, target.os);
  assert.equal(receipt.runner_arch, target.arch);
  for (const [key, value] of Object.entries(context)) assert.equal(receipt[key], value, `${tag} ${key} differs`);
  if (artifact) {
    assert.equal(receipt.github_artifact_id, artifact.github_artifact_id);
    assert.equal(receipt.github_artifact_digest, artifact.github_artifact_digest);
  }
  assert.match(receipt.binary_sha256, digest);
  assert.ok(Number.isSafeInteger(receipt.binary_size) && receipt.binary_size > 0);
}

function tarEntry(archive, name) {
  return execFileSync('tar', ['-xOzf', archive, `package/${name}`], {
    maxBuffer: 256 * 1024 * 1024,
  });
}

function packedReceipts(archive, context, artifacts) {
  const packageJson = JSON.parse(tarEntry(archive, 'package.json').toString('utf8'));
  assert.equal(packageJson.name, '@lenso/cli');
  const receipts = [];
  for (const [tag, target] of targets) {
    const receipt = JSON.parse(tarEntry(archive, `vendor/${tag}/receipt.json`).toString('utf8'));
    const artifact = metadataFor(artifacts, `cli-native-${tag}`, context.run_id, context.js_source_sha);
    verifyReceipt(receipt, tag, context, artifact);
    const bytes = tarEntry(archive, `vendor/${tag}/${target.binary}`);
    assert.equal(bytes.length, receipt.binary_size, `${tag} packed size differs`);
    assert.equal(`sha256:${createHash('sha256').update(bytes).digest('hex')}`, receipt.binary_sha256, `${tag} packed bytes differ`);
    receipts.push(receipt);
  }
  return { version: packageJson.version, receipts };
}

function writeReceipt(tag, jsSha, rustSha, id, attempt, binary, output) {
  const context = inputContext(jsSha, rustSha, id, attempt);
  const target = targets.get(tag);
  assert.ok(target, `unsupported target ${tag}`);
  assert.equal(process.env.RUNNER_OS, target.os, `${tag} runner OS differs`);
  assert.equal(process.env.RUNNER_ARCH, target.arch, `${tag} runner architecture differs`);
  const source = resolve(binary);
  const stat = regularFile(source);
  if (tag !== 'win32-x64') assert.ok((stat.mode & 0o111) !== 0, `${tag} binary is not executable`);
  const directory = join(resolve(output), tag);
  assert.ok(!existsSync(directory), `${directory} already exists`);
  mkdirSync(directory, { recursive: true });
  const destination = join(directory, target.binary);
  copyFileSync(source, destination);
  const receipt = {
    schema: receiptSchema,
    tag,
    target: target.triple,
    runner_os: target.os,
    runner_arch: target.arch,
    ...context,
    binary_sha256: sha256(destination),
    binary_size: stat.size,
  };
  writeFileSync(join(directory, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
}

function assemble(artifactRoot, packageRoot, jsSha, rustSha, id, attempt, api) {
  const context = inputContext(jsSha, rustSha, id, attempt);
  const artifacts = artifactList(api);
  exactEntries(artifactRoot, targets.keys());
  const verified = [];
  for (const [tag, target] of targets) {
    const directory = join(artifactRoot, tag);
    exactEntries(directory, [target.binary, 'receipt.json']);
    const receiptPath = join(directory, 'receipt.json');
    regularFile(receiptPath);
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    verifyReceipt(receipt, tag, context);
    const binary = join(directory, target.binary);
    const stat = regularFile(binary);
    assert.equal(stat.size, receipt.binary_size, `${tag} binary size differs`);
    assert.equal(sha256(binary), receipt.binary_sha256, `${tag} binary SHA differs`);
    verified.push({ tag, target, binary, receipt, artifact: metadataFor(artifacts, `cli-native-${tag}`, id, jsSha) });
  }
  const vendor = join(packageRoot, 'vendor');
  assert.ok(!existsSync(vendor), 'CLI vendor directory must be absent before assembly');
  for (const item of verified) {
    const directory = join(vendor, item.tag);
    mkdirSync(directory, { recursive: true });
    copyFileSync(item.binary, join(directory, item.target.binary));
    if (item.tag !== 'win32-x64') chmodSync(join(directory, item.target.binary), 0o755);
    writeFileSync(join(directory, 'receipt.json'), `${JSON.stringify({ ...item.receipt, ...item.artifact }, null, 2)}\n`, { flag: 'wx' });
  }
}

function writeManifest(archive, output, jsSha, rustSha, id, attempt, version, api) {
  const context = inputContext(jsSha, rustSha, id, attempt);
  const artifacts = artifactList(api);
  const stat = regularFile(archive);
  const packed = packedReceipts(archive, context, artifacts);
  assert.equal(packed.version, version, 'packed version differs');
  const manifest = {
    schema: manifestSchema,
    ...context,
    package: '@lenso/cli',
    version,
    archive_sha256: sha256(archive),
    archive_size: stat.size,
    native_receipts: packed.receipts,
  };
  writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  console.log(`Reviewed archive SHA-256: ${manifest.archive_sha256}`);
}

function inspectRun(run, id, jsSha) {
  assert.match(id, runId);
  assert.match(jsSha, sha);
  assert.equal(String(run.id), id);
  assert.equal(run.repository?.full_name, process.env.GITHUB_REPOSITORY);
  assert.equal(run.workflow_id, workflowId, 'candidate came from another workflow');
  assert.ok(
    run.path === workflowPath || run.path?.startsWith(`${workflowPath}@`),
    'candidate came from another workflow',
  );
  assert.equal(run.event, 'workflow_dispatch');
  assert.equal(run.status, 'completed');
  assert.equal(run.conclusion, 'success');
  assert.equal(run.head_sha, jsSha);
  assert.match(String(run.run_attempt), runId);
  appendFileSync(process.env.GITHUB_OUTPUT, `candidate_attempt=${run.run_attempt}\n`);
}

function locateCandidateArtifact(api, id, jsSha) {
  const artifact = metadataFor(artifactList(api), 'cli-npm-candidate', id, jsSha);
  appendFileSync(process.env.GITHUB_OUTPUT, `candidate_artifact_id=${artifact.github_artifact_id}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `candidate_artifact_digest=${artifact.github_artifact_digest}\n`);
}

function verifyCandidate(archive, manifestPath, jsSha, rustSha, id, attempt, version, reviewedSha, candidateArtifactId, candidateArtifactDigest, api) {
  const context = inputContext(jsSha, rustSha, id, attempt);
  assert.match(reviewedSha, digest);
  assert.equal(basename(archive), `lenso-cli-${version}.tgz`);
  assert.equal(resolve(dirname(archive)), resolve(dirname(manifestPath)));
  exactEntries(dirname(archive), [basename(archive), 'manifest.json']);
  const artifacts = artifactList(api);
  const candidate = metadataFor(artifacts, 'cli-npm-candidate', id, jsSha);
  assert.equal(candidate.github_artifact_id, Number(candidateArtifactId));
  assert.equal(candidate.github_artifact_digest, candidateArtifactDigest);
  regularFile(manifestPath);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.schema, manifestSchema);
  for (const [key, value] of Object.entries(context)) assert.equal(manifest[key], value);
  assert.equal(manifest.package, '@lenso/cli');
  assert.equal(manifest.version, version);
  assert.equal(manifest.archive_sha256, reviewedSha);
  assert.equal(manifest.archive_size, regularFile(archive).size);
  assert.equal(sha256(archive), reviewedSha);
  const packed = packedReceipts(archive, context, artifacts);
  assert.equal(packed.version, version);
  assert.deepEqual(packed.receipts, manifest.native_receipts);
  console.log(`Candidate archive and four native receipts verified: ${reviewedSha}`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'receipt') return writeReceipt(...args);
  if (command === 'inspect-run') return inspectRun(JSON.parse(await readStdin()), ...args);
  if (command === 'locate-candidate') return locateCandidateArtifact(JSON.parse(await readStdin()), ...args);
  if (command === 'select-native') return selectNativeArtifact(...args, JSON.parse(await readStdin()));
  if (command === 'verify-native-archive') return verifyNativeArchive(...args);
  if (command === 'assemble') return assemble(...args, JSON.parse(await readStdin()));
  if (command === 'manifest') return writeManifest(...args, JSON.parse(await readStdin()));
  if (command === 'verify-candidate') return verifyCandidate(...args, JSON.parse(await readStdin()));
  throw new Error(`unknown CLI release artifact command: ${command}`);
}

async function readStdin() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
