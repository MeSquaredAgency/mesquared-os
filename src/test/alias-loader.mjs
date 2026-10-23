// Resolver hook for Node's test runner: maps the tsconfig "@/..." alias to
// src/ and adds TypeScript extensions to extensionless relative imports, so
// the same modules Next.js bundles can run unbundled under `node --test`.
import { existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const srcDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.js"];

function isFile(p) {
  return existsSync(p) && statSync(p).isFile();
}

function withExtension(basePath) {
  if (isFile(basePath)) return basePath;
  for (const ext of EXTENSIONS) if (isFile(basePath + ext)) return basePath + ext;
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const hit = withExtension(join(srcDir, specifier.slice(2)));
    if (hit) return nextResolve(pathToFileURL(hit).href, context);
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    const parentDir = dirname(fileURLToPath(context.parentURL));
    if (parentDir.startsWith(srcDir)) {
      const hit = withExtension(join(parentDir, specifier));
      if (hit) return nextResolve(pathToFileURL(hit).href, context);
    }
  }
  return nextResolve(specifier, context);
}
