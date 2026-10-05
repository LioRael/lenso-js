import { buildPluginTarget } from "@lenso/bun-plugin/targets";

const root = new URL("./", import.meta.url).pathname;
for (const [target, artifact] of [["native-bun", "native.js"], ["workers-js", "plugin.mjs"]] as const) {
  await buildPluginTarget({ entrypoint: `${root}plugin.ts`, exportName: "greeting", outfile: `${root}dist/${artifact}`, target });
}
const result = await Bun.build({ entrypoints: [`${root}worker.ts`], target: "browser", format: "esm" });
if (!result.success || result.outputs.length !== 1) throw new Error(result.logs.map(String).join("\n"));
await Bun.write(`${root}dist/worker.mjs`, result.outputs[0]!);
