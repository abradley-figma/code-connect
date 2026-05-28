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

import { ComponentDescriptorStore } from './template_files/component_descriptor_store'
import type {
  CodeConnectBuildResult,
  CodeConnectCompiler,
  CodeConnectManifest,
  CodeConnectUpdateFileResult,
  CreateCompilerOptions,
} from './types'
import { CodeConnectConfig, discoverFilesByGlob, isTemplateFilePath, parseOrDetermineConfig, resolveTemplateGlobs } from '../connect/project'
import { normalizePath, normalizeRelativePath, normalizeResolvePath } from '../common/path'
import { parseComponentDescriptorsFromFile } from './template_files/parse_template_file_source'
import { emitRuntimeModule, generateManifest, generateRuntimeShim, resolveRuntimeFilePath } from './runtime'
import path from 'node:path'
import { cwd } from 'node:process'
import { build } from './build'
import { logger, LogLevel } from '../common/logging';

export function createCompiler(
  opts: CreateCompilerOptions = {},
): CodeConnectCompiler {
  logger.setLogLevel(opts.debugLogs ? LogLevel.Debug : LogLevel.Nothing)

  let root = opts.root ?? cwd()
  if (typeof root !== 'string' || !path.isAbsolute(root)) {
    throw new Error('Root path must be a string and absolute')
  }
  root = normalizePath(root)

  let config: CodeConnectConfig | undefined = undefined
  let discoveredTemplateFiles = new Set<string>()

  // Resolved include/exclude globs cached from the most recent
  // `build()`. Populated by `resolveTemplateGlobs`, which layers
  // connect's templates-only defaults (`**/*.figma.ts`,
  // `node_modules/**`, etc.) on top of whatever the user's
  // `figma.config.json` does or doesn't set. Used by `updateFile`'s
  // HMR predicate so a per-file save matches the same rules the full
  // discovery did — reading `config.include` / `config.exclude`
  // directly would miss the layered defaults and silently classify
  // every file as `'unknown-file'` for projects without an explicit
  // `figma.config.json#codeConnect.include`. Pre-`build`, the predicate
  // is short-circuited by the `!config` guard so these never need to
  // be valid until `build` populates them.
  let resolvedIncludeGlobs: string[] = []
  let resolvedExcludeGlobs: string[] = []

  const timeoutMs = opts.timeoutMs ?? 300
  const componentDescriptors = new ComponentDescriptorStore()

  // Canonical import specifier the runtime module is published under.
  // Surfaced via `getRuntimeModuleId()` and used as the alias key in
  // `getRuntimeAlias()`. Centralized here so adapters never hard-code
  // the string in their own alias / virtual-module wiring — keeps
  // renames / multi-package layouts a single-line change.
  const runtimeModuleId = '@figma/code-connect/register'

  return {
    async build(): Promise<CodeConnectBuildResult> {
      if (!config) {
        const parsedResult = await parseOrDetermineConfig(root, '', true)
        config = parsedResult.config
        const resolvedGlobs = resolveTemplateGlobs(config, true)

        if (!resolvedGlobs.include) {
          throw new Error('Code Connect: unable to resolve template include globs')
        }
        resolvedIncludeGlobs = resolvedGlobs.include
        resolvedExcludeGlobs = resolvedGlobs.exclude
      }

      const nextDiscoveredFiles = await discoverFilesByGlob(root, resolvedIncludeGlobs, resolvedExcludeGlobs)

      const buildResult = await build({
        root,
        nextDiscoveredFiles,
        previousDiscoveredFiles: discoveredTemplateFiles,
        componentDescriptors,
        timeoutMs,
      })

      discoveredTemplateFiles = buildResult.discoveredTemplateFiles

      return {
        templateFileCount: buildResult.discoveredTemplateFiles.size,
        warnings: buildResult.warnings,
      }
    },

    getDiscoveredFiles(): string[] {
      // `build()` constructs the Set from `discoverFilesByGlob`'s
      // already-sorted output (sort/dedup is part of that helper's
      // contract — see `cli/src/connect/project.ts#discoverFilesByGlob`),
      // and `Set` preserves insertion order, so `[...set]` is already
      // sorted. Defensive copy so callers can't poison the compiler's
      // internal state.
      return [...discoveredTemplateFiles]
    },

    async updateFile(filePath: string): Promise<CodeConnectUpdateFileResult> {
      if (!config) return { type: 'no-config' }

      filePath = normalizeResolvePath(root, filePath)

      const relPath = normalizeRelativePath(root, filePath)
      // Use the RESOLVED globs (defaults layered + user config) cached
      // from the last `build()` — not `config.include` / `config.exclude`
      // directly. Raw config values are `undefined` when the project
      // doesn't set `figma.config.json#codeConnect.include` / `.exclude`,
      // which is the common case; falling back to `[]` would make the
      // predicate reject every file and silently break HMR.
      if (!isTemplateFilePath(relPath, resolvedIncludeGlobs, resolvedExcludeGlobs)) {
        return { type: 'unknown-file' }
      }

      // A read failure here is the "the template was deleted" case —
      // `parseComponentDescriptorsFromFile` returns `undefined`, we
      // coalesce to `[]`, and `replace([])` clears the entry from the
      // store. This is the same delete semantics `build()` uses for
      // files that vanished between rebuilds.
      const parseResult = await parseComponentDescriptorsFromFile(filePath, timeoutMs, root)
      const descriptors = parseResult?.descriptors ?? []
      const changed = componentDescriptors.replace(filePath, descriptors)

      // Keep `discoveredTemplateFiles` in sync so callers of
      // `getDiscoveredFiles()` (notably webpack's `afterCompile` →
      // `compilation.fileDependencies.add`) see newly added templates
      // and stop tracking deleted ones without waiting for the next
      // full `build()`. The descriptor store drops entries on an empty
      // `replace`, so `has(filePath)` is the single source of truth
      // for "should this still be considered discovered".
      if (componentDescriptors.has(filePath)) {
        discoveredTemplateFiles.add(filePath)
      } else {
        discoveredTemplateFiles.delete(filePath)
      }

      return { type: 'template-file', changed }
    },

    async generateManifest(): Promise<CodeConnectManifest> {
      const manifest = await generateManifest(componentDescriptors.snapshot(root))
      return manifest
    },

    async generateRuntimeShim(): Promise<string> {
      const manifest = await this.generateManifest()
      return generateRuntimeShim(manifest)
    },

    async emitRuntimeModule(): Promise<void> {
      const runtimeFilePath = resolveRuntimeFilePath(root, opts.outFile)
      const manifest = await this.generateManifest()
      await emitRuntimeModule(runtimeFilePath, manifest)
    },

    getRuntimeAlias(): Record<string, string> {
      return {
        [runtimeModuleId]: resolveRuntimeFilePath(root, opts.outFile),
      }
    },

    getRuntimeFilePath(): string {
      return resolveRuntimeFilePath(root, opts.outFile)
    },

    getRuntimeModuleId(): string {
      return runtimeModuleId
    },

    setRoot(newRoot: string): void {
      if (typeof newRoot !== 'string' || !path.isAbsolute(newRoot)) {
        throw new Error('Root path must be a string and absolute')
      }
      root = normalizePath(newRoot)

      // Invalidate the cached config + resolved globs — they were
      // resolved against the OLD root's `figma.config.json` and a
      // different root might ship different `codeConnect.include` /
      // `codeConnect.exclude` (or none at all). The next `build()`
      // re-runs `parseOrDetermineConfig` + `resolveTemplateGlobs`
      // against the new root.
      //
      // `discoveredTemplateFiles` is intentionally NOT cleared — the
      // next build's cleanup-on-disappear pass (`build.ts`) reads it
      // as `previousDiscoveredFiles` to drop stale descriptors whose
      // absolute paths no longer match anything under the new root.
      // Clearing it here would leak old-root descriptors into the new
      // build's `componentDescriptors` map.
      config = undefined
      resolvedIncludeGlobs = []
      resolvedExcludeGlobs = []
    },

    getRoot(): string {
      return root
    },
  }
}
