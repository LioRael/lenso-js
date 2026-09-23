import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("published Web ingress package exposes its WebSocket transport", async () => {
  const entry = await import("@lenso/web-ingress-workers");
  assert.equal(typeof entry.createWebSocketTransport, "function");
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(manifest.repository.directory, "packages/lenso-web-ingress-workers");
  await access(new URL("../LICENSE", import.meta.url));
});
