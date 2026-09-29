import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("workspace package preserves its public Workers entrypoints and CLI", async () => {
  const root = await import("@lenso/workers-runtime");
  const host = await import("@lenso/workers-runtime/host");
  const facilities = await import("@lenso/workers-runtime/facilities");
  const http = await import("@lenso/workers-runtime/http");
  const runner = await import("@lenso/workers-runtime/runner");
  const clock = await import("@lenso/workers-runtime/clock");
  const build = await import("@lenso/workers-runtime/build");
  const component = await import("@lenso/workers-runtime/component-requests");
  const knowledgeSettings = await import("@lenso/workers-runtime/knowledge-settings-local");

  assert.equal(root.createWorkersHttpHost, host.createWorkersHttpHost);
  assert.equal(root.createInstanceFacilityScope, facilities.createInstanceFacilityScope);
  assert.equal(root.createHttpHandler, http.createHttpHandler);
  assert.equal(root.createEventRunner, runner.createEventRunner);
  assert.equal(typeof root.createEventScope, "function");
  assert.equal(typeof clock.clearTimers, "function");
  assert.equal(typeof build.build, "function");
  assert.equal(typeof component.createWorkersComponentRequestAdapter, "function");
  assert.equal(typeof knowledgeSettings.createKnowledgeSettingsLocalWorkerAdapter, "function");

  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(manifest.bin["lenso-workers-build"], "./build.mjs");
  assert.equal(
    manifest.repository.directory,
    "packages/lenso-workers-runtime",
  );
  assert.match(
    await readFile(new URL("../build.mjs", import.meta.url), "utf8"),
    /^#!\/usr\/bin\/env node/,
  );
  await access(new URL("../LICENSE", import.meta.url));
});
