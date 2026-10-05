import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { extractPluginDefinition, extractPluginInventory, DeclarationExtractionError } from "../src/extract.ts";
import { definePlugin } from "../src/authoring.ts";
import { buildPluginTarget } from "../src/targets.ts";
import { prepareWorkersRequestPlugin } from "../../lenso-workers-runtime/plugin.mjs";
import type { PluginDefinition, LifecycleContext } from "../src/authoring.ts";

const root = new URL("../../../fixtures/source-inventory/", import.meta.url).pathname;
const workspace = new URL("../../../", import.meta.url).pathname;

test("inventory identifies two exported Plugins, merges reexports, and ignores helpers", async () => {
  const inventory = await extractPluginInventory({ packageRoot: root, entryFiles: ["reexports.ts", "plugin.ts"], releaseVersion: "1.0.0" });
  expect(inventory).toMatchObject({ api_version: 1, plugins: [
    { plugin_id: "example.greeting", release_version: "1.0.0", root_slot: "tools", source_file: "plugin.ts", export_name: "greeting" },
    { plugin_id: "example.unused", release_version: "2.0.0", root_slot: "tools", source_file: "plugin.ts", export_name: "unused" },
  ] });
  expect(inventory.plugins).toHaveLength(2);
  const declaration = await extractPluginDefinition({
    entryFile: join(root, "reexports.ts"), exportName: "welcome",
    classifySymbol(origin) {
      if (origin.name === "definePlugin") return { kind: "plugin_definition" };
      if (origin.name === "configuration") return { kind: "declaration", package: { name: "@lenso/bun-plugin", version: "0.4.3", integrity: "locked" }, export_name: "configuration", handler_parameters: [1] };
      if (origin.name === "Profile") return { kind: "contract", capability_id: "example.profile@1", descriptor_version: "1.0.0", descriptor_digest: `sha256:${"c".repeat(64)}`, generated_module: origin.file, generated_export: "Profile" };
    },
  });
  expect(declaration.metadata?.pluginId).toBe("example.greeting");
  expect(declaration.span.file).toEndWith("plugin.ts");
});

