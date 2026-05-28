"use strict";
/**
 * Webpack adapter for `@figma/code-connect`. Emitted-file mode (runtime.js
 * on disk under `node_modules/.cache/figma-code-connect/`), path alias on
 * the user's compiler resolve config, and native watch via `afterCompile` +
 * `fileDependencies.add`.
 *
 * The `node_modules/.cache/` prefix on the runtime path is load-bearing
 * for HMR: Webpack 5's default `snapshot.managedPaths` regex
 * (`(?!\.cache|\.pnpm)`) explicitly excludes `.cache/`, so the emitted
 * runtime gets content+mtime snapshots instead of immutable
 * package-version snapshots. Without this carve-out, a `.figma.ts`
 * change → `beforeCompile` rewrites `runtime.js` → Webpack's rebuild
 * keeps the OLD parsed module → browser sees stale descriptors. See
 * `resolveRuntimeFilePath` in `compile/runtime.ts` for the full writeup.
 *
 * The user is responsible for writing
 *
 *     import '@figma/code-connect/register'
 *
 * in their app's entry. This adapter does NOT auto-inject that import —
 * keeping the side-effect explicit means production bundles stay clean
 * of any reference to the runtime when the adapter resolves to
 * `enabled: false`.
 *
 * Works with both webpack 4 and webpack 5 — the only surfaces touched
 * are `compiler.hooks.beforeCompile`, `compiler.hooks.afterCompile`,
 * `compiler.options.resolve.alias`, and `compilation.fileDependencies`,
 * which are identical across the two majors.
 *
 * The `enabled` option toggles ALL of the above. When (resolved)
 * disabled, `apply()` short-circuits before touching the compiler:
 * no parser run, no alias, no emitted file, no hook taps. The user's
 * `import '@figma/code-connect/register'` then resolves through normal
 * Node resolution to the empty placeholder shipped by this package — a
 * tiny, side-effect-free module that compiles down to nothing in the
 * production bundle.
 *
 * ZERO imports from `webpack`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FigmaCodeConnectPlugin = void 0;
exports.figmaCodeConnect = figmaCodeConnect;
const compile_1 = require("../compile");
class FigmaCodeConnectPlugin {
    constructor(opts = {}) {
        this.opts = opts;
        // Eagerly create the compiler unless we already know we're disabled.
        // For `enabled: undefined` we have to defer the dev-mode check to
        // `apply()` (where `compiler.options.mode` is available), so
        // `createCompiler` runs upfront — it's cheap (no I/O, no parsing).
        if (opts.enabled !== false) {
            this.codeConnectCompiler = (0, compile_1.createCompiler)(opts);
        }
    }
    apply(compiler) {
        if (!this.codeConnectCompiler)
            return; // hard short-circuit (`enabled: false`)
        const enabled = this.opts.enabled ?? compiler.options.mode !== 'production';
        if (!enabled)
            return;
        if (!this.opts.root)
            this.codeConnectCompiler.setRoot(compiler.context);
        compiler.options.resolve = compiler.options.resolve ?? {};
        compiler.options.resolve.alias = {
            ...compiler.options.resolve.alias,
            ...this.codeConnectCompiler.getRuntimeAlias(),
        };
        const tapName = 'figma-code-connect';
        compiler.hooks.beforeCompile.tapPromise(tapName, async () => {
            await this.rebuildAndEmit();
        });
        compiler.hooks.afterCompile.tap(tapName, (compilation) => {
            // Tell webpack about every template file so its watcher invalidates
            // the build when one changes. webpack 5 uses Set<string>, webpack 4
            // uses a similar add-only interface. We pull the latest list off the
            // compiler instead of stashing it locally — the compiler is the
            // source of truth for "what discover saw last time `build()` ran".
            const deps = compilation.fileDependencies;
            for (const discoveredFile of this.codeConnectCompiler.getDiscoveredFiles()) {
                deps.add(discoveredFile);
            }
        });
        if (compiler.hooks.watchRun) {
            compiler.hooks.watchRun.tapPromise(tapName, async () => {
                await this.rebuildAndEmit();
            });
        }
    }
    async rebuildAndEmit() {
        if (!this.codeConnectCompiler)
            return;
        await this.codeConnectCompiler.build();
        await this.codeConnectCompiler.emitRuntimeModule();
    }
}
exports.FigmaCodeConnectPlugin = FigmaCodeConnectPlugin;
function figmaCodeConnect(opts = {}) {
    return new FigmaCodeConnectPlugin(opts);
}
