import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("published HTTP egress package exposes its event transports", async () => {
  const entry = await import("@lenso/http-egress-workers");
  assert.equal(typeof entry.createEventHttpFetch, "function");
  assert.equal(typeof entry.createScopedHttpFetch, "function");
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(manifest.repository.directory, "packages/lenso-http-egress-workers");
  await access(new URL("../LICENSE", import.meta.url));
});
