import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const registry = 'https://registry.npmjs.org/';

export async function assertNpmVersionUnpublished(name, version, fetchVersion = fetch) {
  const url = new URL(`${encodeURIComponent(name)}/${encodeURIComponent(version)}`, registry);
  const response = await fetchVersion(url, {
    headers: { accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });

  // A version-specific 404 can also hide access policy; it is not provenance
  // proof. npm publish must still atomically reject an occupied version.
  if (response.status === 404) return;
  if (response.status !== 200) {
    throw new Error(`npm registry returned HTTP ${response.status} for ${name}@${version}`);
  }

  const release = await response.json();
  if (release?.name !== name || release?.version !== version) {
    throw new Error(`npm registry returned mismatched metadata for ${name}@${version}`);
  }
  throw new Error(`${name}@${version} is already published`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [name, version] = process.argv.slice(2);
  if (!name || !version) {
    console.error('Usage: node .github/scripts/check-npm-release-version.mjs <package> <version>');
    process.exitCode = 2;
  } else {
    try {
      await assertNpmVersionUnpublished(name, version);
      console.log(`${name}@${version} is not present in the public npm registry`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
