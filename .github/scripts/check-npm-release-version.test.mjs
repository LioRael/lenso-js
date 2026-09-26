import assert from 'node:assert/strict';
import test from 'node:test';
import { assertNpmVersionUnpublished } from './check-npm-release-version.mjs';

const name = '@lenso/contract-runtime';
const version = '0.3.1';

test('rejects an exact version already published', async () => {
  await assert.rejects(
    assertNpmVersionUnpublished(name, version, async (url, options) => {
      assert.equal(url.href, 'https://registry.npmjs.org/%40lenso%2Fcontract-runtime/0.3.1');
      assert.equal(options.headers.accept, 'application/json');
      assert.equal(options.redirect, 'error');
      return new Response(JSON.stringify({ name, version }), { status: 200 });
    }),
    /already published/,
  );
});

test('accepts an exact version 404 without interpreting other errors as absence', async () => {
  await assert.doesNotReject(
    assertNpmVersionUnpublished(name, version, async () => new Response('', { status: 404 })),
  );
});

for (const status of [403, 429, 503]) {
  test(`rejects HTTP ${status}`, async () => {
    await assert.rejects(
      assertNpmVersionUnpublished(name, version, async () => new Response('', { status })),
      new RegExp(`HTTP ${status}`),
    );
  });
}

test('rejects a network failure', async () => {
  await assert.rejects(
    assertNpmVersionUnpublished(name, version, async () => { throw new Error('network unavailable'); }),
    /network unavailable/,
  );
});

test('rejects malformed or mismatched successful metadata', async () => {
  await assert.rejects(
    assertNpmVersionUnpublished(name, version, async () => new Response('not json', { status: 200 })),
    SyntaxError,
  );
  await assert.rejects(
    assertNpmVersionUnpublished(name, version, async () => new Response(JSON.stringify({ name, version: '0.3.0' }), { status: 200 })),
    /mismatched metadata/,
  );
});
