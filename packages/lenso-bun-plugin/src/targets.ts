import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import ts from "typescript-parser";
import { builtinModules } from "node:module";
import { lowerGeneratedStreamModule } from "./stream-lowering.js";
import type { BunPlugin } from "bun";

export type PluginTarget = "native-bun" | "workers-js";

/**
 * Compile one source definition for an explicit target. Native uses the existing
 * Bun V2 process entry; Workers exports the definition for its JS Host adapter.
 * This does not generate a Plan, select dependencies or start an application.
 */
export async function buildPluginTarget(options: {
  readonly entrypoint: string;
  readonly outfile: string;
  readonly target: PluginTarget;
}): Promise<void> {
  if (options.target !== "native-bun" && options.target !== "workers-js") {
    throw new Error(`unsupported Plugin target: ${String(options.target)}`);
  }
  const entrypoint = resolve(options.entrypoint);
  const native = options.target === "native-bun";
  const entry = "lenso-target-entry";
  const diagnostics: string[] = [];
  const result = await Bun.build({
    entrypoints: [entry],
    target: native ? "bun" : "browser",
    format: "esm",
    packages: "bundle",
    plugins: [{
      name: "lenso-explicit-plugin-target",
      setup(builder) {
        builder.onResolve({ filter: /^lenso-target-entry$/ }, () => ({
          path: entry, namespace: entry,
        }));
        builder.onLoad({ filter: /.*/, namespace: entry }, () => ({
          contents: native
            ? `import definition from ${JSON.stringify(entrypoint)}; import { servePluginV2 } from "@lenso/bun-plugin"; await servePluginV2(definition);`
            : `export { default } from ${JSON.stringify(entrypoint)};`,
          loader: "js",
          resolveDir: dirname(entrypoint),
        }));

      },
    }, createPluginTargetBuildPlugin(options.target, diagnostics)],
  }).catch((error: unknown) => {
    throw new Error(`Plugin target ${options.target} build failed:\n${diagnostics.join("\n") || String(error)}`);
  });
  if (!result.success) {
    throw new Error(`Plugin target ${options.target} build failed:\n${result.logs.map(String).join("\n")}`);
  }
  if (result.outputs.length !== 1) throw new Error("Plugin target requires one bundled ES module");
  await mkdir(dirname(resolve(options.outfile)), { recursive: true });
  await Bun.write(resolve(options.outfile), result.outputs[0]!);
}

/** Target packaging hook for the existing Core declaration compiler. */
export function createPluginTargetBuildPlugin(target: PluginTarget, diagnostics: string[] = []): BunPlugin {
  if (target !== "native-bun" && target !== "workers-js") throw new Error(`unsupported Plugin target: ${String(target)}`);
  const native = target === "native-bun";
  return {
    name: "lenso-plugin-target-packaging",
    setup(builder) {
        if (!native) builder.onResolve({ filter: /.*/ }, ({ path, importer }) => {
          if (path.startsWith("node:") || path.startsWith("bun:") ||
              builtinModules.includes(path) || ["@lenso/bun", "@lenso/bun-plugin"].includes(path)) {
            const message = `${importer}: workers-js cannot import ${path}; use @lenso/bun-plugin/authoring for declarations and explicit target facilities`;
            diagnostics.push(message);
            throw new Error(message);
          }
        });
        builder.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async ({ path }) => {
          let contents = await Bun.file(path).text();
          try {
            contents = lowerGeneratedStreamModule(path, contents);
            if (!native) assertWorkersSource(path, contents);
          } catch (error) {
            diagnostics.push(String(error));
            throw error;
          }
          const extension = path.split(".").at(-1)!;
          return { contents, loader: extension.endsWith("tsx") ? "tsx" : extension.includes("ts") ? "ts" : "js" };
        });
    },
  };
}

function assertWorkersSource(path: string, contents: string): void {
  const source = ts.createSourceFile(path, contents, ts.ScriptTarget.Latest, true);
  function visit(node: ts.Node): void {
    // Type-only SDK imports are erased and remain valid. Runtime references to
    // these names are deliberately rejected, including aliases/destructuring.
    if (ts.isTypeNode(node) || ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) return;
    if (ts.isIdentifier(node) && ["Bun", "process", "require", "__dirname", "__filename", "eval", "Function"].includes(node.text)) {
      if (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node &&
          !["globalThis", "self"].includes(node.parent.expression.getText(source))) return;
      if (ts.isPropertyAssignment(node.parent) && node.parent.name === node) return;
      const position = source.getLineAndCharacterOfPosition(node.getStart(source));
      throw new Error(`${path}:${position.line + 1}:${position.character + 1}: workers-js rejects runtime API ${node.text}; use an explicit Native target or a Host-owned Workers facility`);
    }
    if (ts.isElementAccessExpression(node) &&
        ["globalThis", "self"].includes(node.expression.getText(source))) {
      throw new Error(`${path}: workers-js rejects computed global access; use an explicit target facility`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
