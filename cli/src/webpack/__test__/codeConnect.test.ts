/**
 * Unit tests for the Webpack adapter. We drive `apply()` against a tiny
 * structural stand-in for webpack's `Compiler` so we never import webpack
 * itself.
 *
 * Coverage focus:
 *  - resolve.alias wiring
 *  - hook registration on beforeCompile / afterCompile / watchRun
 *  - `enabled` resolution (default = `mode !== 'production'`, plus
 *    explicit `true`/`false` overrides)
 *
 * The shared parser pipeline is exercised exhaustively elsewhere — we only
 * need to verify the adapter wires it up correctly.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { FigmaCodeConnectPlugin, figmaCodeConnect } from '..'

interface MockHookTap {
  name: string
  fn: (arg: unknown) => void | Promise<void>
}

class MockHook<TArg> {
  taps: MockHookTap[] = []
  tap(name: string | { name: string }, fn: (arg: TArg) => void) {
    this.taps.push({
      name: typeof name === 'string' ? name : name.name,
      fn: fn as MockHookTap['fn'],
    })
  }
  tapPromise(name: string | { name: string }, fn: (arg: TArg) => Promise<void>) {
    this.taps.push({
      name: typeof name === 'string' ? name : name.name,
      fn: fn as MockHookTap['fn'],
    })
  }
}

interface MockCompiler {
  context: string
  options: {
    context?: string
    mode?: 'development' | 'production' | 'none'
    resolve?: { alias?: Record<string, string | string[] | false> }
  }
  hooks: {
    beforeCompile: MockHook<unknown>
    afterCompile: MockHook<unknown>
    watchRun?: MockHook<unknown>
  }
}

function freshCompiler(
  overrides: Partial<MockCompiler> & { mode?: 'development' | 'production' | 'none' } = {},
): MockCompiler {
  return {
    context: overrides.context ?? '/tmp/proj',
    options: {
      mode: overrides.mode,
      resolve: { alias: {} },
      ...overrides.options,
    },
    hooks: {
      beforeCompile: new MockHook(),
      afterCompile: new MockHook(),
      watchRun: new MockHook(),
    },
  }
}

function setupProject(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'figma-webpack-test-'))
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, contents, 'utf8')
  }
  return root
}

describe('webpack figmaCodeConnect()', () => {
  it('returns a FigmaCodeConnectPlugin instance with an apply() method', () => {
    const plugin = figmaCodeConnect()
    expect(plugin).toBeInstanceOf(FigmaCodeConnectPlugin)
    expect(typeof plugin.apply).toBe('function')
  })

  describe('resolve.alias', () => {
    it('aliases @figma/code-connect/register to the emitted file path', () => {
      const root = setupProject({})
      try {
        const compiler = freshCompiler({ context: root, mode: 'development' })
        figmaCodeConnect().apply(compiler as never)
        const aliased = compiler.options.resolve!.alias!['@figma/code-connect/register']
        expect(typeof aliased).toBe('string')
        expect(aliased).toMatch(/node_modules\/\.cache\/figma-code-connect\/runtime\.js$/)
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it('preserves any pre-existing resolve.alias entries', () => {
      const compiler = freshCompiler({ context: '/tmp/proj', mode: 'development' })
      compiler.options.resolve!.alias = { '@/components': '/abs/path' }
      figmaCodeConnect().apply(compiler as never)
      expect(compiler.options.resolve!.alias!['@/components']).toBe('/abs/path')
      expect(compiler.options.resolve!.alias!['@figma/code-connect/register']).toBeDefined()
    })
  })

  describe('enabled resolution', () => {
    describe('enabled: undefined (default — gate on mode)', () => {
      it('is enabled when mode === "development"', () => {
        const compiler = freshCompiler({ context: '/tmp/proj', mode: 'development' })
        figmaCodeConnect().apply(compiler as never)
        expect(compiler.options.resolve!.alias!['@figma/code-connect/register']).toBeDefined()
        expect(compiler.hooks.beforeCompile.taps).toHaveLength(1)
      })

      it('is disabled when mode === "production"', () => {
        const compiler = freshCompiler({ context: '/tmp/proj', mode: 'production' })
        compiler.options.resolve!.alias = { '@user/lib': '/u/abs' }
        figmaCodeConnect().apply(compiler as never)
        // Alias map left untouched, no hooks registered.
        expect(compiler.options.resolve!.alias).toEqual({ '@user/lib': '/u/abs' })
        expect(compiler.hooks.beforeCompile.taps).toHaveLength(0)
        expect(compiler.hooks.afterCompile.taps).toHaveLength(0)
        expect(compiler.hooks.watchRun!.taps).toHaveLength(0)
      })

      it('is enabled when mode === "none" (treat as dev)', () => {
        const compiler = freshCompiler({ context: '/tmp/proj', mode: 'none' })
        figmaCodeConnect().apply(compiler as never)
        expect(compiler.options.resolve!.alias!['@figma/code-connect/register']).toBeDefined()
      })

      it('is enabled when mode is unset (treat as dev)', () => {
        const compiler = freshCompiler({ context: '/tmp/proj' })
        figmaCodeConnect().apply(compiler as never)
        expect(compiler.options.resolve!.alias!['@figma/code-connect/register']).toBeDefined()
      })
    })

    describe('enabled: true (force on)', () => {
      it('overrides the production default and stays enabled in production', () => {
        const compiler = freshCompiler({ context: '/tmp/proj', mode: 'production' })
        figmaCodeConnect({ enabled: true }).apply(compiler as never)
        expect(compiler.options.resolve!.alias!['@figma/code-connect/register']).toBeDefined()
        expect(compiler.hooks.beforeCompile.taps).toHaveLength(1)
      })
    })

    describe('enabled: false (force off — hard short-circuit)', () => {
      it('does not touch resolve.alias even in development', () => {
        const compiler = freshCompiler({ context: '/tmp/proj', mode: 'development' })
        compiler.options.resolve!.alias = { '@user/lib': '/u/abs' }
        figmaCodeConnect({ enabled: false }).apply(compiler as never)
        expect(compiler.options.resolve!.alias).toEqual({ '@user/lib': '/u/abs' })
      })

      it('does not register any hooks', () => {
        const compiler = freshCompiler({ context: '/tmp/proj', mode: 'development' })
        figmaCodeConnect({ enabled: false }).apply(compiler as never)
        expect(compiler.hooks.beforeCompile.taps).toHaveLength(0)
        expect(compiler.hooks.afterCompile.taps).toHaveLength(0)
        expect(compiler.hooks.watchRun!.taps).toHaveLength(0)
      })

      it('does not emit the runtime file', async () => {
        const root = setupProject({
          'Button.figma.ts': [
            "import figma from 'figma'",
            'export default figma.code`<Button />`',
          ].join('\n'),
        })
        try {
          const compiler = freshCompiler({ context: root, mode: 'development' })
          figmaCodeConnect({ enabled: false }).apply(compiler as never)
          // Even firing the entire hook pipeline does nothing — no taps registered.
          for (const tap of compiler.hooks.beforeCompile.taps) await tap.fn(undefined)
          const emitted = path.join(root, 'node_modules/.cache/figma-code-connect/runtime.js')
          expect(fs.existsSync(emitted)).toBe(false)
        } finally {
          fs.rmSync(root, { recursive: true, force: true })
        }
      })
    })
  })

  describe('hook registration', () => {
    it('taps beforeCompile, afterCompile, and watchRun', () => {
      const compiler = freshCompiler({ context: '/tmp/proj', mode: 'development' })
      figmaCodeConnect().apply(compiler as never)
      expect(compiler.hooks.beforeCompile.taps.map((t) => t.name)).toContain('figma-code-connect')
      expect(compiler.hooks.afterCompile.taps.map((t) => t.name)).toContain('figma-code-connect')
      expect(compiler.hooks.watchRun!.taps.map((t) => t.name)).toContain('figma-code-connect')
    })

    it('beforeCompile runs build() + emitRuntimeModule() — emits the runtime file to disk', async () => {
      const root = setupProject({
        'Button.figma.ts': [
          "import figma from 'figma'",
          "const v = figma.selectedInstance.getString('Label')",
          'export default figma.code`<Button label={${v}} />`',
        ].join('\n'),
      })
      try {
        const compiler = freshCompiler({ context: root, mode: 'development' })
        figmaCodeConnect().apply(compiler as never)
        const beforeTap = compiler.hooks.beforeCompile.taps.find((t) => t.name === 'figma-code-connect')!
        await beforeTap.fn(undefined)
        const emitted = path.join(root, 'node_modules/.cache/figma-code-connect/runtime.js')
        expect(fs.existsSync(emitted)).toBe(true)
        const contents = fs.readFileSync(emitted, 'utf8')
        expect(contents).toContain('Button')
        expect(contents).toContain('getComponentDescriptor')
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it('afterCompile registers every discovered template as a file dependency', async () => {
      const root = setupProject({
        'A.figma.ts': "import figma from 'figma'\nexport default figma.code`<A />`",
        'B.figma.ts': "import figma from 'figma'\nexport default figma.code`<B />`",
      })
      try {
        const compiler = freshCompiler({ context: root, mode: 'development' })
        figmaCodeConnect().apply(compiler as never)
        const beforeTap = compiler.hooks.beforeCompile.taps.find((t) => t.name === 'figma-code-connect')!
        await beforeTap.fn(undefined)

        const added: string[] = []
        const compilation = { fileDependencies: { add: (f: string) => added.push(f) } }
        const afterTap = compiler.hooks.afterCompile.taps.find((t) => t.name === 'figma-code-connect')!
        afterTap.fn(compilation)

        expect(added).toHaveLength(2)
        expect(added.some((f) => f.endsWith('A.figma.ts'))).toBe(true)
        expect(added.some((f) => f.endsWith('B.figma.ts'))).toBe(true)
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })
  })
})
