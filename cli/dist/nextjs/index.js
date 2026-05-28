"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.withCodeConnect = withCodeConnect;
const compile_1 = require("../compile");
function withCodeConnect(nextConfig = {}, opts = {}) {
    // Default: enabled outside of production. Next sets `NODE_ENV` based on
    // the command (`next dev` → development, `next build` / `next start` →
    // production), so this matches the user's likely intent.
    const enabled = opts.enabled ?? process.env.NODE_ENV !== 'production';
    // Disabled — return the user's config unchanged. Don't build, don't
    // wrap webpack, don't write to experimental.turbo. The user's manual
    // `import '@figma/code-connect/register'` resolves through node_modules
    // to the empty placeholder.
    if (!enabled)
        return nextConfig;
    const codeConnectCompiler = (0, compile_1.createCompiler)(opts);
    const runtimeAlias = codeConnectCompiler.getRuntimeAlias();
    // Purposely not awaited — we don't want to block next.config.js
    // evaluation. The alias resolution will surface a not-found error
    // (louder than a config-time throw) if discovery races startup.
    // `.catch` swallows any failure for the same reason.
    codeConnectCompiler
        .build()
        .then(() => codeConnectCompiler.emitRuntimeModule())
        .catch(() => {
        /* see comment above */
    });
    const previousWebpack = nextConfig.webpack;
    const merged = {
        ...nextConfig,
        webpack(webpackConfig, context) {
            const config = previousWebpack ? previousWebpack(webpackConfig, context) : webpackConfig;
            config.resolve = config.resolve ?? {};
            config.resolve.alias = { ...config.resolve.alias, ...runtimeAlias };
            return config;
        },
        experimental: {
            ...nextConfig.experimental,
            turbo: {
                ...nextConfig.experimental?.turbo,
                resolveAlias: {
                    ...nextConfig.experimental?.turbo?.resolveAlias,
                    ...runtimeAlias,
                },
            },
        },
    };
    return merged;
}
