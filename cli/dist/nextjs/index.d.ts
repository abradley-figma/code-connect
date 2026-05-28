/**
 * Next.js adapter for `@figma/code-connect`. Wraps `next.config.js` and
 * wires the runtime module into both Next.js bundling pipelines (webpack
 * + Turbopack). Turbopack has no public plugin API yet, so the wrapper
 * is the integration point for both pipelines:
 *
 *   const { withCodeConnect } = require('@figma/code-connect/nextjs')
 *   module.exports = withCodeConnect({ ...nextConfig })
 *
 * The user is responsible for adding
 *
 *     import '@figma/code-connect/register'
 *
 * to their root layout / app entry (e.g. `pages/_app.tsx` or
 * `app/layout.tsx`). This adapter does NOT auto-inject that import —
 * keeping the side-effect explicit means production bundles stay clean
 * of any reference to the runtime when the adapter resolves to
 * `enabled: false`.
 *
 * Behavior when (resolved) enabled:
 *  1. At the moment `next.config.js` is evaluated, kick off a
 *     fire-and-forget discover + parse + emit chain so the runtime
 *     module lands on disk as soon as possible. We deliberately do NOT
 *     await this — blocking `next.config.js` would block every Next
 *     invocation. The first build that imports the runtime sees
 *     whatever bytes are already on disk; if discovery races startup
 *     the alias resolves to a missing file and Next surfaces a loud
 *     not-found error (preferable to a silent `undefined`).
 *  2. Add a webpack alias to `nextConfig.webpack` for the webpack pipeline.
 *  3. Add a Turbopack `resolveAlias` entry (Next 13.4+).
 *
 * Behavior when (resolved) disabled:
 *  - The plugin is a complete no-op: no build, no aliases, no emit.
 *  - The user's `import '@figma/code-connect/register'` resolves through
 *    normal Node resolution to the empty placeholder shipped by this
 *    package — a tiny, side-effect-free module that compiles down to
 *    nothing in the production bundle.
 *  - The wrapped `nextConfig` is returned unchanged; only the
 *    integrations this adapter would have added are skipped.
 *
 * NO HMR for `.figma.{ts,js}` edits — restart `next dev` to pick up changes.
 */
import { type CreateCompilerOptions } from '../compile';
export interface CodeConnectNextjsOptions extends CreateCompilerOptions {
    /**
     * Toggle the entire plugin.
     *
     *  - `true`      — discover + parse templates, emit the runtime to
     *                  disk, install webpack and Turbopack aliases so
     *                  `@figma/code-connect/register` imports route to
     *                  the emitted runtime.
     *  - `false`     — the plugin is a complete no-op. `withCodeConnect`
     *                  returns the user's `nextConfig` unchanged. The
     *                  user's manual `import '@figma/code-connect/register'`
     *                  resolves to the empty placeholder (`export {}`)
     *                  via normal Node resolution, so production bundles
     *                  ship zero runtime code.
     *  - `undefined` — (default) auto-detect from
     *                  `process.env.NODE_ENV`. Enabled when
     *                  `NODE_ENV !== 'production'` (Next sets `NODE_ENV`
     *                  to `'development'` for `next dev` and
     *                  `'production'` for `next build` / `next start`).
     *
     * Pass an explicit boolean to override the auto-detection — e.g.
     * `enabled: true` to ship the runtime in production bundles, or
     * `enabled: false` to skip it entirely even in dev.
     */
    enabled?: boolean;
}
/**
 * Local Next.js webpack-callback context shape. Next's real type is
 * `WebpackConfigContext`; we only declare the fields the adapter reads.
 */
interface NextWebpackContext {
    /** True during `next dev`, false during `next build` / `next start`. */
    dev: boolean;
    /** True when bundling the server bundle. */
    isServer: boolean;
    /** Project root (Next exposes this as `dir`). */
    dir?: string;
}
/**
 * Local Next.js config shape — we only set or read the few properties
 * required to wire the alias. ANY other `nextConfig` fields pass through
 * untouched.
 */
interface NextWebpackConfig {
    resolve?: {
        alias?: Record<string, string>;
    };
}
interface NextExperimentalConfig {
    turbo?: {
        resolveAlias?: Record<string, string>;
    };
}
interface NextConfig {
    webpack?: (config: NextWebpackConfig, ctx: NextWebpackContext) => NextWebpackConfig;
    experimental?: NextExperimentalConfig;
}
export declare function withCodeConnect(nextConfig?: NextConfig, opts?: CodeConnectNextjsOptions): NextConfig;
export {};
