/**
 * Unit tests for the Vite adapter. We drive the plugin's lifecycle methods
 * directly (`configResolved` -> `buildStart` -> `resolveId` / `load` /
 * `handleHotUpdate`) against fixtures written to a tmpdir.
 *
 * Vite is NOT imported — we satisfy the plugin's local structural shape with
 * tiny stand-ins for `ResolvedConfig`, `ViteDevServer`, and `HmrContext`.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { figmaCodeConnect } from '..'

const VIRTUAL_MODULE_ID = 'virtual:@figma/code-connect/register'
const RESOLVED_ID = '\u0000' + VIRTUAL_MODULE_ID

// Minimal stand-ins for the Vite types the plugin reads.
interface MockContext {
  warn(msg: string): void
}

interface MockModuleNode {
  id: string
}

interface MockHmrCtx {
  file: string
  server: { moduleGraph: { getModuleById(id: string): MockModuleNode | null } }
}

interface PluginShape {
  name: string
  configResolved?(config: { root: string; command?: 'serve' | 'build' }): void
  buildStart?(this: MockContext): Promise<void>
  resolveId?(id: string): string | undefined
  load?(id: string): Promise<string | undefined>
  handleHotUpdate?(ctx: MockHmrCtx): Promise<MockModuleNode[] | undefined> | undefined
}

function setupProject(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'figma-vite-test-'))
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, contents, 'utf8')
  }
  return root
}

function makeHmrCtx(file: string): MockHmrCtx {
  return {
    file,
    server: {
      moduleGraph: {
        getModuleById: (id) => (id === RESOLVED_ID ? { id } : null),
      },
    },
  }
}

const BUTTON_TEMPLATE = [
  '// url=https://example.com',
  "import figma from 'figma'",
  "const v = figma.selectedInstance.getString('Label')",
  'export default figma.code`<Button label={${v}} />`',
].join('\n')

const BUTTON_TEMPLATE_EDITED = [
  '// url=https://example.com',
  "import figma from 'figma'",
  "const v = figma.selectedInstance.getString('Label')",
  "const d = figma.selectedInstance.getBoolean('Disabled')",
  'export default figma.code`<Button label={${v}} disabled={${d}} />`',
].join('\n')

describe('vite figmaCodeConnect()', () => {
  describe('plugin shape', () => {
    it('returns a plugin with the documented name + hooks', () => {
      const plugin = figmaCodeConnect() as PluginShape
      expect(plugin.name).toBe('vite-plugin-figma-code-connect')
      expect(typeof plugin.configResolved).toBe('function')
      expect(typeof plugin.buildStart).toBe('function')
      expect(typeof plugin.resolveId).toBe('function')
      expect(typeof plugin.load).toBe('function')
      expect(typeof plugin.handleHotUpdate).toBe('function')
    })

    it('does not auto-inject — there is no transformIndexHtml hook', () => {
      const plugin = figmaCodeConnect() as PluginShape & { transformIndexHtml?: unknown }
      expect(plugin.transformIndexHtml).toBeUndefined()
    })
  })

  describe('enabled resolution', () => {
    describe('enabled: undefined (default — gate on command)', () => {
      it('is enabled in vite serve (command !== "build")', async () => {
        const plugin = figmaCodeConnect({ root: '/tmp/does-not-exist' }) as PluginShape
        plugin.configResolved!({ root: '/tmp/does-not-exist', command: 'serve' })
        // resolveId only returns the resolved id when enabled; this fires
        // after configResolved settled the dev gate.
        expect(plugin.resolveId!(VIRTUAL_MODULE_ID)).toBe(RESOLVED_ID)
      })

      it('is disabled in vite build (command === "build")', async () => {
        const plugin = figmaCodeConnect({ root: '/tmp/does-not-exist' }) as PluginShape
        plugin.configResolved!({ root: '/tmp/does-not-exist', command: 'build' })
        expect(plugin.resolveId!(VIRTUAL_MODULE_ID)).toBeUndefined()
        expect(plugin.resolveId!('@figma/code-connect/register')).toBeUndefined()
        expect(await plugin.load!(RESOLVED_ID)).toBeUndefined()
      })

      it('is enabled when command is unset (treats anything not "build" as dev)', () => {
        const plugin = figmaCodeConnect({ root: '/tmp/does-not-exist' }) as PluginShape
        plugin.configResolved!({ root: '/tmp/does-not-exist' })
        expect(plugin.resolveId!(VIRTUAL_MODULE_ID)).toBe(RESOLVED_ID)
      })
    })

    describe('enabled: true (force on)', () => {
      it('overrides the build-command default and stays enabled in vite build', () => {
        const plugin = figmaCodeConnect({
          enabled: true,
          root: '/tmp/does-not-exist',
        }) as PluginShape
        plugin.configResolved!({ root: '/tmp/does-not-exist', command: 'build' })
        expect(plugin.resolveId!(VIRTUAL_MODULE_ID)).toBe(RESOLVED_ID)
      })
    })

    describe('enabled: false (force off — hard short-circuit)', () => {
      it('returns a plugin with the documented name but NO hooks', () => {
        const plugin = figmaCodeConnect({ enabled: false }) as PluginShape
        expect(plugin.name).toBe('vite-plugin-figma-code-connect')
        expect(plugin.configResolved).toBeUndefined()
        expect(plugin.buildStart).toBeUndefined()
        expect(plugin.resolveId).toBeUndefined()
        expect(plugin.load).toBeUndefined()
        expect(plugin.handleHotUpdate).toBeUndefined()
      })

      it('does not run the parser or touch the disk', () => {
        const root = setupProject({ 'Button.figma.ts': BUTTON_TEMPLATE })
        try {
          figmaCodeConnect({ enabled: false, root })
          expect(
            fs.existsSync(path.join(root, 'node_modules/.cache/figma-code-connect/runtime.js')),
          ).toBe(false)
        } finally {
          fs.rmSync(root, { recursive: true, force: true })
        }
      })
    })
  })

  describe('resolveId', () => {
    it('resolves the virtual module id', () => {
      const plugin = figmaCodeConnect() as PluginShape
      expect(plugin.resolveId!(VIRTUAL_MODULE_ID)).toBe(RESOLVED_ID)
    })

    it('resolves the public subpath @figma/code-connect/register', () => {
      // The user's manual `import '@figma/code-connect/register'` routes
      // through this hook to the populated virtual module.
      const plugin = figmaCodeConnect() as PluginShape
      expect(plugin.resolveId!('@figma/code-connect/register')).toBe(RESOLVED_ID)
    })

    it('returns undefined for unrelated ids', () => {
      const plugin = figmaCodeConnect() as PluginShape
      expect(plugin.resolveId!('react')).toBeUndefined()
      expect(plugin.resolveId!('./some-component')).toBeUndefined()
    })
  })

  describe('HMR self-acceptance in served payload', () => {
    it('load prefixes the IIFE with import.meta.hot.accept() so changes hot-replace instead of full-reloading', async () => {
      const plugin = figmaCodeConnect({ root: '/tmp/does-not-exist' }) as PluginShape
      const payload = await plugin.load!(RESOLVED_ID)
      expect(typeof payload).toBe('string')
      expect(payload!.startsWith('if (import.meta.hot)')).toBe(true)
      expect(payload).toContain('import.meta.hot.accept()')
    })
  })

  describe('buildStart + load', () => {
    it('populates the map and load serves a runtime payload containing the component', async () => {
      const root = setupProject({ 'Button.figma.ts': BUTTON_TEMPLATE })
      try {
        const plugin = figmaCodeConnect({ root }) as PluginShape
        plugin.configResolved!({ root, command: 'serve' })
        const warnings: string[] = []
        await plugin.buildStart!.call({ warn: (w: string) => warnings.push(w) })
        const payload = await plugin.load!(RESOLVED_ID)
        expect(typeof payload).toBe('string')
        expect(payload).toContain('Button')
        expect(payload).toContain('getComponentDescriptor')
        expect(warnings).toEqual([])
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it('load returns undefined for unrelated ids', async () => {
      const root = setupProject({ 'Button.figma.ts': BUTTON_TEMPLATE })
      try {
        const plugin = figmaCodeConnect({ root }) as PluginShape
        plugin.configResolved!({ root, command: 'serve' })
        await plugin.buildStart!.call({ warn: () => { } })
        expect(await plugin.load!('react')).toBeUndefined()
        expect(await plugin.load!('\u0000other-virtual')).toBeUndefined()
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it('buildStart is a no-op when configResolved settled to disabled', async () => {
      const root = setupProject({ 'Button.figma.ts': BUTTON_TEMPLATE })
      try {
        const plugin = figmaCodeConnect({ root }) as PluginShape
        plugin.configResolved!({ root, command: 'build' })
        const warnings: string[] = []
        await plugin.buildStart!.call({ warn: (w: string) => warnings.push(w) })
        // Nothing emitted, nothing parsed, no warnings raised.
        expect(warnings).toEqual([])
        expect(
          fs.existsSync(path.join(root, 'node_modules/.cache/figma-code-connect/runtime.js')),
        ).toBe(false)
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it('load serves a valid empty no-op shim before configResolved has run (defensive default)', async () => {
      // In practice Vite always fires configResolved first, but if load
      // races configResolved we serve the populated (but empty) shim
      // instead of swallowing the request — the alternative would
      // silently break dev tooling on weird edge cases.
      const plugin = figmaCodeConnect({ root: '/tmp/does-not-exist' }) as PluginShape
      const payload = await plugin.load!(RESOLVED_ID)
      expect(typeof payload).toBe('string')
      expect(payload).toContain('getComponentDescriptor')
      expect(payload).not.toContain('"componentName"')
    })
  })

  describe('handleHotUpdate', () => {
    it('returns undefined for files outside the template glob', async () => {
      const root = setupProject({ 'Button.figma.ts': BUTTON_TEMPLATE })
      try {
        const plugin = figmaCodeConnect({ root }) as PluginShape
        plugin.configResolved!({ root, command: 'serve' })
        await plugin.buildStart!.call({ warn: () => { } })
        const out = await plugin.handleHotUpdate!(
          makeHmrCtx(path.join(root, 'src/Component.tsx')),
        )
        expect(out).toBeUndefined()
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it('returns undefined when the template is re-saved with identical content (no-op)', async () => {
      const root = setupProject({ 'Button.figma.ts': BUTTON_TEMPLATE })
      try {
        const plugin = figmaCodeConnect({ root }) as PluginShape
        plugin.configResolved!({ root, command: 'serve' })
        await plugin.buildStart!.call({ warn: () => { } })
        // simulate "save with no changes" — file content on disk is unchanged
        const out = await plugin.handleHotUpdate!(
          makeHmrCtx(path.join(root, 'Button.figma.ts')),
        )
        expect(out).toBeUndefined()
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it('invalidates the virtual module when a template gains a prop', async () => {
      const root = setupProject({ 'Button.figma.ts': BUTTON_TEMPLATE })
      try {
        const plugin = figmaCodeConnect({ root }) as PluginShape
        plugin.configResolved!({ root, command: 'serve' })
        await plugin.buildStart!.call({ warn: () => { } })

        // edit the file on disk — added Disabled prop
        const file = path.join(root, 'Button.figma.ts')
        fs.writeFileSync(file, BUTTON_TEMPLATE_EDITED, 'utf8')

        const out = await plugin.handleHotUpdate!(makeHmrCtx(file))
        expect(out).toEqual([{ id: RESOLVED_ID }])

        // confirm the load payload reflects the new prop
        expect(await plugin.load!(RESOLVED_ID)).toContain('Disabled')
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it('invalidates the virtual module when a template is deleted', async () => {
      const root = setupProject({ 'Button.figma.ts': BUTTON_TEMPLATE })
      try {
        const plugin = figmaCodeConnect({ root }) as PluginShape
        plugin.configResolved!({ root, command: 'serve' })
        await plugin.buildStart!.call({ warn: () => { } })

        const file = path.join(root, 'Button.figma.ts')
        fs.rmSync(file)

        const out = await plugin.handleHotUpdate!(makeHmrCtx(file))
        expect(out).toEqual([{ id: RESOLVED_ID }])

        // Button is gone from the payload
        const payload = (await plugin.load!(RESOLVED_ID))!
        expect(payload).not.toContain('"componentName":"Button"')
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it('returns undefined when handleHotUpdate fires before buildStart', async () => {
      // Defensive: real Vite never does this, but we shouldn't blow up.
      const plugin = figmaCodeConnect({ root: '/tmp/does-not-exist' }) as PluginShape
      const out = await plugin.handleHotUpdate!(
        makeHmrCtx('/tmp/does-not-exist/Button.figma.ts'),
      )
      expect(out).toBeUndefined()
    })

    it('discovers a new template added after buildStart (file create + HMR ping)', async () => {
      const root = setupProject({ 'Button.figma.ts': BUTTON_TEMPLATE })
      try {
        const plugin = figmaCodeConnect({ root }) as PluginShape
        plugin.configResolved!({ root, command: 'serve' })
        await plugin.buildStart!.call({ warn: () => { } })

        // create a brand new template after buildStart finished
        const newFile = path.join(root, 'Card.figma.ts')
        fs.writeFileSync(
          newFile,
          [
            '// url=https://example.com',
            "import figma from 'figma'",
            "const t = figma.selectedInstance.getString('Title')",
            'export default figma.code`<Card title={${t}} />`',
          ].join('\n'),
          'utf8',
        )

        const out = await plugin.handleHotUpdate!(makeHmrCtx(newFile))
        expect(out).toEqual([{ id: RESOLVED_ID }])
        expect(await plugin.load!(RESOLVED_ID)).toContain('Card')
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })
  })
})
