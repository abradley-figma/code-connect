"use strict";
/**
 * esbuild adapter for `@figma/code-connect`. Emitted-file mode (writes the
 * runtime to `node_modules/.cache/figma-code-connect/runtime.js`) plus an
 * `initialOptions.alias` entry so the user's manual
 *
 *     import '@figma/code-connect/register'
 *
 * routes to the freshly emitted runtime instead of the package's empty
 * placeholder. The user is responsible for adding that import to their
 * entry — this adapter does NOT auto-inject it. Keeping the side-effect
 * explicit means production bundles stay clean of any runtime reference
 * when the adapter resolves to `enabled: false`.
 *
 * Why emitted-file mode (not virtual-module)?
 *  - esbuild's `alias` option requires a real path on disk. The emitted
 *    file is rewritten only when its bytes change (`emitRuntimeModule`
 *    is idempotent), so subsequent rebuilds in `esbuild --watch` are
 *    still cheap.
 *
 * esbuild has no native HMR — users restart the build to pick up changes.
 * Re-discovery on every `onStart` keeps `esbuild --watch` honest for
 * template additions/removals.
 *
 * The `enabled` option toggles ALL of the above. When (resolved)
 * disabled, `setup()` returns immediately: no parser run, no alias, no
 * emitted file. The user's `import '@figma/code-connect/register'`
 * then resolves through normal Node resolution to the empty placeholder
 * shipped by this package — a tiny, side-effect-free module that
 * compiles down to nothing in the production bundle.
 *
 * ZERO imports from `esbuild`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.figmaCodeConnect = figmaCodeConnect;
const compile_1 = require("../compile");
function figmaCodeConnect(opts = {}) {
    // esbuild has no compiler-mode signal we can read in `setup()` — the
    // closest the build object gets is `initialOptions.minify`, which is
    // user-facing and not always set. Falling back to `NODE_ENV` matches
    // the conventional esbuild dev/prod gate.
    const enabled = opts.enabled ?? process.env.NODE_ENV !== 'production';
    return {
        name: 'esbuild-plugin-figma-code-connect',
        setup(build) {
            // Disabled — return without touching `initialOptions` and without
            // creating a compiler. The user's manual `import` resolves through
            // node_modules to the empty placeholder.
            if (!enabled)
                return;
            const codeConnectCompiler = (0, compile_1.createCompiler)({
                ...opts,
                root: opts.root ?? build.initialOptions.absWorkingDir,
            });
            // Spread any pre-existing alias so co-existing plugins keep working.
            build.initialOptions.alias = {
                ...(build.initialOptions.alias ?? {}),
                ...codeConnectCompiler.getRuntimeAlias(),
            };
            // esbuild always runs `onStart` before any module resolution for the
            // same build, so the emitted file is on disk by the time esbuild
            // tries to follow the alias. Rediscovering on each start also picks
            // up newly-added template files when running with `--watch`.
            build.onStart(async () => {
                await codeConnectCompiler.build();
                await codeConnectCompiler.emitRuntimeModule();
            });
        },
    };
}