test("inventory reads metadata only and never evaluates declarations or top-level effects", async () => {
  const temporary = await mkdtemp(join(workspace, ".inventory-test-"));
  try {
    const source = join(temporary, "plugin.ts");
    await writeFile(join(temporary, "a-barrel.ts"), 'export { selected as welcome } from "./plugin.ts";');
    await writeFile(source, `
      import { definePlugin as plugin } from "@lenso/bun-plugin/authoring";
      const identity = {pluginId:"example.static",rootSlot:"tools"} as const;
      throw new Error("discovery must not evaluate this module");
      const selected = plugin({metadata:{...identity},provides:unexpectedCall(),create(){throw new Error("must not start");}});
      export { selected, selected as first, selected as alias };
      export default selected;
      export const helper = () => unexpectedCall();
    `);
    const result = await extractPluginInventory({ packageRoot: temporary, entryFiles: ["a-barrel.ts", "plugin.ts"], releaseVersion: "1.0.0" });
    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0]?.plugin_id).toBe("example.static");
    expect(result.plugins[0]?.export_name).toBe("selected");
    expect(result.plugins[0]?.source_file).toBe("plugin.ts");
    await writeFile(join(temporary, "package.json"), '{"version":"1.0.0"}');
    const process = Bun.spawn([Bun.which("bun")!, join(workspace, "packages/lenso-bun-plugin/dist/extract.js"), "--inventory", temporary, "plugin.ts"], { stdout: "pipe", stderr: "pipe" });
    const output = await new Response(process.stdout).text();
    const error = await new Response(process.stderr).text();
    expect(await process.exited, error).toBe(0);
    expect(JSON.parse(output)).toMatchObject({ api_version: 1, plugins: [{ plugin_id: "example.static", release_version: "1.0.0" }] });
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("inventory rejects distinct duplicate IDs and missing/dynamic source identity", async () => {
  const temporary = await mkdtemp(join(workspace, ".inventory-test-"));
  try {
    for (const [body, message] of [
      ['export const a=p({metadata:{pluginId:"example.same",rootSlot:"tools"},provides:[]});export const b=p({metadata:{pluginId:"example.same",rootSlot:"tools"},provides:[]});', "duplicate Plugin ID example.same"],
      ['export default p({provides:[]});', "requires metadata"],
      ['export default p({metadata:{pluginId:"example.test"},provides:[]});', "metadata.rootSlot"],
      ['export default p({metadata:{pluginId:process.env.ID,rootSlot:"tools"},provides:[]});', "runtime property access"],
      ['const a=p({metadata:{pluginId:"example.test",rootSlot:"tools"},provides:[]});export {a as ""};', "export name must not be empty"],
      ['export let a=p({metadata:{pluginId:"example.test",rootSlot:"tools"},provides:[]});', "const declaration"],
    ]) {
      await writeFile(join(temporary, "plugin.ts"), `import {definePlugin as p} from "@lenso/bun-plugin/authoring";${body}`);
      try {
        await extractPluginInventory({ packageRoot: temporary, entryFiles: ["plugin.ts"], releaseVersion: "1.0.0" });
        throw new Error("expected extraction failure");
      } catch (error) {
        expect(error).toBeInstanceOf(DeclarationExtractionError);
        expect((error as Error).message).toContain(message!);
        expect((error as DeclarationExtractionError).span.file).toEndWith("plugin.ts");
      }
    }
    await writeFile(join(temporary, "plugin.ts"), 'import {definePlugin as p} from "@lenso/bun-plugin/authoring";export default p({metadata:{pluginId:"example.test",rootSlot:"tools"},provides:[]});');
    await expect(extractPluginInventory({ packageRoot: temporary, entryFiles: [join(root, "plugin.ts")], releaseVersion: "1.0.0" })).rejects.toThrow("inside its package root");
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("Core inventory command reports missing package version and does not leave a process running", async () => {
  const temporary = await mkdtemp(join(workspace, ".inventory-version-"));
  try {
    await writeFile(join(temporary, "package.json"), '{}');
    await writeFile(join(temporary, "version.ts"), 'import {definePlugin} from "@lenso/bun-plugin/authoring";export const versioned=definePlugin({metadata:{pluginId:"example.version",rootSlot:"tools"},provides:[]});');
    const child = Bun.spawn([Bun.which("bun")!, join(workspace, "packages/lenso-bun-plugin/dist/extract.js"), "--inventory", temporary, "version.ts"], { stdout: "pipe", stderr: "pipe" });
    expect(await new Response(child.stderr).text()).toContain("releaseVersion");
    expect(await child.exited).not.toBe(0);
    expect(await new Response(child.stdout).text()).toBe("");
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test("definePlugin preserves immutable source metadata without starting a generation", () => {
  const metadata = { pluginId: "example.metadata", rootSlot: "tools", releaseVersion: "1.0.0" };
  const definition = definePlugin({ metadata, provides: [], create() { throw new Error("must not construct"); } });
  metadata.pluginId = "example.changed";
  expect(definition.metadata).toEqual({ pluginId: "example.metadata", rootSlot: "tools", releaseVersion: "1.0.0" });
  expect(Object.isFrozen(definition.metadata)).toBe(true);
  expect(() => definePlugin({ metadata: { pluginId: "", rootSlot: "tools" }, provides: [] })).toThrow("pluginId");
});

test("selected named export constructs two independent Workers Request instances", async () => {
  const temporary = await mkdtemp(join(workspace, ".inventory-target-"));
  try {
    const artifact = join(temporary, "worker.js");
    await buildPluginTarget({ entrypoint: join(root, "plugin.ts"), exportName: "greeting", outfile: artifact, target: "workers-js" });
    const definition = (await import(artifact)).default as PluginDefinition<object>;
    const descriptor = definition.providers[0]!.descriptor;
    const lifecycle = { requestId: "1", cancelled: false, signal: new AbortController().signal, remainingTimeoutMs: () => 1000 } as LifecycleContext;
    const provider = await prepareWorkersRequestPlugin(definition, { providedEndpoints: [descriptor], configuration: { prefix: "provider-a" }, dependencies: { upstream: [] }, lifecycle });
    const consumer = await prepareWorkersRequestPlugin(definition, {
      providedEndpoints: [descriptor], configuration: { prefix: "consumer-b" },
      dependencies: { upstream: [{ providerInstance: "provider-a", descriptor, invokeRequest: (operation, context, payload) => provider.invokeRequest(descriptor.capability_id, operation, context, payload) }] }, lifecycle,
    });
    try {
      const call = (instance: typeof consumer) => instance.invokeRequest(descriptor.capability_id, "corpus_round_trip", lifecycle, { value: { name: "Ada" } });
      expect(await call(consumer)).toMatchObject({ kind: "success", value: { value: { message: "hello consumer-b", calls: 1, upstream: { message: "hello provider-a", calls: 1 } } } });
      expect(await call(provider)).toMatchObject({ kind: "success", value: { value: { message: "hello provider-a", calls: 2 } } });
      expect(await call(consumer)).toMatchObject({ kind: "success", value: { value: { message: "hello consumer-b", calls: 2, upstream: { calls: 3 } } } });
    } finally { await consumer.stop(lifecycle); await provider.stop(lifecycle); }
    await expect(buildPluginTarget({ entrypoint: join(root, "plugin.ts"), exportName: "missing", outfile: artifact, target: "workers-js" })).rejects.toThrow("No matching export");
  } finally { await rm(temporary, { recursive: true, force: true }); }
});
