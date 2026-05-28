"use strict";
/**
 * Vite adapter for `@figma/code-connect`. Virtual-module mode + native HMR
 * via `handleHotUpdate`.
 *
 * The user is responsible for writing
 *
 *     import '@figma/code-connect/register'
 *
 * in their app's entry (e.g. `src/main.tsx`). This adapter does NOT
 * auto-inject that import — keeping the side-effect explicit means
 * production bundles stay clean of any reference to the runtime when
 * the adapter resolves to `enabled: false`.
 *
 * Lifecycle / responsibility breakdown:
 *
 *  - `configResolved`     — capture `command` (serve vs build) and the
 *                           project root (if the user didn't supply one).
 *                           When `enabled` was left unset, this is also
 *                           where the dev-mode default is resolved
 *                           (`command !== 'build'`).
 *  - `buildStart`         — full discover + parse pass.
 *  - `resolveId` / `load` — serve the virtual module on demand. Both the
 *                           internal `virtual:` ID and the public subpath
 *                           `@figma/code-connect/register` resolve here,
 *                           so the user's manual `import` statement
 *                           routes through this plugin.
 *  - `handleHotUpdate`    — on every template change, re-parse, mutate
 *                           the descriptor map, and return the virtual
 *                           module node so Vite invalidates it. The
 *                           served payload includes an
 *                           `import.meta.hot.accept()` boundary so the
 *                           browser hot-replaces the IIFE in place.
 *
 * The `enabled` option toggles ALL of the above. When (resolved)
 * disabled, every hook short-circuits, no parser run happens, and the
 * user's `import '@figma/code-connect/register'` resolves through
 * normal Node resolution to the empty placeholder shipped by this
 * package — a tiny, side-effect-free module that compiles down to
 * nothing in the production bundle.
 *
 * Implementation rules:
 *  - ZERO imports from `vite` — the local `VitePlugin` shape is
 *    structurally compatible with `import('vite').Plugin`.
 *  - All compiler interaction goes through one `createCompiler` instance.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.figmaCodeConnect = figmaCodeConnect;
const compile_1 = require("../compile");
function figmaCodeConnect(opts = {}) {
    // Hard short-circuit when explicitly disabled. We don't even instantiate
    // the compiler — disabled plugins shouldn't pay the parser cost.
    if (opts.enabled === false) {
        return { name: 'vite-plugin-figma-code-connect' };
    }
    const codeConnectCompiler = (0, compile_1.createCompiler)(opts);
    /** The leading `\0` is Vite's convention for "this id is virtual and should
     *  not be resolved off disk". */
    const runtimeModuleId = codeConnectCompiler.getRuntimeModuleId();
    const virtualModuleId = `virtual:${runtimeModuleId}`;
    const resolvedId = '\u0000' + virtualModuleId;
    /** Prefix added to the served payload so a template-file change hot-replaces
     *  the runtime IIFE in-place instead of triggering a full page reload. */
    const VITE_HMR_ACCEPT_PREFIX = 'if (import.meta.hot) { import.meta.hot.accept() }\n';
    // Tentative until configResolved fires. Vite's contract guarantees
    // `configResolved` runs before any other lifecycle hook on this plugin,
    // so the only callers that observe `true` here are tests that drive
    // `load`/`handleHotUpdate` without a configResolved (defensive: prefer
    // doing the work to silently dropping it).
    let enabled = opts.enabled ?? true;
    const plugin = {
        name: 'vite-plugin-figma-code-connect',
        enforce: 'pre',
        configResolved(config) {
            if (opts.enabled === undefined) {
                // `command !== 'build'` (instead of `command === 'serve'`) so any
                // future Vite command beyond serve/build still gets the runtime by
                // default. `vite build` is the single signal that we're producing
                // a deployable artifact.
                enabled = config.command !== 'build';
            }
            if (!enabled)
                return;
            if (!opts.root)
                codeConnectCompiler.setRoot(config.root);
        },
        async buildStart() {
            if (!enabled)
                return;
            const { warnings } = await codeConnectCompiler.build();
            for (const w of warnings)
                this.warn(w);
        },
        resolveId(id) {
            if (!enabled)
                return undefined;
            if (id === virtualModuleId || id === runtimeModuleId)
                return resolvedId;
            return undefined;
        },
        /**
         * Vite always finishes `buildStart` before invoking `load`, so by the
         * time this hook fires the compiler has populated the descriptor
         * store and `generateRuntimeShim()` returns the populated shim.
         */
        async load(id) {
            if (!enabled)
                return undefined;
            if (id !== resolvedId)
                return undefined;
            const runtimeShim = await codeConnectCompiler.generateRuntimeShim();
            return VITE_HMR_ACCEPT_PREFIX + runtimeShim;
        },
        async handleHotUpdate(ctx) {
            if (!enabled)
                return undefined;
            const updateResult = await codeConnectCompiler.updateFile(ctx.file);
            if (!updateResult.changed)
                return undefined;
            const mod = ctx.server.moduleGraph.getModuleById(resolvedId);
            return mod ? [mod] : undefined;
        },
    };
    return plugin;
}
exports.default = figmaCodeConnect;
