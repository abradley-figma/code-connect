/**
 * Browser-side runtime shim. Serialized verbatim into the emitted runtime
 * module so both virtual-module mode (Vite) and emitted-file mode
 * (Webpack/Next.js/esbuild/headless prepare) ship the same code.
 *
 * The shim:
 *  - is SSR-safe (`typeof window === 'undefined'` short-circuit),
 *  - installs `window.figmaCodeConnect` as `{ getComponentDescriptor }` only —
 *    the descriptor map lives in a closure and is not reachable from outside.
 *  - exposes `getComponentDescriptor({ componentName, filePath })`, which
 *    walks the descriptor array three times — once per priority tier:
 *      1. exact match on `(componentName, filePath)`,
 *      2. **path-boundary suffix match** — tolerates the abs-vs-root-relative
 *         drift between bundlers (Vite gives `/src/X.tsx`, Webpack gives
 *         `/abs/proj/src/X.tsx`, the manifest emits `src/X.tsx`),
 *      3. name-only match.
 *    Returns the first hit or `undefined` if every tier misses. The array
 *    is small (one entry per component), so three linear walks is
 *    cheap and the simpler shape avoids a parallel keyed-Map structure.
 *  - dispatches a `figmaCodeConnectLoad` event on `window` so listeners can
 *    react to the descriptor map being installed.
 *
 * Multi-bundle caveat: every bundler we support dedupes the runtime
 * module, so this runs exactly once per app. If multiple independent bundles
 * (e.g. Module Federation, micro-frontends) each import the runtime
 * separately, the last bundle to load wins. Documented limitation.
 *
 * The placeholder `{/*__MANIFEST__*\/}` is replaced with the serialized
 * `CodeConnectManifest` JSON by `generateRuntimeShim`.
 */
import type { CodeConnectManifest, ComponentDescriptor } from './types';
/**
 * Wrap a `ComponentDescriptors` array into the on-the-wire
 * `CodeConnectManifest` shape. Async-returning so the caller's
 * await-chain composes naturally with the file-emit and HMR paths;
 * the underlying work is a single object literal.
 *
 * This is the single chokepoint where the compiler's in-memory shape
 * (`ComponentDescriptors`) becomes the JSON shape consumed by the
 * runtime shim. Keeping it as one function makes versioning the
 * manifest a single-edit operation.
 */
export declare function generateManifest(componentDescriptors: ComponentDescriptor[]): Promise<CodeConnectManifest>;
/**
 * Idempotent file-emit for the emit-mode adapters
 * (Webpack/Next.js/esbuild/headless prepare). Generates the runtime
 * shim source from `manifest`, compares it against the current
 * on-disk contents, and writes only when the bytes differ.
 *
 * Returns `true` if a write happened, `false` if the on-disk bytes
 * already matched. Adapters can use the return value to skip
 * downstream invalidation work — e.g. avoiding a webpack
 * `compilation.fileDependencies` rehash when the runtime didn't
 * actually change.
 *
 * Read failures (file doesn't exist, permission errors) are treated
 * as "no previous content", so the first call always writes. The
 * destination directory is created with `recursive: true` so emitting
 * to a fresh `node_modules/.cache/figma-code-connect/` directory
 * works without callers pre-creating it.
 */
