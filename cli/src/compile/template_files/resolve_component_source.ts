/**
 * Resolve the React component's source file path that a Code Connect template
 * targets. The result becomes `ComponentDescriptor.filePath` and is the lookup
 * key the runtime shim ultimately consults.
 *
 * Priority order (first hit wins):
 *  1. `// source=` directive — filesystem-shaped only. http(s) URLs are
 *     metadata-only and are skipped here. Tried template-relative first;
 *     when that fails the candidate is retried project-rooted with any
 *     leading separator(s) stripped — so both `// source=src/foo.tsx` and
 *     `// source=/src/foo.tsx` resolve to `<root>/src/foo.tsx` even when
 *     the template lives in a subdirectory. Genuine absolute paths that
 *     exist still resolve via the first try (the project-root fallback
 *     only fires on miss).
 *  2. Default `imports[]` entry on the canonical export whose default name
 *     equals `componentName`. Bare specifiers (`@scope/x`, `lodash/get`) are
 *     skipped — this resolver is path-only.
 *  3. Sibling-file heuristic: `<dir>/<basename>.{tsx,jsx,ts,js}` next to the
 *     template, with TypeScript-first extension order.
 *
 * Each tier resolves to an absolute path and probes for existence via
 * `probeFile`. The probe is injectable so tests can drive the matrix without
 * touching the disk. The default probe is `fs.existsSync` — synchronous, but
 * the parser pipeline already does I/O via `executeTemplate` and the worst-
 * case probe count per template is small (`1 + N(imports) + 4` siblings).
 */

import * as path from 'node:path'
import * as fs from 'node:fs'
import { normalizeResolvePath } from '../../common/path'

export interface ResolveComponentSourceOpts {
  /**
   * Absolute path to the project root. A `// source=` directive that does
   * not resolve template-relative is retried project-rooted, with any
   * leading `/` stripped — so `// source=src/foo.tsx` and
   * `// source=/src/foo.tsx` both resolve to `<root>/src/foo.tsx`.
   */
  root: string
  /** Absolute path to the `.figma.ts` template that produced this descriptor. */
  templateFilePath: string
  /** Resolved by `inferComponentName`; drives the imports[] match. */
  componentName: string
  /** The default export of the executed template (passed through verbatim). */
  defaultExport: unknown
  /** `// source=` directive, already extracted by `extractMetadata`. */
  sourceDirective?: string
  /** Returns true iff the candidate path resolves to a readable file. */
  fileExists?: (absPath: string) => boolean
}

/**
 * Best-effort source-path resolution for a single template. Returns an
 * absolute, POSIX-normalized (forward-slash) filesystem path on success, or
 * `undefined` when no tier matches (the runtime shim's name-only fallback
 * handles that case). POSIX shape keeps `descriptor.filePath` byte-equal
 * across platforms before `snapshot()` rewrites it project-relative.
 */
export function resolveComponentSourcePath(
  opts: ResolveComponentSourceOpts,
): string | undefined {
  const fileExists = opts.fileExists ?? defaultFileExists
  const templateDir = path.dirname(opts.templateFilePath)

  // 1. // source= directive (filesystem-shaped only — skip http(s) URLs)
  if (opts.sourceDirective && !HTTP_RE.test(opts.sourceDirective)) {
    const directiveResolved = resolveSourceDirective(
      opts.root,
      opts.sourceDirective,
      templateDir,
      fileExists,
    )
    // The directive is authoritative — don't fall through to imports[] when
    // it's set but doesn't resolve. The user told us where to look.
    return directiveResolved
  }

  // 2. imports[] match by default-name == componentName
  //
  // Imports[] specifiers are JS-shaped (`./Button`, `../shared/Card`) and
  // are unambiguously source-file-relative. We deliberately do NOT apply
  // the project-root fallback here — `./Button` means "next to me", and
  // silently rerouting to `<root>/Button` would change long-standing
  // semantics for templates that genuinely import from the same dir.
  const imports = parseImports(opts.defaultExport)
  const match = imports.find((i) => i.name === opts.componentName)
  if (match) {
    if (isPathSpecifier(match.specifier)) {
      const resolved = probeFromBase(match.specifier, templateDir, fileExists)
      if (resolved) return resolved
    }
    // Bare specifier or unresolvable path — fall through to sibling probe.
  }

  // 3. Sibling-file heuristic: <dir>/<base>.{tsx,jsx,ts,js}
  const base = stripTemplateExtension(path.basename(opts.templateFilePath))
  if (base) {
    const probed = probeWithExtensions(normalizeResolvePath(templateDir, base), fileExists)
    if (probed) return probed
  }

  return undefined
}

