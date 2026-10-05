import { expect, test } from "bun:test";

test("published package exports the Bun Plugin authoring surface", async () => {
  const module = await import("@lenso/bun-plugin");
  expect(module.configuration).toBeFunction();
  expect(module.definePlugin).toBeFunction();
  expect(module.serve).toBeFunction();
  expect(module.startPlugin).toBeFunction();
  expect(module.startProcessV1).toBeFunction();
  expect(module.serveProcessV1).toBeFunction();
});

test("published package exports build and extraction entrypoints", async () => {
  const build = await import("@lenso/bun-plugin/build");
  const extract = await import("@lenso/bun-plugin/extract");
  expect(build.runLowering).toBeFunction();
  expect(build.fingerprintBuildInputs).toBeFunction();
  expect(extract.extractPluginDefinition).toBeFunction();
  expect(extract.extractPluginInventory).toBeFunction();
});

test("published pure authoring entry loads independently of Bun transport", async () => {
  const authoring = await import("@lenso/bun-plugin/authoring");
  expect(authoring.definePlugin).toBeFunction();
  expect(authoring.dependency).toBeFunction();
  expect(authoring.configuration).toBeFunction();
  const targets = await import("@lenso/bun-plugin/targets");
  expect(targets.buildPluginTarget).toBeFunction();
  expect(targets.createPluginTargetBuildPlugin).toBeFunction();
});