export declare function emitRuntimeModule(runtimeFilePath: string, manifest: CodeConnectManifest): Promise<boolean>;
/**
 * Returns the absolute path the emit-file mode will write to, given a root.
 * The result is POSIX-normalized (forward slashes) so it composes with the
 * compiler's normalized `root` and is byte-equal to the alias map values
 * bundlers receive on Windows. `mkdir`/`writeFile` accept either form.
 *
 * Default location: `<root>/node_modules/.cache/figma-code-connect/runtime.js`
 *
 * Why specifically `node_modules/.cache/…` instead of any of the
 * obvious alternatives? It's the single location every major bundler
 * is engineered to treat as "tool cache, mutable, content-snapshot
 * me". The reasoning, in detail:
 *
 *  1. **The naive default — `node_modules/.figma-code-connect/` —
 *     breaks Webpack/Next.js HMR.** Webpack 5 has TWO independent
 *     `node_modules`-sensitive caches; both default to "this path is
 *     immutable":
 *
 *       a. `snapshot.managedPaths` — defaults to a regex that matches
 *          any path under `node_modules/`. Files matched here use a
 *          PACKAGE-VERSION snapshot strategy (re-read only when
 *          `package.json#version` changes), NOT a content/mtime
 *          strategy. So our `runtime.js` getting rewritten by
 *          `beforeCompile` would never invalidate the cached module.
 *
 *       b. `module.unsafeCache` — defaults to a function that returns
 *          true for any path containing `/node_modules/`. Resolved
 *          modules under that match are kept in an in-memory parsed
 *          cache. Even though `compilation.fileDependencies.add`
 *          on the source `.figma.ts` would normally invalidate, a
 *          managed-paths snapshot says "still valid", and the
 *          stale parsed module is reused.
 *
 *     The net effect: a user changes a `.figma.ts`, the parser
 *     rewrites `runtime.js`, Webpack's rebuild keeps the OLD parsed
 *     module, the browser sees stale descriptors. Hard to debug —
 *     looks like our HMR is broken when actually it's the cache.
 *
 *  2. **`node_modules/.cache/` is the standard escape hatch.**
 *     Webpack 5's default `managedPaths` regex is:
 *
 *         /^(.+?[\/]node_modules[\/](?!\.cache|\.pnpm)…)/
 *
 *     The `(?!\.cache|\.pnpm)` negative lookahead is intentional —
 *     `.cache/` is explicitly excluded from the managed-paths
 *     treatment so files under it get content+mtime snapshots like
 *     normal user code. `.pnpm` is excluded because pnpm's
 *     virtual store needs the same exclusion.
 *
 *     Once content snapshots are in play, the second cache
 *     (`unsafeCache`) becomes harmless: it caches resolution, not
 *     content, and the snapshot strategy correctly invalidates the
 *     cached parsed module when the file changes.
 *
 *  3. **It's the de-facto convention.** `node_modules/.cache/` is
 *     used by webpack persistent cache, babel-loader, eslint,
 *     terser-webpack-plugin, parcel, and the npm package
 *     `find-cache-dir`. Users won't be surprised by it, and it
 *     composes with all the standard "clear my caches" workflows
 *     (`rm -rf node_modules/.cache`).
 *
 *  4. **It stays gitignored by default.** Inside `node_modules/`,
 *     so the ambient `.gitignore` covers it. Users don't need to
 *     remember to add a new entry.
 *
 *  5. **It doesn't matter for Vite or esbuild.** Vite serves a
 *     virtual module (no on-disk file at all), so the path is
 *     unused. esbuild re-reads aliased files on each `onStart`
 *     regardless of where they live, so it's neutral on path choice.
 *     The default is chosen for the bundler that's most aggressive
 *     about caching (Webpack/Next.js), and the others are
 *     unaffected.
 *
 * Users can still override via `CreateCompilerOptions.outFile` if they
 * want a different location (e.g. somewhere outside `node_modules/`
 * for inspection during debugging).
 */
export declare function resolveRuntimeFilePath(root: string, outFile?: string): string;
/**
 * Materialize the runtime shim's JS source for a given manifest. Pure —
 * no I/O. Takes the `RUNTIME_SHIM_TEMPLATE` IIFE source (defined above)
 * and substitutes the `{/*__MANIFEST__*\/}` placeholder with
 * `JSON.stringify(manifest)`.
 *
 * The output is byte-identical between the virtual-module mode (Vite's
 * `load` hook returns the string directly) and emit-mode (the string
 * is written to disk and aliased in). That equivalence is what
 * `output_modes.test.ts` enforces.
 */
export declare function generateRuntimeShim(manifest: CodeConnectManifest): string;