function defaultFileExists(absPath: string): boolean {
  try {
    return fs.statSync(absPath).isFile()
  } catch {
    return false
  }
}

/**
 * Resolve a `// source=` directive against the template's directory first,
 * then — on miss — against the project root with any leading `/` stripped.
 * This makes the directive forgiving of the two natural shapes the docs
 * promote (`src/foo.tsx`, `/src/foo.tsx`) without changing semantics for
 * directives that are unambiguously template-relative:
 *
 *   ┌──────────────────────────┬─────────────────────────────────────────┐
 *   │ Directive shape          │ Resolution                              │
 *   ├──────────────────────────┼─────────────────────────────────────────┤
 *   │ `./foo.tsx`, `../foo`    │ Template-relative only (no fallback —   │
 *   │                          │ user explicitly typed the dot prefix).  │
 *   │ `src/foo.tsx`            │ Template-relative first; on miss,       │
 *   │                          │ retry as `<root>/src/foo.tsx`.          │
 *   │ `/src/foo.tsx`           │ Absolute first (exits early if it       │
 *   │                          │ exists on disk); on miss, retry as      │
 *   │                          │ `<root>/src/foo.tsx` after stripping    │
 *   │                          │ the leading slash.                      │
 *   │ `/abs/path/foo.tsx`      │ Absolute first — wins when the file     │
 *   │ (real absolute that      │ actually exists.                        │
 *   │ exists on disk)          │                                         │
 *   └──────────────────────────┴─────────────────────────────────────────┘
 *
 * Only the `// source=` directive flows through here. Imports[] specifiers
 * are JS-relative by definition and use `probeFromBase` directly so that
 * `./Button` keeps its long-standing "next-to-me" semantics.
 */
function resolveSourceDirective(
  root: string,
  sourceDirective: string,
  templateDir: string,
  fileExists: (p: string) => boolean,
): string | undefined {
  const fromTemplate = probeFromBase(sourceDirective, templateDir, fileExists)
  if (fromTemplate) return fromTemplate

  // Skip the project-root fallback for explicit `./` / `../` directives.
  // The user typed the dot prefix on purpose — silently rerouting to
  // `<root>/Button` when `<templateDir>/Button` is missing would land on
  // a different file with the same basename and quietly publish wrong
  // data. Better to bail and force the user to fix the directive.
  if (sourceDirective.startsWith('.')) return undefined

  // Strip leading `/` (and `\\` for Windows-shaped candidates) so
  // `/src/foo` and `src/foo` are treated identically when probing
  // project-rooted. `path.resolve(root, 'src/foo')` joins correctly;
  // `path.resolve(root, '/src/foo')` would short-circuit to the literal
  // absolute path again, defeating the fallback.
  const projectRelative = sourceDirective.replace(/^[/\\]+/, '')
  if (projectRelative === '') return undefined
  return probeFromBase(projectRelative, root, fileExists)
}

/**
 * Resolve `candidate` against `base` and probe. Extension-bearing
 * candidates are checked exactly; extensionless ones walk the
 * TypeScript-first extension list. Used directly by the imports[] tier
 * (JS-relative semantics) and twice by `resolveSourceDirective`
 * (template-dir first, then project-root fallback).
 */
