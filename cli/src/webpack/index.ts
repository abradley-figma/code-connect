/**
 * Webpack adapter for `@figma/code-connect`. Emitted-file mode (runtime.js
 * on disk under `node_modules/.cache/figma-code-connect/`), path alias on
 * the user's compiler resolve config, and native watch via `afterCompile` +
 * `fileDependencies.add`.
 *
 * The `node_modules/.cache/` prefix on the runtime path is load-bearing
 * for HMR: Webpack 5's default `snapshot.managedPaths` regex
 * (`(?!\.cache|\.pnpm)`) explicitly excludes `.cache/`, so the emitted
 * runtime gets content+mtime snapshots instead of immutable
 * package-version snapshots. Without this carve-out, a `.figma.ts`
 * change → `beforeCompile` rewrites `runtime.js` → Webpack's rebuild
 * keeps the OLD parsed module → browser sees stale descriptors. See
 * `resolveRuntimeFilePath` in `compile/runtime.ts` for the full writeup.
 *
 * The user is responsible for writing
 *
 *     import '@figma/code-connect/register'
 *
 * in their app's entry. This adapter does NOT auto-inject that import —
 * keeping the side-effect explicit means production bundles stay clean
 * of any reference to the runtime when the adapter resolves to
 * `enabled: false`.
 *
 * Works with both webpack 4 and webpack 5 — the only surfaces touched
 * are `compiler.hooks.beforeCompile`, `compiler.hooks.afterCompile`,
 * `compiler.options.resolve.alias`, and `compilation.fileDependencies`,
 * which are identical across the two majors.
 *
 * The `enabled` option toggles ALL of the above. When (resolved)
 * disabled, `apply()` short-circuits before touching the compiler:
 * no parser run, no alias, no emitted file, no hook taps. The user's
 * `import '@figma/code-connect/register'` then resolves through normal
 * Node resolution to the empty placeholder shipped by this package — a
 * tiny, side-effect-free module that compiles down to nothing in the
 * production bundle.
 *
 * ZERO imports from `webpack`.
 */

import { createCompiler, type CodeConnectCompiler, type CreateCompilerOptions } from '../compile'

export interface CodeConnectWebpackOptions extends CreateCompilerOptions {
  /**
   * Toggle the entire plugin.
   *
   *  - `true`      — discover + parse templates, emit the runtime to
   *                  disk, install a `resolve.alias` entry so
   *                  `@figma/code-connect/register` imports route to
   *                  the emitted runtime, register watch deps for HMR.
   *  - `false`     — the plugin is a complete no-op. The user's manual
   *                  `import '@figma/code-connect/register'` resolves
   *                  to the empty placeholder (`export {}`) via normal
   *                  Node resolution, so production bundles ship zero
   *                  runtime code.
   *  - `undefined` — (default) auto-detect from
   *                  `compiler.options.mode`. Enabled when `mode` is
   *                  anything other than `'production'` (i.e.
   *                  `'development'`, `'none'`, or unset). Disabled
   *                  when `mode === 'production'`.
   *
   * Pass an explicit boolean to override the auto-detection — e.g.
   * `enabled: true` to ship the runtime in production bundles, or
   * `enabled: false` to skip it entirely even in dev.
   */
  enabled?: boolean
}

/**
 * Local Webpack compiler/compilation shapes. ONLY the fields we touch.
 * Structurally compatible with `import('webpack').Compiler` from webpack 5
 * (and webpack 4's identical hook surface).
 */
interface WebpackTapInfo {
  name: string
  context?: boolean
}

interface WebpackHook<TArg> {
  tapPromise(name: string | WebpackTapInfo, fn: (arg: TArg) => Promise<void>): void
  tap(name: string | WebpackTapInfo, fn: (arg: TArg) => void): void
}

interface WebpackResolve {
  alias?: Record<string, string | string[] | false>
}

interface WebpackCompilerOptions {
  context?: string
  /** `'development' | 'production' | 'none' | undefined`. Used by the
   *  default `enabled` resolver — `'production'` disables the plugin,
   *  every other value enables it. */
  mode?: 'development' | 'production' | 'none'
  resolve?: WebpackResolve
}

interface WebpackCompilation {
  fileDependencies: { add(dep: string): void } | Set<string>
}

interface WebpackCompiler {
  context: string
  options: WebpackCompilerOptions
  hooks: {
    beforeCompile: WebpackHook<unknown>
    afterCompile: WebpackHook<WebpackCompilation>
    watchRun?: WebpackHook<WebpackCompiler>
  }
}

interface WebpackPluginInstance {
  apply(compiler: WebpackCompiler): void
}

export class FigmaCodeConnectPlugin implements WebpackPluginInstance {
  private codeConnectCompiler: CodeConnectCompiler | undefined

  constructor(private opts: CodeConnectWebpackOptions = {}) {
    // Eagerly create the compiler unless we already know we're disabled.
    // For `enabled: undefined` we have to defer the dev-mode check to
    // `apply()` (where `compiler.options.mode` is available), so
    // `createCompiler` runs upfront — it's cheap (no I/O, no parsing).
    if (opts.enabled !== false) {
      this.codeConnectCompiler = createCompiler(opts)
    }
  }

  apply(compiler: WebpackCompiler): void {
    if (!this.codeConnectCompiler) return // hard short-circuit (`enabled: false`)

    const enabled =
      this.opts.enabled ?? compiler.options.mode !== 'production'
    if (!enabled) return

    if (!this.opts.root) this.codeConnectCompiler.setRoot(compiler.context)

    compiler.options.resolve = compiler.options.resolve ?? {}
    compiler.options.resolve.alias = {
      ...compiler.options.resolve.alias,
      ...this.codeConnectCompiler.getRuntimeAlias(),
    }

    const tapName = 'figma-code-connect'

    compiler.hooks.beforeCompile.tapPromise(
      tapName,
      async () => {
        await this.rebuildAndEmit()
      },
    )

    compiler.hooks.afterCompile.tap(tapName, (compilation) => {
      // Tell webpack about every template file so its watcher invalidates
      // the build when one changes. webpack 5 uses Set<string>, webpack 4
      // uses a similar add-only interface. We pull the latest list off the
      // compiler instead of stashing it locally — the compiler is the
      // source of truth for "what discover saw last time `build()` ran".
      const deps = compilation.fileDependencies as { add(dep: string): void }
      for (const discoveredFile of this.codeConnectCompiler!.getDiscoveredFiles()) {
        deps.add(discoveredFile)
      }
    })

    if (compiler.hooks.watchRun) {
      compiler.hooks.watchRun.tapPromise(
        tapName,
        async () => {
          await this.rebuildAndEmit()
        },
      )
    }
  }

  private async rebuildAndEmit(): Promise<void> {
    if (!this.codeConnectCompiler) return
    await this.codeConnectCompiler.build()
    await this.codeConnectCompiler.emitRuntimeModule()
  }
}

export function figmaCodeConnect(opts: CodeConnectWebpackOptions = {}): FigmaCodeConnectPlugin {
  return new FigmaCodeConnectPlugin(opts)
}
