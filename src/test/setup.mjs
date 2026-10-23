// Registers a resolver so test files (and the modules they import) can use the
// "@/..." path alias from tsconfig under Node's built-in test runner.
import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./alias-loader.mjs", pathToFileURL(import.meta.filename ?? new URL(import.meta.url).pathname));
