"use strict";
/**
 * Public surface of the compiler core.
 *
 * Adapter packages import from here. This module is intentionally NOT
 * exposed in `package.json#exports` — it ships only via the per-bundler
 * subpaths (`@figma/code-connect/vite`, `/webpack`, `/esbuild`, `/prepare`,
 * `/nextjs`) and the runtime fallback (`/register`). Treat any external
 * import of the compiler as an unstable internal surface.
 *
 * Every adapter funnels its compiler interaction through a single
 * `createCompiler({...})` instance, then asks that instance for a
 * serialized module / emitted file / HMR predicate / single-file update.
 * Anything else (descriptor types, the parse pipeline, the runtime shim,
 * etc.) is internal — import directly from the leaf modules if you need
 * it from a test.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCompiler = void 0;
var compiler_1 = require("./compiler");
Object.defineProperty(exports, "createCompiler", { enumerable: true, get: function () { return compiler_1.createCompiler; } });
