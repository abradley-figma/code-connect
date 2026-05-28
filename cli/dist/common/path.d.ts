/**
 * Cross-platform path normalization helpers.
 *
 * `normalizePath`, `normalizeRelativePath`, and `normalizeResolvePath` are
 * the codebase's single chokepoint for turning platform-shaped filesystem
 * paths into a POSIX-shaped, canonical form. Anywhere a path crosses a
 * module boundary (descriptor store keys, runtime alias values, manifest
 * entries, the compiler's discovered-file Set, bundler aliases, etc.) it
 * goes through one of these helpers so equality checks survive multi-
 * platform builds — `path.resolve` / `path.dirname` emit backslashes on
 * Windows while `glob` and user-supplied configs usually emit forward
 * slashes, and we need a single canonical form on both sides.
 *
 * Lives under `cli/src/common/` rather than `cli/src/compile/` so it can
 * be shared by `connect/` and any other CLI surface without dragging in
 * the compile module.
 */
/**
 * Normalize a filesystem path to a POSIX-shaped, canonical form. Used as the
 * single chokepoint anywhere a path crosses a module boundary (descriptor
 * store keys, runtime alias values, manifest output, the discovered-file
 * Set), so equality checks survive Windows builds where `path.resolve` and
 * `path.dirname` emit backslashes but `glob` and user-supplied configs
 * usually emit forward slashes.
 *
 * Cross-platform: backslashes in the input are first rewritten to forward
 * slashes, then `posix.normalize` collapses redundant `.` / `..` /
 * trailing-separator segments. The result is always POSIX-shaped on
 * BOTH macOS/Linux and Windows builds — a path produced on one platform
 * is byte-equal to the same path produced on another.
 *
 * @example
 *   normalizePath('C:\\proj\\src\\Button.tsx') // → 'C:/proj/src/Button.tsx'
 *   normalizePath('src\\Button.tsx')           // → 'src/Button.tsx'
 *   normalizePath('src/./a/../Button.tsx')     // → 'src/Button.tsx'
 *   normalizePath('/abs/x.js')                 // → '/abs/x.js'
 */
export declare function normalizePath(path: string): string;
/**
 * Compute a project-relative POSIX path from an absolute `path` and an
 * absolute `root`. Wrapper around `node:path.relative` + `normalizePath` —
 * use this any time a path is going into the serialized manifest, the
 * runtime shim's lookup keys, or anywhere else a deterministic
 * project-relative string is required.
 *
 * Output is always POSIX-shaped on both POSIX and Windows builds: the
 * platform-specific `relative()` produces `\\`-separated output on
 * Windows, and `normalizePath` rewrites those to `/` so the manifest is
 * byte-equal across platforms.
 *
 * @example
 *   normalizeRelativePath('/proj', '/proj/src/Button.tsx')   // → 'src/Button.tsx'
 *   normalizeRelativePath('/proj', '/proj/src\\Button.tsx')  // → 'src/Button.tsx'
 *   normalizeRelativePath('/proj', '/other/x.tsx')           // → '../other/x.tsx'
 *   normalizeRelativePath('/proj', '/proj')                  // → '.' (path.relative semantics)
 */
export declare function normalizeRelativePath(root: string, path: string): string;
/**
 * Resolve one or more path segments against a `root` and return the result
 * as an absolute, POSIX-shaped path. Wrapper around `node:path.resolve` +
 * `normalizePath` — preferred over hand-rolling `normalizePath(resolve(...))`
 * at every call site so that "absolute, POSIX-normalized" stays a single
 * named operation across the codebase.
 *
 * Output is always POSIX-shaped on both POSIX and Windows builds: the
 * platform-specific `resolve()` produces `\\`-separated output on
 * Windows, and `normalizePath` rewrites those to `/`.
 *
 * @example
 *   normalizeResolvePath('/proj', 'src/Button.tsx')              // → '/proj/src/Button.tsx'
 *   normalizeResolvePath('/proj', 'src\\Button.tsx')             // → '/proj/src/Button.tsx'
 *   normalizeResolvePath('/proj', '../other/x.tsx')              // → '/other/x.tsx'
 *   normalizeResolvePath('/proj', 'node_modules', '.cache/x.js') // → '/proj/node_modules/.cache/x.js'
 *   normalizeResolvePath('/proj', '/abs/x.js')                   // → '/abs/x.js'
 */
export declare function normalizeResolvePath(root: string, ...segments: string[]): string;
/**
 * Resolve an array of paths against a `root` and return them all as
 * absolute, POSIX-shaped paths. Array-shaped sibling to
 * `normalizeResolvePath` — use this when the caller has a list of
 * separate paths to resolve (e.g. glob include / exclude patterns)
 * rather than a single multi-segment path.
 *
 * Used by `connect/project.ts#discoverFilesByGlob` to turn the
 * project-relative include / exclude globs from `figma.config.json`
 * into absolute, POSIX-shaped patterns `glob` can match against:
 * `path.resolve` cleanly handles relative globs (`**\/*.figma.ts` →
 * `/proj/**\/*.figma.ts`), collapses `./` and `..` segments
 * (`./src/**` → `/proj/src/**`), and respects already-absolute globs
 * (`/abs/x/**` stays `/abs/x/**` regardless of `root`). `normalizePath`
 * then rewrites the Windows-shaped output of `resolve` to forward
 * slashes so `glob` / `minimatch` see the same canonical form on
 * every platform.
 *
 * @example
 *   normalizePathsToAbsolute('/proj', ['**\/*.figma.ts'])     // → ['/proj/**\/*.figma.ts']
 *   normalizePathsToAbsolute('/proj', ['./src/**', '../x/**']) // → ['/proj/src/**', '/x/**']
 *   normalizePathsToAbsolute('/proj', ['/abs/x/**'])          // → ['/abs/x/**']
 */
export declare function normalizePathsToAbsolute(absPath: string, paths: string[]): string[];
