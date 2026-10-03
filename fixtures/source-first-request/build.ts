import { buildPluginTarget } from "@lenso/bun-plugin/targets";

const root = new URL("./", import.meta.url).pathname;
await buildPluginTarget({
  entrypoint: `${root}plugin.ts`, outfile: `${root}dist/native.js`, target: "native-bun",
});
await buildPluginTarget({
  entrypoint: `${root}plugin.ts`, outfile: `${root}dist/plugin.mjs`, target: "workers-js",
});
const result = await Bun.build({ entrypoints: [`${root}worker.mjs`], target: "browser", format: "esm" });
if (!result.success) throw new Error(result.logs.map(String).join("\n"));
await Bun.write(`${root}dist/worker.mjs`, result.outputs[0]!);
