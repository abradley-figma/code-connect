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
import { type CreateCompilerOptions } from '../compile';
/** Vite-adapter options. `include`/`exclude` are passed to the underlying
 *  parser for both discover-on-startup and the HMR predicate. */
export interface CodeConnectViteOptions extends CreateCompilerOptions {
    /**
     * Toggle the entire plugin.
     *
     *  - `true`      — discover + parse templates, intercept the
     *                  `@figma/code-connect/register` import, serve the
     *                  populated runtime, run HMR.
     *  - `false`     — the plugin is a complete no-op. The user's manual
     *                  `import '@figma/code-connect/register'` resolves
     *                  to the empty placeholder (`export {}`) via normal
     *                  Node resolution, so production bundles ship zero
     *                  runtime code.
     *  - `undefined` — (default) auto-detect from Vite's `command`. The
     *                  plugin is enabled when `command !== 'build'`
     *                  (i.e. `vite` / `vite serve` / `vite preview`) and
     *                  disabled in `vite build`.
     *
     * Pass an explicit boolean to override the auto-detection — e.g.
     * `enabled: true` to ship the runtime in production bundles, or
     * `enabled: false` to skip it entirely even in dev.
     */
    enabled?: boolean;
}
export declare function figmaCodeConnect(opts?: CodeConnectViteOptions): {
    name: string;
};
export default figmaCodeConnect;
