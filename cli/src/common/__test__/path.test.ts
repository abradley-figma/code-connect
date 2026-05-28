/**
 * Focused unit tests for the path-normalization helpers exported from
 * `cli/src/common/path.ts`. These three helpers are the codebase's
 * chokepoint for converting platform-shaped filesystem paths into the
 * POSIX-shaped, canonical form that flows into:
 *
 *  - `ComponentDescriptorStore.snapshot()` → manifest output,
 *  - the runtime shim's `(componentName, filePath)` lookup keys,
 *  - the compiler's internal `discoveredTemplateFiles` Set + descriptor
 *    store keys (must match `discoverFilesByGlob`'s POSIX output to
 *    avoid double-keying the same logical file on Windows),
 *  - bundler alias values returned from `getRuntimeAlias` /
 *    `getRuntimeFilePath`.
 */

import { normalizePath, normalizeRelativePath, normalizeResolvePath } from '../path'

describe('normalizePath', () => {
  it('passes a POSIX-shaped absolute path through unchanged', () => {
    expect(normalizePath('/abs/src/Button.tsx')).toBe('/abs/src/Button.tsx')
  })

  it('passes a POSIX-shaped relative path through unchanged', () => {
    expect(normalizePath('src/Button.tsx')).toBe('src/Button.tsx')
  })

  it('rewrites Windows backslash separators to forward slashes', () => {
    // Even on POSIX the helper must rewrite `\\` segments — a Windows-built
    // manifest can be consumed in a POSIX dev shell and vice versa.
    expect(normalizePath('src\\Button.tsx')).toBe('src/Button.tsx')
  })

  it('collapses redundant `.` segments', () => {
    expect(normalizePath('src/./a/Button.tsx')).toBe('src/a/Button.tsx')
  })

  it('collapses `..` segments', () => {
    expect(normalizePath('src/a/../Button.tsx')).toBe('src/Button.tsx')
  })

  it('preserves a trailing separator (posix.normalize semantics)', () => {
    // posix.normalize keeps trailing `/` because it can be semantically
    // significant (asserts the path is a directory). Documented so the
    // descriptor store / runtime shim don't accidentally rely on
    // "trailing slash gets stripped" — they don't.
    expect(normalizePath('src/a/')).toBe('src/a/')
  })

  it('returns "." for an empty input (path.normalize semantics)', () => {
    // Documents the edge case so callers know to guard before calling
    // when they want to preserve `undefined`/`''` distinctly.
    expect(normalizePath('')).toBe('.')
  })

  it('preserves a leading "./" by collapsing it (relative shape stays relative)', () => {
    expect(normalizePath('./src/Button.tsx')).toBe('src/Button.tsx')
  })

  it('preserves a leading ".." (escapes from the implicit cwd)', () => {
    expect(normalizePath('../sibling/x.tsx')).toBe('../sibling/x.tsx')
  })
})

describe('normalizeRelativePath', () => {
  it('computes a project-relative POSIX path for a child of `root`', () => {
    expect(normalizeRelativePath('/proj', '/proj/src/Button.tsx')).toBe('src/Button.tsx')
  })

  it('returns "." when `root` and `path` are identical', () => {
    // Documents the edge case — `path.relative('/proj', '/proj')` returns
    // `''`, and `normalize('')` then yields `'.'`. Callers that want an
    // empty string should treat `'.'` as that.
    expect(normalizeRelativePath('/proj', '/proj')).toBe('.')
  })

  it('emits a `..` form when `path` lives outside `root`', () => {
    // A misconfigured root must surface visibly, not get silently rooted
    // back at `/`. Connect's `isTemplateFilePath` predicate (consumed by
    // compile's HMR path) rejects anything starting with `..` on this
    // exact contract.
    expect(normalizeRelativePath('/proj', '/other/x.tsx')).toBe('../other/x.tsx')
  })

  it('rewrites Windows separators in the input absolute path', () => {
    expect(normalizeRelativePath('/proj', '/proj/src\\Button.tsx')).toBe('src/Button.tsx')
  })

  it('collapses interior `..` and `.` segments via the inner normalize', () => {
    expect(normalizeRelativePath('/proj', '/proj/src/./a/../Button.tsx')).toBe('src/Button.tsx')
  })
})

describe('normalizeResolvePath', () => {
  it('joins a single relative segment against an absolute root', () => {
    expect(normalizeResolvePath('/proj', 'src/Button.tsx')).toBe('/proj/src/Button.tsx')
  })

  it('joins multiple segments left-to-right (variadic shape)', () => {
    // The 4-segment runtime path
    // (`node_modules/.cache/figma-code-connect/runtime.js`) flows through
    // this form in `resolveRuntimeFilePath` — the test pins that shape.
    expect(
      normalizeResolvePath('/proj', 'node_modules', '.cache', 'figma-code-connect', 'runtime.js'),
    ).toBe('/proj/node_modules/.cache/figma-code-connect/runtime.js')
  })

  it('short-circuits to the rightmost absolute segment (path.resolve semantics)', () => {
    // This is what makes the resolver's `resolveCandidate` work without an
    // explicit `path.isAbsolute(candidate)` branch — an absolute candidate
    // resets the accumulated path and we get the candidate's own absolute.
    expect(normalizeResolvePath('/proj', '/abs/Other.tsx')).toBe('/abs/Other.tsx')
  })

  it('collapses `..` segments rather than preserving them', () => {
    // Important for the runtime shim's exact-match tier: a manifest entry
    // and a host-side lookup that both run through `normalizeResolvePath`
    // converge on the same canonical string.
    expect(normalizeResolvePath('/proj/src', '../other/x.tsx')).toBe('/proj/other/x.tsx')
  })

  it('rewrites backslash separators inside a segment', () => {
    expect(normalizeResolvePath('/proj', 'src\\Button.tsx')).toBe('/proj/src/Button.tsx')
  })

  it('idempotently re-normalizes an already-canonical absolute path', () => {
    // `normalizeResolvePath(root, alreadyCanonical)` must round-trip — the
    // compiler's `setRoot` and `updateFile` both rely on this for
    // user-supplied roots / file paths that are already POSIX-shaped.
    const canonical = '/proj/src/Button.tsx'
    expect(normalizeResolvePath('/proj', canonical)).toBe(canonical)
  })
})
