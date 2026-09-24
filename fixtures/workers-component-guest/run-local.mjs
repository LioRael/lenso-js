import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const wrangler = process.env.WRANGLER_JS;
if (!wrangler) throw new Error("WRANGLER_JS is required");
const directory = dirname(fileURLToPath(import.meta.url));
const child = spawn(process.execPath, [
  wrangler, "dev", "--local", "--config", resolve(directory, "wrangler.jsonc"),
  "--ip", "127.0.0.1", "--port", "63739",
], {
  cwd: resolve(directory, "../.."),
  env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
for (const stream of [child.stdout, child.stderr]) {
  stream.on("data", (chunk) => { output = (output + chunk).slice(-16_384); });
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) break;
    try {
      const response = await fetch("http://127.0.0.1:63739/_component/build", {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch { /* The local listener is not ready yet. */ }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error(`local workerd did not become ready: ${output}`);
  const smoke = spawnSync(process.execPath, [resolve(directory, "smoke.mjs")], {
    env: process.env,
    stdio: "inherit",
    timeout: 30_000,
  });
  if (smoke.error) throw smoke.error;
  if (smoke.status !== 0) throw new Error(`Component smoke failed (${smoke.status}): ${output}`);
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
}
