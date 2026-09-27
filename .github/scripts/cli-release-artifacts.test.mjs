import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, cpSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('./cli-release-artifacts.mjs', import.meta.url));
const packageRoot = fileURLToPath(new URL('../../packages/lenso-cli/', import.meta.url));
const version = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).version;
const jsSha = 'a'.repeat(40);
const rustSha = 'b'.repeat(40);
const id = '123';
const attempt = '1';
const targets = [
  ['darwin-arm64', 'lenso', 'macOS', 'ARM64', 0x0100000c],
  ['darwin-x64', 'lenso', 'macOS', 'X64', 0x01000007],
  ['linux-x64', 'lenso', 'Linux', 'X64', 0x3e],
  ['win32-x64', 'lenso.exe', 'Windows', 'X64', 0x8664],
];

function invoke(args, input, extraEnv = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    input: input === undefined ? undefined : JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  });
}

function binary(tag, machine) {
  const bytes = Buffer.alloc(128);
  if (tag.startsWith('darwin-')) {
    bytes.writeUInt32LE(0xfeedfacf, 0);
    bytes.writeUInt32LE(machine, 4);
  } else if (tag.startsWith('linux-')) {
    bytes.write('\x7fELF', 0, 'latin1');
    bytes[4] = 2;
    bytes[5] = 1;
    bytes.writeUInt16LE(machine, 18);
  } else {
    bytes.write('MZ', 0, 'latin1');
    bytes.writeUInt32LE(64, 0x3c);
    bytes.write('PE\0\0', 64, 'latin1');
    bytes.writeUInt16LE(machine, 68);
  }
  return bytes;
}

test('CLI candidate binds packed binary bytes to four source and artifact receipts', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'lenso-cli-release-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const native = path.join(root, 'native');
  const nativeArchives = path.join(root, 'native-zips');
  const candidatePackage = path.join(root, 'package');
  const release = path.join(root, 'release');
  mkdirSync(source);
  mkdirSync(nativeArchives);
  mkdirSync(candidatePackage);
  mkdirSync(release);
  copyFileSync(path.join(packageRoot, 'package.json'), path.join(candidatePackage, 'package.json'));
  copyFileSync(path.join(packageRoot, 'README.md'), path.join(candidatePackage, 'README.md'));
  cpSync(path.join(packageRoot, 'bin'), path.join(candidatePackage, 'bin'), { recursive: true });
  mkdirSync(path.join(candidatePackage, 'scripts'));
  copyFileSync(path.join(packageRoot, 'scripts/check-npm-publish.mjs'), path.join(candidatePackage, 'scripts/check-npm-publish.mjs'));

  const artifacts = [];
  for (const [index, [tag, exe, runnerOs, runnerArch, machine]] of targets.entries()) {
    const file = path.join(source, `${tag}-${exe}`);
    writeFileSync(file, binary(tag, machine));
    chmodSync(file, 0o755);
    const result = invoke(['receipt', tag, jsSha, rustSha, id, attempt, file, native], undefined, {
      RUNNER_OS: runnerOs,
      RUNNER_ARCH: runnerArch,
    });
    assert.equal(result.status, 0, result.stderr);
    const archive = path.join(nativeArchives, `${tag}.zip`);
    const zipped = spawnSync('zip', ['-q', '-r', archive, tag], { cwd: native, encoding: 'utf8' });
    assert.equal(zipped.status, 0, zipped.stderr);
    const archiveDigest = `sha256:${createHash('sha256').update(readFileSync(archive)).digest('hex')}`;
    artifacts.push({
      id: index + 100,
      name: `cli-native-${tag}`,
      digest: archiveDigest,
      expired: false,
      workflow_run: { id: Number(id), head_sha: jsSha },
    });
    const selected = invoke(['select-native', tag, id, jsSha], { artifacts: [artifacts.at(-1)] });
    assert.equal(selected.status, 0, selected.stderr);
    assert.equal(selected.stdout.trim(), `${index + 100}\t${archiveDigest}`);
    assert.equal(invoke(['verify-native-archive', archive, tag, archiveDigest]).status, 0);
    assert.notEqual(invoke(['verify-native-archive', archive, tag, `sha256:${'0'.repeat(64)}`]).status, 0);
  }
  artifacts.push({
    id: 999,
    name: 'cli-npm-candidate',
    digest: `sha256:${'f'.repeat(64)}`,
    expired: false,
    workflow_run: { id: Number(id), head_sha: jsSha },
  });
  const api = { artifacts };
  let result = invoke(['assemble', native, candidatePackage, jsSha, rustSha, id, attempt], api);
  assert.equal(result.status, 0, result.stderr);
  result = spawnSync('npm', ['pack', candidatePackage, '--offline', '--pack-destination', release], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const archive = path.join(release, readdirSync(release).find((name) => name.endsWith('.tgz')));
  const manifestPath = path.join(release, 'manifest.json');
  result = invoke(['manifest', archive, manifestPath, jsSha, rustSha, id, attempt, version], api);
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  assert.equal(manifest.native_receipts.length, 4);
  result = invoke([
    'verify-candidate', archive, manifestPath, jsSha, rustSha, id, attempt, version,
    manifest.archive_sha256, '999', `sha256:${'f'.repeat(64)}`,
  ], api);
  assert.equal(result.status, 0, result.stderr);

  const changed = structuredClone(api);
  changed.artifacts[0].digest = `sha256:${'0'.repeat(64)}`;
  result = invoke([
    'verify-candidate', archive, manifestPath, jsSha, rustSha, id, attempt, version,
    manifest.archive_sha256, '999', `sha256:${'f'.repeat(64)}`,
  ], changed);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Expected values to be strictly equal|differs/);
});

test('publish selection rejects an incomplete or unrelated candidate run', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'lenso-cli-run-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = path.join(root, 'github-output');
  const run = {
    id: Number(id),
    repository: { full_name: 'LioRael/lenso-js' },
    path: '.github/workflows/release-cli-npm.yml@refs/heads/candidate/cli',
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'success',
    head_sha: jsSha,
    run_attempt: Number(attempt),
  };
  const env = { GITHUB_REPOSITORY: 'LioRael/lenso-js', GITHUB_OUTPUT: output };
  let result = invoke(['inspect-run', id, jsSha], run, env);
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(output, 'utf8'), /candidate_attempt=1/);
  result = invoke(['inspect-run', id, jsSha], { ...run, conclusion: 'failure' }, env);
  assert.notEqual(result.status, 0);
  result = invoke(['inspect-run', id, jsSha], { ...run, path: '.github/workflows/other.yml@main' }, env);
  assert.notEqual(result.status, 0);
  result = invoke(['inspect-run', id, jsSha], { ...run, head_sha: rustSha }, env);
  assert.notEqual(result.status, 0);
});
