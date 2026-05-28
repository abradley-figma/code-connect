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
import { type CodeConnectBuildResult, type CreateCompilerOptions } from '../compile';
export interface PrepareCodeConnectOptions extends CreateCompilerOptions {
    /**
     * Toggle the entire helper.
     *
     *  - `true`      — discover + parse templates, emit the runtime to
     *                  disk, return the alias map for the caller to wire
     *                  into their bundler.
     *  - `false`     — short-circuit. No parser run, no emit. Returns
     *                  `templateFileCount: 0`, `warnings: []`, an empty
     *                  `alias` map, and the path the runtime WOULD have
     *                  been written to (so callers can still build their
     *                  alias configs unconditionally).
     *  - `undefined` — (default) auto-detect from `process.env.NODE_ENV`.
     *                  Enabled when `NODE_ENV !== 'production'`. The
     *                  helper has no bundler context to read a more
     *                  specific signal from, so `NODE_ENV` is the
     *                  conventional dev-vs-prod hint.
     *
     * Pass an explicit boolean to override the auto-detection.
     */
    enabled?: boolean;
}
interface CodeConnectPrepareResult extends CodeConnectBuildResult {
    /** Copy-pasteable `{ specifier: absolutePath }` snippet for any module-alias config. */
    alias: Record<string, string>;
    /** Absolute path of the file users should alias `@figma/code-connect/register` to. */
    filePath: string;
}
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
export declare function prepareCodeConnect(opts: PrepareCodeConnectOptions): Promise<CodeConnectPrepareResult>;
export {};
