/**
 * Orchestrator: pure-string-in, pure-data-out.
 *
 * Pipeline:
 *   legacy-skip -> metadata -> transpile -> figma_code_connect ->
 *     execute_template -> extract_jsx_info -> component_name_inference -> build descriptors.
 *
 * The first step is a cheap `source.includes('figma.connect(')` substring
 * check: if it matches, the file is treated as a legacy Code Connect file
 * and skipped with a migrate-warning. Everything else is run through the
 * full template pipeline regardless of whether a `// url=` directive is
 * present — the recognize pre-filter was removed in favor of unconditional
 * execution, since the VM sandbox handles non-template files gracefully
 * (they just produce zero descriptors).
 *
 * `parseComponentDescriptorsFromSource` is the pure in-memory entry
 * point — no fs reads. The convenience wrapper
 * `parseComponentDescriptorsFromFile` reads the source from disk and
 * returns `undefined` on a read failure (so the caller can treat that
 * as a delete event).
 */
import type { ComponentDescriptor } from '../types';
export interface ParseResult {
    descriptors: ComponentDescriptor[];
    warnings?: string[];
    /** True if the file appears to use the legacy `figma.connect(...)` API (skipped). */
    isLegacyConnectFile?: boolean;
    metadata?: {
        url?: string;
        component?: string;
        source?: string;
    };
}
/**
 * Pure-string-in, pure-data-out template parser.
 *
 * @param source     Raw template source code.
 * @param filePath   Absolute or relative path the source was read from.
 *                   Used as the descriptor's `filePath` field and as a
 *                   diagnostic prefix in warnings; also drives the
 *                   basename-based component-name fallback when no
 *                   `// component=` directive or recoverable JSX root is
 *                   present. Optional — defaults to `'template.figma.ts'`.
 * @param timeoutMs  Per-template execution budget for `vm.runInContext`.
 *                   Optional — defaults to 300ms.
 * @param root       Absolute path to the project root. Forwarded to
 *                   `resolveComponentSourcePath` so `// source=` directives
 *                   that look project-rooted (`src/foo.tsx`,
 *                   `/src/foo.tsx`) resolve correctly even when the
 *                   template lives in a subdirectory. Optional — when
 *                   omitted, defaults to `path.dirname(filePath)`, which
 *                   degenerates the project-root fallback into a redundant
 *                   template-relative retry (i.e. a no-op for callers that
 *                   don't have a real project root, e.g. ad-hoc tests).
 *                   The compiler always passes an explicit root.
 */
export declare function parseComponentDescriptorsFromSource(source: string, filePath?: string, timeoutMs?: number, root?: string): ParseResult;
/**
 * Convenience wrapper that reads `filePath` from disk and feeds the
 * source through `parseComponentDescriptorsFromSource`. Returns
 * `undefined` IFF the read itself fails — caller treats that as a
 * "the file disappeared between discovery and parse" delete event
 * (the build pipeline clears the file's descriptors via `replace([])`
 * and the HMR path likewise clears them).
 *
 * Any error AFTER a successful read (transpile diagnostics, runtime
 * exception, timeout) surfaces inside the returned `ParseResult.warnings`,
 * NOT as `undefined`. That distinction matters: parser problems are
 * "we saw the file but couldn't extract descriptors", while a missing
 * file is "the file is gone and its previous descriptors should be
 * removed".
 */
export declare function parseComponentDescriptorsFromFile(filePath: string, timeoutMs: number, root?: string): Promise<ParseResult | undefined>;
/**
 * Raw, unvalidated string output of `extractMetadata`. Each field is
 * the verbatim value of its directive — `// url=`, `// component=`,
 * `// source=` — with surrounding whitespace trimmed. Downstream
 * consumers apply their own validation:
 *
 *  - `url` is metadata-only; surfaced on `ParseResult.metadata` for the panel.
 *  - `componentDirective` feeds `inferComponentName` (which validates it
 *    parses as an identifier).
 *  - `sourceDirective` feeds `resolveComponentSourcePath` (which
 *    skips `http(s)://` values and probes filesystem candidates).
 */
export interface RawMetadata {
    url?: string;
    componentDirective?: string;
    sourceDirective?: string;
}
export declare function extractMetadata(source: string): RawMetadata;
