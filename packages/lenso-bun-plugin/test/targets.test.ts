import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildPluginTarget } from "../src/targets.ts";

test("portable source bundles for both targets without invoking Plugin create", async () => {
  const root = new URL("../../../", import.meta.url).pathname;
  const temporary = await mkdtemp(join(root, ".target-test-"));
  try {
    const source = join(temporary, "plugin.ts");
    await writeFile(source, 'import { definePlugin } from "@lenso/bun-plugin/authoring"; export default definePlugin({provides: [], create() { throw new Error("must not run at build"); }});');
    await buildPluginTarget({ entrypoint: source, outfile: join(temporary, "worker.mjs"), target: "workers-js" });
    await buildPluginTarget({ entrypoint: source, outfile: join(temporary, "native.mjs"), target: "native-bun" });
    const worker = await Bun.file(join(temporary, "worker.mjs")).text();
    expect(worker).not.toContain("Bun.serve");
    expect(worker).not.toContain("node:readline");
    const definition = (await import(join(temporary, "worker.mjs"))).default;
    expect(definition.create).toBeFunction();
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("Workers target rejects incompatible APIs before module evaluation", async () => {
  const root = new URL("../../../", import.meta.url).pathname;
  const temporary = await mkdtemp(join(root, ".target-test-"));
  try {
    for (const [source, diagnostic] of [
      ['export default Bun.file("data");', "runtime API Bun"],
      ['export default process.env.TOKEN;', "runtime API process"],
      ['import { readFileSync } from "node:fs"; export default readFileSync("x");', "cannot import node:fs"],
      ['import { readFileSync } from "fs"; export default readFileSync("x");', "cannot import fs"],
      ['import { definePlugin } from "@lenso/bun-plugin"; export default definePlugin({providers: []});', "cannot import @lenso/bun-plugin"],
      ['export default globalThis.Bun;', "runtime API Bun"],
      ['export default globalThis["Bun"];', "computed global access"],
    ]) {
      const path = join(temporary, "plugin.ts");
      await writeFile(path, source!);
      await expect(buildPluginTarget({ entrypoint: path, outfile: join(temporary, "worker.mjs"), target: "workers-js" })).rejects.toThrow(diagnostic!);
    }
    expect(await Bun.file(join(temporary, "worker.mjs")).exists()).toBe(false);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
