/**
 * Unit tests for the esbuild adapter. We don't import esbuild — instead we
 * drive `setup()` against a tiny mock `PluginBuild` and assert the resulting
 * `initialOptions` + the on-disk emitted file.
 *
 * Coverage focus:
 *  - `alias` is populated by default and skipped when (resolved) disabled.
 *  - `onStart` writes the runtime file under `node_modules/.cache/figma-code-connect/`.
 *  - Rediscovery on subsequent `onStart` calls picks up new templates.
 *  - `enabled` resolution: default = `NODE_ENV !== 'production'`, plus
 *    explicit `true`/`false` overrides.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { figmaCodeConnect } from '..'

interface MockBuild {
  initialOptions: {
    absWorkingDir?: string
    alias?: Record<string, string>
    inject?: string[]
  }
  onStart(cb: () => Promise<void> | void): void
  // Test-only: invoke the registered onStart callbacks in order.
  __runStart(): Promise<void>
}

function freshBuild(
  absWorkingDir: string,
  prior: { alias?: Record<string, string>; inject?: string[] } = {},
): MockBuild {
  const startCbs: (() => Promise<void> | void)[] = []
  return {
    initialOptions: {
      absWorkingDir,
      alias: prior.alias ? { ...prior.alias } : undefined,
      inject: prior.inject ? [...prior.inject] : undefined,
    },
    onStart(cb) {
      startCbs.push(cb)
    },
    async __runStart() {
      for (const cb of startCbs) await cb()
    },
  }
}

function setupProject(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'figma-esbuild-test-'))
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, contents, 'utf8')
  }
  return root
}

function withNodeEnv<T>(value: string | undefined, fn: () => T): T {
  const previous = process.env.NODE_ENV
  if (value === undefined) {
    delete process.env.NODE_ENV
  } else {
    process.env.NODE_ENV = value
  }
  try {
    return fn()
  } finally {
    if (previous === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = previous
    }
  }
}

const BUTTON_TEMPLATE = [
  "import figma from 'figma'",
  "const v = figma.selectedInstance.getString('Label')",
  'export default figma.code`<Button label={${v}} />`',
].join('\n')

describe('esbuild figmaCodeConnect()', () => {
  it('returns a plugin with the documented name and setup hook', () => {
    const plugin = figmaCodeConnect()
    expect(plugin.name).toBe('esbuild-plugin-figma-code-connect')
    expect(typeof plugin.setup).toBe('function')
  })

  describe('alias (initialOptions.alias)', () => {
    it('aliases @figma/code-connect/register to the emitted runtime by default', () => {
      const root = setupProject({})
      try {
        const build = freshBuild(root)
        figmaCodeConnect().setup(build)
        expect(build.initialOptions.alias).toBeDefined()
        const aliased = build.initialOptions.alias!['@figma/code-connect/register']
        expect(typeof aliased).toBe('string')
        expect(aliased).toMatch(/node_modules\/\.cache\/figma-code-connect\/runtime\.js$/)
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it('preserves any pre-existing alias entries (co-existence with other plugins)', () => {
      const root = setupProject({})
      try {
        const build = freshBuild(root, { alias: { '@user/lib': '/u/abs' } })
        figmaCodeConnect().setup(build)
        expect(build.initialOptions.alias!['@user/lib']).toBe('/u/abs')
        expect(build.initialOptions.alias!['@figma/code-connect/register']).toBeDefined()
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it('does NOT touch initialOptions.inject (no auto-inject)', () => {
      const root = setupProject({})
      try {
        const build = freshBuild(root)
        figmaCodeConnect().setup(build)
        expect(build.initialOptions.inject).toBeUndefined()
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })
  })

  describe('enabled resolution', () => {
    describe('enabled: undefined (default — gate on NODE_ENV)', () => {
      it('is enabled when NODE_ENV !== "production"', () => {
        const root = setupProject({})
        try {
          withNodeEnv('development', () => {
            const build = freshBuild(root)
            figmaCodeConnect().setup(build)
            expect(build.initialOptions.alias!['@figma/code-connect/register']).toBeDefined()
          })
        } finally {
          fs.rmSync(root, { recursive: true, force: true })
        }
      })

      it('is disabled when NODE_ENV === "production"', () => {
        const root = setupProject({ 'Button.figma.ts': BUTTON_TEMPLATE })
        try {
          withNodeEnv('production', () => {
            const build = freshBuild(root, { alias: { '@user/lib': '/u/abs' } })
            figmaCodeConnect().setup(build)
            expect(build.initialOptions.alias).toEqual({ '@user/lib': '/u/abs' })
          })
        } finally {
          fs.rmSync(root, { recursive: true, force: true })
        }
      })
    })

    describe('enabled: true (force on)', () => {
      it('overrides the production default and stays enabled in production', () => {
        const root = setupProject({})
        try {
          withNodeEnv('production', () => {
            const build = freshBuild(root)
            figmaCodeConnect({ enabled: true }).setup(build)
            expect(build.initialOptions.alias!['@figma/code-connect/register']).toBeDefined()
          })
        } finally {
          fs.rmSync(root, { recursive: true, force: true })
        }
      })
    })

    describe('enabled: false (force off — hard short-circuit)', () => {
      it('does not modify initialOptions.alias or initialOptions.inject', () => {
        const root = setupProject({})
        try {
          const build = freshBuild(root)
          figmaCodeConnect({ enabled: false }).setup(build)
          expect(build.initialOptions.alias).toBeUndefined()
          expect(build.initialOptions.inject).toBeUndefined()
        } finally {
          fs.rmSync(root, { recursive: true, force: true })
        }
      })

      it('preserves pre-existing alias entries unchanged', () => {
        const root = setupProject({})
        try {
          const build = freshBuild(root, { alias: { '@user/lib': '/u/abs' } })
          figmaCodeConnect({ enabled: false }).setup(build)
          expect(build.initialOptions.alias).toEqual({ '@user/lib': '/u/abs' })
        } finally {
          fs.rmSync(root, { recursive: true, force: true })
        }
      })

      it('does not register an onStart callback (no parser, no emit)', async () => {
        const root = setupProject({ 'Button.figma.ts': BUTTON_TEMPLATE })
        try {
          const build = freshBuild(root)
          figmaCodeConnect({ enabled: false }).setup(build)
          await build.__runStart()
          const emitted = path.join(root, 'node_modules/.cache/figma-code-connect/runtime.js')
          expect(fs.existsSync(emitted)).toBe(false)
        } finally {
          fs.rmSync(root, { recursive: true, force: true })
        }
      })
    })
  })

  describe('onStart (build + emit)', () => {
    it('writes the runtime file under node_modules/.cache/figma-code-connect/ on every start', async () => {
      const root = setupProject({ 'Button.figma.ts': BUTTON_TEMPLATE })
      try {
        const build = freshBuild(root)
        figmaCodeConnect().setup(build)
        await build.__runStart()
        const emitted = path.join(root, 'node_modules/.cache/figma-code-connect/runtime.js')
        expect(fs.existsSync(emitted)).toBe(true)
        const contents = fs.readFileSync(emitted, 'utf8')
        expect(contents).toContain('Button')
        expect(contents).toContain('getComponentDescriptor')
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it('rediscovers newly-added templates on subsequent --watch rebuilds', async () => {
      const root = setupProject({ 'Button.figma.ts': BUTTON_TEMPLATE })
      try {
        const build = freshBuild(root)
        figmaCodeConnect().setup(build)
        await build.__runStart()

        // Add a brand new template between rebuilds.
        fs.writeFileSync(
          path.join(root, 'Card.figma.ts'),
          [
            "import figma from 'figma'",
            "const t = figma.selectedInstance.getString('Title')",
            'export default figma.code`<Card title={${t}} />`',
          ].join('\n'),
          'utf8',
        )

        await build.__runStart()
        const emitted = path.join(root, 'node_modules/.cache/figma-code-connect/runtime.js')
        const contents = fs.readFileSync(emitted, 'utf8')
        expect(contents).toContain('Card')
        expect(contents).toContain('Button')
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })
  })

  describe('root resolution', () => {
    it('uses opts.root when supplied', () => {
      const explicit = setupProject({})
      try {
        const build = freshBuild('/elsewhere')
        figmaCodeConnect({ root: explicit }).setup(build)
        const aliased = build.initialOptions.alias!['@figma/code-connect/register']
        expect(aliased).toContain(explicit)
      } finally {
        fs.rmSync(explicit, { recursive: true, force: true })
      }
    })

    it('falls back to initialOptions.absWorkingDir', () => {
      const root = setupProject({})
      try {
        const build = freshBuild(root)
        figmaCodeConnect().setup(build)
        const aliased = build.initialOptions.alias!['@figma/code-connect/register']
        expect(aliased).toContain(root)
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })
  })
})
