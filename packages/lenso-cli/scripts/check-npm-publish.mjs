import assert from 'node:assert/strict';
import { closeSync, lstatSync, openSync, readSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const required = [
  ['darwin-arm64', 'lenso', 0x0100000c],
  ['darwin-x64', 'lenso', 0x01000007],
  ['linux-x64', 'lenso', 0x3e],
  ['win32-x64', 'lenso.exe', 0x8664]
];

for (const [tag, exe, machine] of required) {
  const relativePath = `vendor/${tag}/${exe}`;
  const binary = path.join(root, 'vendor', tag, exe);
  let info;
  try {
    info = lstatSync(binary);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`missing ${relativePath}`);
    }
    throw error;
  }
  assert.ok(info.isFile(), `${relativePath} must be a regular file`);
  if (tag !== 'win32-x64') {
    assert.ok((info.mode & 0o111) !== 0, `${relativePath} must be executable`);
  }

  const fd = openSync(binary, 'r');
  try {
    const header = Buffer.alloc(64);
    assert.equal(readSync(fd, header, 0, header.length, 0), header.length, `${relativePath} has a short header`);
    if (tag.startsWith('darwin-')) {
      assert.equal(header.readUInt32LE(0), 0xfeedfacf, `${relativePath} must be 64-bit Mach-O`);
      assert.equal(header.readUInt32LE(4), machine, `${relativePath} has the wrong CPU type`);
    } else if (tag.startsWith('linux-')) {
      assert.equal(header.toString('latin1', 0, 4), '\x7fELF', `${relativePath} must be ELF`);
      assert.equal(header[4], 2, `${relativePath} must be 64-bit ELF`);
      assert.equal(header[5], 1, `${relativePath} must be little-endian ELF`);
      assert.equal(header.readUInt16LE(18), machine, `${relativePath} has the wrong CPU type`);
    } else {
      assert.equal(header.toString('latin1', 0, 2), 'MZ', `${relativePath} must be PE`);
      const peOffset = header.readUInt32LE(0x3c);
      assert.ok(peOffset <= info.size - 6, `${relativePath} has an invalid PE offset`);
      const peHeader = Buffer.alloc(6);
      assert.equal(readSync(fd, peHeader, 0, peHeader.length, peOffset), peHeader.length, `${relativePath} has a short PE header`);
      assert.equal(peHeader.toString('latin1', 0, 4), 'PE\0\0', `${relativePath} must be PE`);
      assert.equal(peHeader.readUInt16LE(4), machine, `${relativePath} has the wrong CPU type`);
    }
  } finally {
    closeSync(fd);
  }
}

console.log('npm native binary shape check passed');
