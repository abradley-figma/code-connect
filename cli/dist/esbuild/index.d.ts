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
import { type CreateCompilerOptions } from '../compile';
export interface CodeConnectEsbuildOptions extends CreateCompilerOptions {
    /**
     * Toggle the entire plugin.
     *
     *  - `true`      — discover + parse templates, emit the runtime to
     *                  disk, install an alias so
     *                  `@figma/code-connect/register` imports route to
     *                  the emitted runtime.
     *  - `false`     — the plugin is a complete no-op. The user's manual
     *                  `import '@figma/code-connect/register'` resolves
     *                  to the empty placeholder (`export {}`) via normal
     *                  Node resolution, so production bundles ship zero
     *                  runtime code.
     *  - `undefined` — (default) auto-detect from `process.env.NODE_ENV`.
     *                  Enabled when `NODE_ENV !== 'production'`. esbuild
     *                  has no built-in mode signal, so `NODE_ENV` is the
     *                  conventional dev-vs-prod hint that virtually
     *                  every esbuild config gates on already.
     *
     * Pass an explicit boolean to override the auto-detection — e.g.
     * `enabled: true` to ship the runtime in production bundles, or
     * `enabled: false` to skip it entirely even in dev.
     */
    enabled?: boolean;
}
/** Bare minimum esbuild plugin shape we touch. */
interface EsbuildPluginBuild {
    initialOptions: {
        absWorkingDir?: string;
        alias?: Record<string, string>;
    };
    onStart(cb: () => Promise<void> | void): void;
}
interface EsbuildPlugin {
    name: string;
    setup(build: EsbuildPluginBuild): void;
}
export declare function figmaCodeConnect(opts?: CodeConnectEsbuildOptions): EsbuildPlugin;
export {};
