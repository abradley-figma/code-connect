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

import ts from 'typescript'

export interface TranspileResult {
  /** CommonJS source ready to feed to `vm.runInContext`. Always
   *  non-empty for non-empty input — TypeScript still emits
   *  diagnostic-only files. */
  js: string
  /** Pre-formatted diagnostic strings (`"<file>:<line>:<col>: <msg>"`).
   *  Surfaced as parser warnings; never a hard error. */
  diagnostics: string[]
}

/**
 * Stable compilerOptions used for every template transpile. Notable choices:
 *
 * - `module: CommonJS` so the output uses `module.exports` / `require()`,
 *   which composes naturally with `vm.runInNewContext` and our `require`
 *   shim.
 * - `target: ES2022` is broad enough to cover anything templates would use
 *   without requiring `tslib` helpers.
 * - `jsx: ReactJSX` so any JSX inside enum-value expressions transpiles to
 *   `react/jsx-runtime` calls; our require shim resolves that to a stub.
 * - `isolatedModules: true` makes single-file transpile semantics explicit.
 * - `removeComments: false` preserves the leading magic comments in the
 *   transpiled output (though `extractMetadata` already runs against the
 *   pre-transpile source, this is a defensive belt-and-suspenders).
 */
const COMPILER_OPTIONS: ts.CompilerOptions = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.ReactJSX,
  esModuleInterop: true,
  isolatedModules: true,
  importHelpers: false,
  removeComments: false,
  inlineSourceMap: false,
  noEmitOnError: false,
}

/**
 * `ts.transpileModule` infers ScriptKind from the file extension — so a
 * `.figma.ts` file would NOT have JSX parsed even though template files
 * legitimately interpolate JSX into enum values. Force a `.tsx` suffix on the
 * internal fileName so JSX is always parsed; the caller's `fileName` is still
 * used for diagnostic prefixes via `diagnosticFileName`.
 */
export function transpileSource(source: string, fileName: string): TranspileResult {
  const result = ts.transpileModule(source, {
    compilerOptions: COMPILER_OPTIONS,
    fileName: ensureTsxExtension(fileName),
    reportDiagnostics: true,
  })

  const diagnostics: string[] = []
  for (const d of result.diagnostics ?? []) {
    const msg = ts.flattenDiagnosticMessageText(d.messageText, '\n')
    if (d.file && d.start !== undefined) {
      const { line, character } = d.file.getLineAndCharacterOfPosition(d.start)
      diagnostics.push(`${fileName}:${line + 1}:${character + 1}: ${msg}`)
    } else {
      diagnostics.push(`${fileName}: ${msg}`)
    }
  }

  return { js: result.outputText, diagnostics }
}

/**
 * Force a JSX-aware extension on the fileName passed to
 * `ts.transpileModule`. TypeScript infers `ScriptKind` from the
 * extension, so a plain `.figma.ts` would be transpiled as TS-only
 * — but template files legitimately interpolate JSX into enum value
 * mappings (`{ Primary: <Icon name="check" /> }`), and that JSX must
 * survive transpilation as `react/jsx-runtime.jsx(...)` calls so our
 * `require('react/jsx-runtime')` shim picks it up.
 *
 * Already-JSX extensions (`.tsx`, `.jsx`) are left alone. Plain
 * `.ts`/`.js` are rewritten in place; anything else (no extension,
 * unrecognized extension) gets `.tsx` appended.
 */
function ensureTsxExtension(fileName: string): string {
  if (/\.tsx$/i.test(fileName) || /\.jsx$/i.test(fileName)) return fileName
  if (/\.ts$/i.test(fileName)) return fileName.replace(/\.ts$/i, '.tsx')
  if (/\.js$/i.test(fileName)) return fileName.replace(/\.js$/i, '.jsx')
  return fileName + '.tsx'
}
