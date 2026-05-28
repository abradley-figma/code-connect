/**
 * Single entry-point used by every bundler adapter. `createCompiler()`
 * returns an instance that owns:
 *
 *   - The root directory (settable before or after `build()` —
 *     Vite needs to set it later, in `configResolved`).
 *   - The in-memory `ComponentDescriptorStore`.
 *   - The discover + read + parse pipeline, exposed as `build()`.
 *     Discovery is composed directly here from three connect-side
 *     exports: `parseOrDetermineConfig` loads `figma.config.json` the
 *     same way `figma connect publish` does, `resolveTemplateGlobs`
 *     layers the templates-only default include/exclude on top of any
 *     user-supplied globs, and `discoverFilesByGlob` runs the actual
 *     glob. There are no `include` / `exclude` knobs on
 *     `CreateCompilerOptions` — adapter users widen / narrow the set
 *     via the project's `figma.config.json#codeConnect.include` /
 *     `.exclude` (one source of truth shared with the CLI). The
 *     downstream read + parse pass lives in `./build`.
 *   - Per-file HMR helper (`updateFile` — parses the file if it matches
 *     the template globs, otherwise reports `unknown-file`). The
 *     predicate (`isTemplateFilePath`) is also imported from
 *     `cli/src/connect/project.ts` so HMR sees the exact same matching
 *     logic the full discovery did. The compiler caches the resolved
 *     globs returned from the most recent `build()` so this stays a
 *     no-I/O hot path.
 *   - Output helpers (`generateManifest`, `generateRuntimeShim`,
 *     `getRuntimeAlias`, `getRuntimeFilePath`, `emitRuntimeModule`).
 *
 * Adapters call only the methods on this surface — no direct access to
 * `ComponentDescriptorStore`, `parseComponentDescriptorsFromSource`,
 * `resolveRuntimeFilePath`, or the module-level `emitRuntimeModule`. This
 * keeps the public compiler surface to a single factory and lets us refactor
 * internals without breaking adapters.
 */
import type { CodeConnectCompiler, CreateCompilerOptions } from './types';
export declare function createCompiler(opts?: CreateCompilerOptions): CodeConnectCompiler;
