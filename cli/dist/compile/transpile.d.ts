/**
 * Thin wrapper around `ts.transpileModule` that produces CommonJS suitable for
 * `vm.runInContext` execution.
 *
 * Diagnostics are collected and surfaced as a string array but NEVER cause
 * the transpile to fail — many real templates have transpile-time
 * diagnostics (missing types from peer dependencies, decorator metadata,
 * etc.) that don't actually affect the descriptor extraction. The
 * downstream `executeTemplate` is the load-bearing step; if a diagnostic
 * was actually fatal, execution will surface its own `threw` value.
 */
export interface TranspileResult {
    /** CommonJS source ready to feed to `vm.runInContext`. Always
     *  non-empty for non-empty input — TypeScript still emits
     *  diagnostic-only files. */
    js: string;
    /** Pre-formatted diagnostic strings (`"<file>:<line>:<col>: <msg>"`).
     *  Surfaced as parser warnings; never a hard error. */
    diagnostics: string[];
}
/**
 * `ts.transpileModule` infers ScriptKind from the file extension — so a
 * `.figma.ts` file would NOT have JSX parsed even though template files
 * legitimately interpolate JSX into enum values. Force a `.tsx` suffix on the
 * internal fileName so JSX is always parsed; the caller's `fileName` is still
 * used for diagnostic prefixes via `diagnosticFileName`.
 */
export declare function transpileSource(source: string, fileName: string): TranspileResult;