function probeFromBase(
  candidate: string,
  base: string,
  fileExists: (p: string) => boolean,
): string | undefined {
  const abs = normalizeResolvePath(base, candidate)
  if (EXTENSION_RE.test(abs)) {
    return fileExists(abs) ? abs : undefined
  }
  return probeWithExtensions(abs, fileExists)
}

function probeWithExtensions(
  absBase: string,
  fileExists: (p: string) => boolean,
): string | undefined {
  for (const ext of EXTENSIONS) {
    const candidate = absBase + ext
    if (fileExists(candidate)) return candidate
  }
  return undefined
}

/**
 * Return `true` for path-shaped specifiers (`./x`, `../x`, `/x`, `C:\x`).
 * Bare specifiers like `@scope/x` and `lodash/get` are skipped — this
 * resolver does not consult `node_modules` or path-mapping configs.
 */
function isPathSpecifier(specifier: string): boolean {
  if (specifier.startsWith('.')) return true
  if (specifier.startsWith('/')) return true
  // Windows drive letter (`C:\…` or `C:/…`).
  if (/^[A-Za-z]:[\\/]/.test(specifier)) return true
  return false
}

interface ParsedImport {
  name: string
  specifier: string
}

/**
 * Read `imports[]` off the canonical `{ example, imports, ... }` default
 * export, tolerate missing/malformed shapes, and surface only default-import
 * statements (`import Foo from "..."`). Named imports (`import { Foo } …`),
 * namespace imports (`import * as Foo …`), and bare side-effect imports
 * (`import "./foo"`) are skipped — none of them tell us a single source path
 * for the JSX root tag.
 */
function parseImports(defaultExport: unknown): ParsedImport[] {
  if (!defaultExport || typeof defaultExport !== 'object') return []
  const raw = (defaultExport as { imports?: unknown }).imports
  if (!Array.isArray(raw)) return []

  const out: ParsedImport[] = []
  for (const entry of raw) {
    if (typeof entry !== 'string') continue
    const match = entry.match(DEFAULT_IMPORT_RE)
    if (!match) continue
    out.push({ name: match[1], specifier: match[2] })
  }
  return out
}

/**
 * Strip the trailing template suffix from a basename so we can probe for
 * sibling component files. Mirrors `component_name_inference.basenameComponent`
 * but keeps the original casing so we end up with `Button` for `Button.figma.ts`.
 *
 * Returns `undefined` when the input isn't a recognised template basename.
 */
function stripTemplateExtension(base: string): string | undefined {
  const stripped = base
    .replace(/\.figma\.template\.tsx?$/i, '')
    .replace(/\.figma\.template\.jsx?$/i, '')
    .replace(/\.figma\.tsx?$/i, '')
    .replace(/\.figma\.jsx?$/i, '')
  if (stripped === base) return undefined
  return stripped || undefined
}

const EXTENSIONS = ['.tsx', '.jsx', '.ts', '.js'] as const
const EXTENSION_RE = /\.(tsx|jsx|ts|js)$/i
const HTTP_RE = /^https?:\/\//i
// Match a default import statement, optionally followed by a named or
// namespace clause. Captures the default-import identifier (group 1) and
// the module specifier (group 2).
//
//   import Button from "./Button"                  → ✓ Button, ./Button
//   import Button, { ButtonProps } from "./Button" → ✓ Button, ./Button
//   import Button, * as B2 from "./Button"         → ✓ Button, ./Button
//   import { Button } from "./components"          → ✗ (named-only)
//   import * as Button from "./Button"             → ✗ (namespace-only)
//   import "./side-effect"                         → ✗ (no binding)
const DEFAULT_IMPORT_RE =
  /^\s*import\s+([A-Za-z_$][A-Za-z0-9_$]*)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+[A-Za-z_$][A-Za-z0-9_$]*))?\s+from\s+["']([^"']+)["']/
