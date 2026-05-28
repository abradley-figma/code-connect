"use strict";
/**
 * Headless prepare helper for `@figma/code-connect`.
 *
 * Use this when no first-class plugin is available for your bundler — call
 * `prepareCodeConnect({ root })` from a build script (e.g. npm run dev),
 * then wire the emitted file through your bundler's module-alias
 * mechanism. The returned `alias` field is a copy-pasteable `{ specifier:
 * absolutePath }` mapping that fits every alias config we know of:
 *
 *   - Parcel        — `package.json#alias`
 *   - Rollup        — `@rollup/plugin-alias` `entries`
 *   - Snowpack      — `snowpack.config#alias`
 *   - Bun           — `package.json#imports`
 *   - Vite / Webpack used without our plugin — `resolve.alias`
 *   - Custom Node prebuild scripts
 *
 * The user is responsible for adding
 *
 *     import '@figma/code-connect/register'
 *
 * to their app's entry — this helper does NOT auto-inject that import.
 *
 * No HMR — restart the bundler to pick up `.figma.{ts,js}` edits. Bundlers
 * with our dedicated plugin (Vite/Webpack/esbuild/Next.js) should use that
 * plugin instead, since they get native watch / HMR integration.
 *
 * The `enabled` option toggles ALL of the above. When (resolved)
 * disabled, the helper short-circuits before touching disk: no parser
 * run, no emit, returns an empty alias map. The user's
 * `import '@figma/code-connect/register'` then resolves through normal
 * Node resolution to the empty placeholder shipped by this package.
 *
 * ZERO bundler imports.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.prepareCodeConnect = prepareCodeConnect;
const compile_1 = require("../compile");
/**
 * One-shot helper: discover all template files under `root`, parse them,
 * and emit the runtime module to `node_modules/.cache/figma-code-connect/runtime.js`.
 *
 * The `node_modules/.cache/` location is load-bearing for any consumer
 * that wires the result into Webpack: Webpack 5's default
 * `snapshot.managedPaths` regex excludes `.cache/`, so the emitted
 * file gets content/mtime snapshots and rebuilds invalidate correctly.
 * See `resolveRuntimeFilePath` in `compile/runtime.ts` for the full
 * writeup.
 *
 * Idempotent — re-running with the same source files writes the same bytes.
 */
async function prepareCodeConnect(opts) {
    const enabled = opts.enabled ?? process.env.NODE_ENV !== 'production';
    const codeConnectCompiler = (0, compile_1.createCompiler)(opts);
    if (!enabled) {
        // Skip parser + emit. Return an empty alias map so a caller doing
        // `Object.assign(bundlerAliases, alias)` adds nothing — equivalent
        // to the plugin not being installed at all. We still surface
        // `filePath` so callers that conditionally read it don't need to
        // branch on `enabled`.
        return {
            templateFileCount: 0,
            warnings: [],
            alias: {},
            filePath: codeConnectCompiler.getRuntimeFilePath(),
        };
    }
    const result = await codeConnectCompiler.build();
    await codeConnectCompiler.emitRuntimeModule();
    return {
        alias: codeConnectCompiler.getRuntimeAlias(),
        filePath: codeConnectCompiler.getRuntimeFilePath(),
        ...result,
    };
}
