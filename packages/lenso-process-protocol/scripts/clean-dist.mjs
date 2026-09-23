import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const distribution = fileURLToPath(new URL("../dist/", import.meta.url));
rmSync(distribution, { force: true, recursive: true });
