/**
 * Unit tests for the `createCompiler` factory — the single public
 * surface every bundler adapter consumes. Exercises:
 *
 *   - constructor + opts pass-through
 *   - setRoot (Vite-style late root assignment)
 *   - build discovery, parsing, and per-call return values
 *   - getDiscoveredFiles tracks the latest build()
 *   - generateRuntimeShim output shape (incl. pre-rebuild empty no-op shim)
 *   - getRuntimeAlias shape + default path + outFile override + late-setRoot
 *   - updateFile add/edit/delete + result-shape change-detection +
 *     discoveredFiles invariants (add/delete sync)
 *   - emitRuntimeModule emits + is idempotent
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { createCompiler } from '../compiler'

function setupProject(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'figma-code-connect-compiler-'))
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, contents, 'utf8')
  }
  return root
}

function writeFigmaConfig(root: string, codeConnect: Record<string, unknown>): void {
  // Same shape `figma connect publish` reads — the compile pipeline
  // routes through `parseOrDetermineConfig`, so the on-disk format is
  // identical to the CLI's.
  fs.writeFileSync(
    path.join(root, 'figma.config.json'),
    JSON.stringify({ codeConnect }, null, 2),
    'utf8',
  )
}

const BUTTON_TEMPLATE = [
  '// url=https://example.com',
  "import figma from 'figma'",
  "const v = figma.selectedInstance.getString('Label')",
  'export default figma.code`<Button label={${v}} />`',
].join('\n')

const CARD_TEMPLATE = [
  '// url=https://example.com',
  "import figma from 'figma'",
  "const t = figma.selectedInstance.getString('Title')",
  'export default figma.code`<Card title={${t}} />`',
].join('\n')

describe('createCompiler', () => {
  describe('build', () => {
    it('discovers template files, parses them, and reports descriptors via generateRuntimeShim', async () => {
      const root = setupProject({
        'Button.figma.ts': BUTTON_TEMPLATE,
        'Card.figma.ts': CARD_TEMPLATE,
      })
      try {
        const codeConnectCompiler = createCompiler({ root })
        const { templateFileCount, warnings } = await codeConnectCompiler.build()
        expect(templateFileCount).toBe(2)
        expect(warnings).toEqual([])
        const payload = await codeConnectCompiler.generateRuntimeShim()
        expect(payload).toContain('Button')
        expect(payload).toContain('Card')
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it('ignores non-template .ts files', async () => {
      const root = setupProject({
        'Plain.ts': 'export const x = 1\n',
        'Button.figma.ts': BUTTON_TEMPLATE,
      })
      try {
        const codeConnectCompiler = createCompiler({ root })
        const { templateFileCount } = await codeConnectCompiler.build()
        expect(templateFileCount).toBe(1)
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it('emits a warning for legacy figma.connect() files', async () => {
      // `.figma.ts` is covered by connect's templates-only default
      // include globs (`.figma.tsx` is not — users must opt that in
      // via figma.config.json#codeConnect.include).
      const root = setupProject({
        'Button.figma.ts': [
          "import figma from '@figma/code-connect'",
          "figma.connect(Button, 'https://figma.com/x', { props: {} })",
        ].join('\n'),
      })
      try {
        const codeConnectCompiler = createCompiler({ root })
        const { warnings } = await codeConnectCompiler.build()
        expect(warnings.some((w) => /legacy figma\.connect/.test(w))).toBe(true)
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it("discovers every extension in connect's templates-only default include globs", async () => {
      // The default include set is `.figma.ts`, `.figma.js`,
      // `.figma.template.ts`, `.figma.template.js`, `.figma.batch.json`
      // (the templates-only default include globs inside
      // `resolveTemplateGlobs` in cli/src/connect/project.ts).
      // `.figma.tsx` / `.figma.jsx` are intentionally NOT in the default
      // set — users who want them opt in via `figma.config.json#codeConnect.include`.
      const root = setupProject({
        'Button.figma.ts': BUTTON_TEMPLATE,
        'Switch.figma.js': [
          '// url=https://example.com',
          "import figma from 'figma'",
          "const v = figma.selectedInstance.getBoolean('Checked')",
          'export default figma.code`<Switch checked={${v}} />`',
        ].join('\n'),
        'Avatar.figma.template.ts': [
          '// url=https://example.com',
          "import figma from 'figma'",
          "const v = figma.selectedInstance.getString('Name')",
          'export default figma.code`<Avatar name={${v}} />`',
        ].join('\n'),
        'Slider.figma.template.js': [
          '// url=https://example.com',
          "const figma = require('figma')",
          "const v = figma.selectedInstance.getString('Value')",
          'module.exports = figma.code`<Slider value={${v}} />`',
        ].join('\n'),
      })
      try {
        const codeConnectCompiler = createCompiler({ root })
        const { templateFileCount, warnings } = await codeConnectCompiler.build()
        expect(warnings).toEqual([])
        expect(templateFileCount).toBe(4)
        const payload = await codeConnectCompiler.generateRuntimeShim()
        for (const name of ['Button', 'Switch', 'Avatar', 'Slider']) {
          expect(payload).toContain(name)
        }
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it('clears descriptors for files that no longer match include globs on rebuild', async () => {
      const root = setupProject({
        'Button.figma.ts': BUTTON_TEMPLATE,
        'Card.figma.ts': CARD_TEMPLATE,
      })
      try {
        const codeConnectCompiler = createCompiler({ root })
        await codeConnectCompiler.build()
        expect(await codeConnectCompiler.generateRuntimeShim()).toContain('Card')

        // delete the Card template, rebuild, confirm Card is gone
        fs.rmSync(path.join(root, 'Card.figma.ts'))
        const { templateFileCount } = await codeConnectCompiler.build()
        expect(templateFileCount).toBe(1)
        expect(await codeConnectCompiler.generateRuntimeShim()).not.toContain(
          '"componentName":"Card"',
        )
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it('excludes node_modules by default (connect templates-only excludes layered automatically)', async () => {
      // Pins that the compiler's lazy `parseOrDetermineConfig` + the
      // `resolveTemplateGlobs(config, /*isTemplatesOnlyCLI*/ true)` call
      // in `compiler.ts#build` layer `node_modules/**` even when the
      // project has no `figma.config.json`. Without that layering a
      // dev `npm install` would balloon `templateFileCount` and stall
      // every bundler rebuild on transitive template files.
      const root = setupProject({
        'src/Button.figma.ts': BUTTON_TEMPLATE,
        'node_modules/some-pkg/Junk.figma.ts': BUTTON_TEMPLATE,
      })
      try {
        const codeConnectCompiler = createCompiler({ root })
        const { templateFileCount } = await codeConnectCompiler.build()
        expect(templateFileCount).toBe(1)
        expect(
          codeConnectCompiler.getDiscoveredFiles().map((f) => path.basename(f)),
        ).toEqual(['Button.figma.ts'])
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it('honors figma.config.json#codeConnect.include — user globs narrow the templates-only defaults', async () => {
      // The compile pipeline reads the same `figma.config.json` that
      // `figma connect publish` does (via `parseOrDetermineConfig`),
      // so a project that ships custom include globs gets the same
      // file set in dev and at publish time. Here the user narrows
      // to `.figma.js` only — the `.figma.ts` template must NOT be
      // picked up.
      const root = setupProject({
        'src/Button.figma.ts': BUTTON_TEMPLATE,
        'src/Switch.figma.js': [
          '// url=https://example.com',
          "import figma from 'figma'",
          "const v = figma.selectedInstance.getBoolean('Checked')",
          'export default figma.code`<Switch checked={${v}} />`',
        ].join('\n'),
      })
      try {
        writeFigmaConfig(root, { include: ['**/*.figma.js'] })
        const codeConnectCompiler = createCompiler({ root })
        const { templateFileCount } = await codeConnectCompiler.build()
        expect(templateFileCount).toBe(1)
        const payload = await codeConnectCompiler.generateRuntimeShim()
        expect(payload).toContain('Switch')
        expect(payload).not.toContain('"componentName":"Button"')
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it('honors figma.config.json#codeConnect.exclude — user globs layer with the templates-only default exclude', async () => {
      // `resolveTemplateGlobs` layers the user's exclude on top of
      // `node_modules/**`, never replaces it — so adding `vendored/**`
      // to the config skips that directory while node_modules stays
      // excluded.
      const root = setupProject({
        'src/Button.figma.ts': BUTTON_TEMPLATE,
        'vendored/Junk.figma.ts': BUTTON_TEMPLATE,
        'node_modules/pkg/Junk.figma.ts': BUTTON_TEMPLATE,
      })
      try {
        writeFigmaConfig(root, { exclude: ['vendored/**'] })
        const codeConnectCompiler = createCompiler({ root })
        const { templateFileCount } = await codeConnectCompiler.build()
        expect(templateFileCount).toBe(1)
        expect(
          codeConnectCompiler.getDiscoveredFiles().map((f) => path.basename(f)),
        ).toEqual(['Button.figma.ts'])
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it('caches the resolved globs from build() so HMR via updateFile uses them (figma.config.json#include widening flows through to updateFile)', async () => {
      // The HMR fast path in `compiler.ts#updateFile` calls
      // `isTemplateFilePath` with the include/exclude resolved on the
      // most recent `build()` (`resolvedIncludeGlobs` /
      // `resolvedExcludeGlobs`). Critical wiring: if updateFile read
      // raw `config.include` / `config.exclude` instead, a project
      // with no `figma.config.json` would see `undefined` here and
      // silently classify every file as `'unknown-file'` — breaking
      // HMR for the most common project shape.
      //
      // This test covers the widening direction: the user opts `.figma.tsx`
      // into the include set via figma.config.json, then edits one
      // post-build. updateFile must accept it (`template-file`) rather
      // than reject it (`unknown-file`).
      const root = setupProject({
        'src/Button.figma.ts': BUTTON_TEMPLATE,
        // Brand-new .figma.tsx file the templates-only defaults would
        // NOT pick up — opted in by the config.
        'src/Card.figma.tsx': CARD_TEMPLATE,
      })
      try {
        writeFigmaConfig(root, {
          include: [
            '**/*.figma.ts',
            '**/*.figma.tsx',
            '**/*.figma.js',
            '**/*.figma.template.ts',
            '**/*.figma.template.js',
            '**/*.figma.batch.json',
          ],
        })
        const codeConnectCompiler = createCompiler({ root })
        await codeConnectCompiler.build()
        // The widened glob set must flow through to the HMR predicate.
        const result = await codeConnectCompiler.updateFile(
          path.join(root, 'src/Card.figma.tsx'),
        )
        expect(result.type).toBe('template-file')
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

  })

  describe('getDiscoveredFiles', () => {
    it('returns an empty array before the first build', () => {
      const codeConnectCompiler = createCompiler()
      expect(codeConnectCompiler.getDiscoveredFiles()).toEqual([])
    })

    it('returns the sorted file list from the most recent build', async () => {
      const root = setupProject({
        'Button.figma.ts': BUTTON_TEMPLATE,
        'Card.figma.ts': CARD_TEMPLATE,
      })
      try {
        const codeConnectCompiler = createCompiler({ root })
        await codeConnectCompiler.build()
        const files = codeConnectCompiler.getDiscoveredFiles()
        expect(files.length).toBe(2)
        expect(files.every((f) => path.isAbsolute(f))).toBe(true)
        expect(files.map((f) => path.basename(f)).sort()).toEqual([
          'Button.figma.ts',
          'Card.figma.ts',
        ])
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it('reflects file deletions on a subsequent build', async () => {
      const root = setupProject({
        'Button.figma.ts': BUTTON_TEMPLATE,
        'Card.figma.ts': CARD_TEMPLATE,
      })
      try {
        const codeConnectCompiler = createCompiler({ root })
        await codeConnectCompiler.build()
        expect(codeConnectCompiler.getDiscoveredFiles().length).toBe(2)

        fs.rmSync(path.join(root, 'Card.figma.ts'))
        await codeConnectCompiler.build()
        const files = codeConnectCompiler.getDiscoveredFiles()
        expect(files.length).toBe(1)
        expect(path.basename(files[0])).toBe('Button.figma.ts')
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it('returns a defensive copy — external mutation does not poison state', async () => {
      const root = setupProject({ 'Button.figma.ts': BUTTON_TEMPLATE })
      try {
        const codeConnectCompiler = createCompiler({ root })
        await codeConnectCompiler.build()
        const first = codeConnectCompiler.getDiscoveredFiles()
        first.push('/forged/path.figma.ts')
        // A second call must not include the forged entry.
        expect(codeConnectCompiler.getDiscoveredFiles()).toHaveLength(1)
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })
  })

  describe('setRoot', () => {
    it('lets a Vite-style adapter assign the root after construction', async () => {
      const root = setupProject({ 'Button.figma.ts': BUTTON_TEMPLATE })
      try {
        const codeConnectCompiler = createCompiler()
        codeConnectCompiler.setRoot(root)
        const { templateFileCount } = await codeConnectCompiler.build()
        expect(templateFileCount).toBe(1)
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it('re-points discovery to a new root if called between rebuilds', async () => {
      const rootA = setupProject({ 'Button.figma.ts': BUTTON_TEMPLATE })
      const rootB = setupProject({ 'Card.figma.ts': CARD_TEMPLATE })
      try {
        const codeConnectCompiler = createCompiler({ root: rootA })
        await codeConnectCompiler.build()
        expect(await codeConnectCompiler.generateRuntimeShim()).toContain('Button')

        codeConnectCompiler.setRoot(rootB)
        await codeConnectCompiler.build()
        const payload = await codeConnectCompiler.generateRuntimeShim()
        expect(payload).toContain('Card')
        expect(payload).not.toContain('"componentName":"Button"')
      } finally {
        fs.rmSync(rootA, { recursive: true, force: true })
        fs.rmSync(rootB, { recursive: true, force: true })
      }
    })

    it('invalidates the cached figma.config.json so a new root picks up its own globs (not the previous root\'s)', async () => {
      // Pins the setRoot invalidation contract: the cached config +
      // effective globs from build #1 must NOT leak into build #2
      // when the new root ships a different `figma.config.json`.
      // Without invalidation, switching from rootA (.ts only) to rootB
      // (.js only) would silently apply rootA's `.ts` glob to rootB
      // and miss rootB's `.js` template — and `updateFile` would
      // similarly reject rootB's `.figma.js` as `unknown-file`.
      const rootA = setupProject({ 'src/Button.figma.ts': BUTTON_TEMPLATE })
      const rootB = setupProject({
        'src/Switch.figma.js': [
          '// url=https://example.com',
          "import figma from 'figma'",
          "const v = figma.selectedInstance.getBoolean('Checked')",
          'export default figma.code`<Switch checked={${v}} />`',
        ].join('\n'),
      })
      try {
        writeFigmaConfig(rootA, { include: ['**/*.figma.ts'] })
        writeFigmaConfig(rootB, { include: ['**/*.figma.js'] })

        const codeConnectCompiler = createCompiler({ root: rootA })
        await codeConnectCompiler.build()
        expect(await codeConnectCompiler.generateRuntimeShim()).toContain('Button')

        codeConnectCompiler.setRoot(rootB)
        await codeConnectCompiler.build()
        const payload = await codeConnectCompiler.generateRuntimeShim()
        expect(payload).toContain('Switch')
        expect(payload).not.toContain('"componentName":"Button"')

        // HMR predicate must also pick up rootB's `.js`-only globs —
        // proves `resolvedIncludeGlobs` / `resolvedExcludeGlobs` were
        // re-resolved, not just `config`.
        const result = await codeConnectCompiler.updateFile(
          path.join(rootB, 'src/Switch.figma.js'),
        )
        expect(result.type).toBe('template-file')
      } finally {
        fs.rmSync(rootA, { recursive: true, force: true })
        fs.rmSync(rootB, { recursive: true, force: true })
      }
    })

    it("returns 'no-config' from updateFile after setRoot until the next build() reloads config", async () => {
      // Direct pin of the invalidation: setRoot drops the cached config,
      // so calling updateFile in the window between setRoot and the
      // next build() must surface the same 'no-config' contract as
      // pre-build calls. Without this, an adapter calling updateFile
      // after a watcher root change but before triggering a rebuild
      // would silently classify files against the OLD root's globs.
      const rootA = setupProject({ 'src/Button.figma.ts': BUTTON_TEMPLATE })
      const rootB = setupProject({ 'src/Card.figma.ts': CARD_TEMPLATE })
      try {
        const codeConnectCompiler = createCompiler({ root: rootA })
        await codeConnectCompiler.build()
        // Sanity: in the rootA window, updateFile classifies normally.
        const before = await codeConnectCompiler.updateFile(
          path.join(rootA, 'src/Button.figma.ts'),
        )
        expect(before.type).toBe('template-file')

        codeConnectCompiler.setRoot(rootB)
        // After setRoot, BEFORE the next build, the config is invalidated.
        const after = await codeConnectCompiler.updateFile(
          path.join(rootB, 'src/Card.figma.ts'),
        )
        expect(after.type).toBe('no-config')
      } finally {
        fs.rmSync(rootA, { recursive: true, force: true })
        fs.rmSync(rootB, { recursive: true, force: true })
      }
    })
  })

  describe('updateFile', () => {
    it('returns type "no-config" before the first build, leaving the map alone', async () => {
      // Before the first `build()` the compiler hasn't loaded
      // `figma.config.json` yet, so it can't decide whether a given
      // path matches the include globs. A pre-build updateFile would
      // be clobbered by the upcoming full discover anyway, and there's
      // no consumer reading the serialized module yet. The compiler
      // owns this lifecycle so adapters (Vite) don't have to track
      // their own "initialized" flag.
      const root = setupProject({ 'Button.figma.ts': BUTTON_TEMPLATE })
      try {
        const codeConnectCompiler = createCompiler({ root })
        const result = await codeConnectCompiler.updateFile(path.join(root, 'Button.figma.ts'))
        expect(result.type).toBe('no-config')
        expect(result.changed).toBeUndefined()
        // The map should still be empty (no Button entry).
        expect(await codeConnectCompiler.generateRuntimeShim()).not.toContain('"componentName":"Button"')
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it('returns type "unknown-file" + no change for files that do not match the template globs', async () => {
      const root = setupProject({ 'Button.figma.ts': BUTTON_TEMPLATE, 'README.md': '#' })
      try {
        const codeConnectCompiler = createCompiler({ root })
        await codeConnectCompiler.build()
        const result = await codeConnectCompiler.updateFile(path.join(root, 'README.md'))
        expect(result.type).toBe('unknown-file')
        expect(result.changed).toBeUndefined()
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it('returns changed=false when re-parsing an unchanged template file', async () => {
      const root = setupProject({ 'Button.figma.ts': BUTTON_TEMPLATE })
      try {
        const codeConnectCompiler = createCompiler({ root })
        await codeConnectCompiler.build()
        const result = await codeConnectCompiler.updateFile(path.join(root, 'Button.figma.ts'))
        expect(result.type).toBe('template-file')
        expect(result.changed).toBe(false)
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it('returns changed=true when a file gains a prop', async () => {
      const root = setupProject({ 'Button.figma.ts': BUTTON_TEMPLATE })
      try {
        const codeConnectCompiler = createCompiler({ root })
        await codeConnectCompiler.build()
        const file = path.join(root, 'Button.figma.ts')
        fs.writeFileSync(
          file,
          [
            '// url=https://example.com',
            "import figma from 'figma'",
            "const v = figma.selectedInstance.getString('Label')",
            "const d = figma.selectedInstance.getBoolean('Disabled')",
            'export default figma.code`<Button label={${v}} disabled={${d}} />`',
          ].join('\n'),
          'utf8',
        )
        const result = await codeConnectCompiler.updateFile(file)
        expect(result.type).toBe('template-file')
        expect(result.changed).toBe(true)
        expect(await codeConnectCompiler.generateRuntimeShim()).toContain('Disabled')
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it('clears a previously-parsed file when the read fails (delete semantics) and removes it from getDiscoveredFiles', async () => {
      const root = setupProject({ 'Button.figma.ts': BUTTON_TEMPLATE })
      try {
        const codeConnectCompiler = createCompiler({ root })
        await codeConnectCompiler.build()
        expect(codeConnectCompiler.getDiscoveredFiles().map((f) => path.basename(f))).toEqual([
          'Button.figma.ts',
        ])
        const file = path.join(root, 'Button.figma.ts')
        fs.rmSync(file)
        const result = await codeConnectCompiler.updateFile(file)
        expect(result.type).toBe('template-file')
        expect(result.changed).toBe(true)
        expect(await codeConnectCompiler.generateRuntimeShim()).not.toContain(
          '"componentName":"Button"',
        )
        // updateFile must keep getDiscoveredFiles in sync — a deleted
        // file should disappear from the discovered set so adapters
        // (notably Webpack's afterCompile fileDependencies pass) don't
        // hold a watcher on a path that no longer exists.
        expect(codeConnectCompiler.getDiscoveredFiles()).toEqual([])
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it('returns changed=true when a brand-new template is parsed and adds it to getDiscoveredFiles', async () => {
      const root = setupProject({ 'Button.figma.ts': BUTTON_TEMPLATE })
      try {
        const codeConnectCompiler = createCompiler({ root })
        await codeConnectCompiler.build()
        const newFile = path.join(root, 'Card.figma.ts')
        fs.writeFileSync(newFile, CARD_TEMPLATE, 'utf8')
        const result = await codeConnectCompiler.updateFile(newFile)
        expect(result.type).toBe('template-file')
        expect(result.changed).toBe(true)
        expect(await codeConnectCompiler.generateRuntimeShim()).toContain('Card')
        // Newly-added template MUST appear in getDiscoveredFiles —
        // otherwise adapters that rely on it (Webpack afterCompile)
        // wouldn't register a watcher on the new file.
        expect(
          codeConnectCompiler
            .getDiscoveredFiles()
            .map((f) => path.basename(f))
            .sort(),
        ).toEqual(['Button.figma.ts', 'Card.figma.ts'])
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })
  })

  describe('generateRuntimeShim', () => {
    it('returns a valid empty no-op shim before the first build', async () => {
      // Vite's `load` hook may fire before `buildStart` in pathological
      // cases. Returning a valid (empty) shim is more correct than
      // returning `undefined` — `undefined` from `load` after `resolveId`
      // claimed the id tells Vite to try the next plugin / fall back to
      // disk, which would fail. The empty shim is a real importable IIFE
      // that installs `getComponentDescriptor` returning undefined for any
      // key.
      const codeConnectCompiler = createCompiler()
      const payload = await codeConnectCompiler.generateRuntimeShim()
      expect(typeof payload).toBe('string')
      expect(payload).toContain('getComponentDescriptor')
      expect(payload).not.toContain('"componentName"')
    })
  })

  describe('getRuntimeAlias', () => {
    const ALIAS_SPECIFIER = '@figma/code-connect/register'

    it('returns a record with exactly one entry, keyed by the runtime specifier', () => {
      const codeConnectCompiler = createCompiler({ root: '/abs/project' })
      const alias = codeConnectCompiler.getRuntimeAlias()
      expect(Object.keys(alias)).toEqual([ALIAS_SPECIFIER])
    })

    it('aliases to an absolute path under node_modules/.cache/figma-code-connect by default', () => {
      const codeConnectCompiler = createCompiler({ root: '/abs/project' })
      const target = codeConnectCompiler.getRuntimeAlias()[ALIAS_SPECIFIER]
      expect(path.isAbsolute(target)).toBe(true)
      expect(target).toMatch(/node_modules\/\.cache\/figma-code-connect\/runtime\.js$/)
      // Must be rooted at the configured root.
      expect(target.startsWith('/abs/project')).toBe(true)
    })

    it('honors the outFile option as an absolute override', () => {
      const codeConnectCompiler = createCompiler({
        root: '/abs/project',
        outFile: '/some/where/else.js',
      })
      expect(codeConnectCompiler.getRuntimeAlias()[ALIAS_SPECIFIER]).toBe('/some/where/else.js')
    })

    it('resolves a relative outFile against the project root', () => {
      const codeConnectCompiler = createCompiler({
        root: '/abs/project',
        outFile: 'build/runtime.js',
      })
      expect(codeConnectCompiler.getRuntimeAlias()[ALIAS_SPECIFIER]).toBe(
        '/abs/project/build/runtime.js',
      )
    })

    it('reflects setRoot if it was called later', () => {
      const codeConnectCompiler = createCompiler()
      codeConnectCompiler.setRoot('/late/root')
      expect(codeConnectCompiler.getRuntimeAlias()[ALIAS_SPECIFIER]).toMatch(
        /^\/late\/root\/node_modules\/\.cache\/figma-code-connect\/runtime\.js$/,
      )
    })

    it('defaults to process.cwd() when no root has been set', () => {
      const codeConnectCompiler = createCompiler()
      expect(codeConnectCompiler.getRuntimeAlias()[ALIAS_SPECIFIER]).toBe(
        path.resolve(process.cwd(), 'node_modules/.cache/figma-code-connect/runtime.js'),
      )
    })

    it('points to the same file that emitRuntimeModule writes to', async () => {
      const root = setupProject({ 'Button.figma.ts': BUTTON_TEMPLATE })
      try {
        const outFile = path.join(root, 'out.js')
        const codeConnectCompiler = createCompiler({ root, outFile })
        await codeConnectCompiler.build()
        await codeConnectCompiler.emitRuntimeModule()
        expect(codeConnectCompiler.getRuntimeAlias()[ALIAS_SPECIFIER]).toBe(outFile)
        expect(fs.existsSync(outFile)).toBe(true)
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it('returns a fresh object on each call (callers can safely mutate)', () => {
      const codeConnectCompiler = createCompiler({ root: '/abs/project' })
      const a = codeConnectCompiler.getRuntimeAlias()
      const b = codeConnectCompiler.getRuntimeAlias()
      expect(a).not.toBe(b)
      a[ALIAS_SPECIFIER] = '/mutated'
      expect(codeConnectCompiler.getRuntimeAlias()[ALIAS_SPECIFIER]).not.toBe('/mutated')
    })
  })

  describe('emitRuntimeModule', () => {
    it('writes the runtime module to disk at the path getRuntimeAlias points to', async () => {
      const root = setupProject({ 'Button.figma.ts': BUTTON_TEMPLATE })
      try {
        const outFile = path.join(root, 'out.js')
        const codeConnectCompiler = createCompiler({ root, outFile })
        await codeConnectCompiler.build()
        await codeConnectCompiler.emitRuntimeModule()
        expect(fs.existsSync(outFile)).toBe(true)
        expect(fs.readFileSync(outFile, 'utf8')).toContain('Button')
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it('is idempotent — a second emit with the same bytes leaves the file unchanged', async () => {
      const root = setupProject({ 'Button.figma.ts': BUTTON_TEMPLATE })
      try {
        const outFile = path.join(root, 'out.js')
        const codeConnectCompiler = createCompiler({ root, outFile })
        await codeConnectCompiler.build()
        await codeConnectCompiler.emitRuntimeModule()
        const mtimeBefore = fs.statSync(outFile).mtimeMs
        // Tiny pause so a re-write would produce a different mtime if it happened.
        await new Promise((r) => setTimeout(r, 10))
        await codeConnectCompiler.emitRuntimeModule()
        const mtimeAfter = fs.statSync(outFile).mtimeMs
        expect(mtimeAfter).toBe(mtimeBefore)
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

  })
})
