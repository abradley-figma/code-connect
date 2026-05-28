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
export interface ResolveComponentSourceOpts {
    /**
     * Absolute path to the project root. A `// source=` directive that does
     * not resolve template-relative is retried project-rooted, with any
     * leading `/` stripped — so `// source=src/foo.tsx` and
     * `// source=/src/foo.tsx` both resolve to `<root>/src/foo.tsx`.
     */
    root: string;
    /** Absolute path to the `.figma.ts` template that produced this descriptor. */
    templateFilePath: string;
    /** Resolved by `inferComponentName`; drives the imports[] match. */
    componentName: string;
    /** The default export of the executed template (passed through verbatim). */
    defaultExport: unknown;
    /** `// source=` directive, already extracted by `extractMetadata`. */
    sourceDirective?: string;
    /** Returns true iff the candidate path resolves to a readable file. */
    fileExists?: (absPath: string) => boolean;
}
/**
 * Best-effort source-path resolution for a single template. Returns an
 * absolute, POSIX-normalized (forward-slash) filesystem path on success, or
 * `undefined` when no tier matches (the runtime shim's name-only fallback
 * handles that case). POSIX shape keeps `descriptor.filePath` byte-equal
 * across platforms before `snapshot()` rewrites it project-relative.
 */
export declare function resolveComponentSourcePath(opts: ResolveComponentSourceOpts): string | undefined;
