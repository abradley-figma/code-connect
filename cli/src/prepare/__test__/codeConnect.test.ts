/**
 * Unit tests for the headless `prepareCodeConnect` helper.
 *
 * Coverage focus:
 *  - Builds + emits the runtime to disk by default.
 *  - Returns a non-empty alias map pointing at the emitted file.
 *  - `enabled` resolution: default = `NODE_ENV !== 'production'`, plus
 *    explicit `true`/`false` overrides.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { prepareCodeConnect } from '..'

function setupProject(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'figma-prepare-test-'))
  for (const [rel, contents] of Object.entries(files)) {
    const full = path.join(root, rel)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, contents, 'utf8')
  }
  return root
}

async function withNodeEnv<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.NODE_ENV
  if (value === undefined) {
    delete process.env.NODE_ENV
  } else {
    process.env.NODE_ENV = value
  }
  try {
    return await fn()
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

describe('prepareCodeConnect()', () => {
  describe('default (enabled: undefined)', () => {
    it('emits the runtime file and returns a populated alias when NODE_ENV !== "production"', async () => {
      const root = setupProject({ 'Button.figma.ts': BUTTON_TEMPLATE })
      try {
        await withNodeEnv('development', async () => {
          const result = await prepareCodeConnect({ root })
          expect(result.templateFileCount).toBe(1)
          expect(result.warnings).toEqual([])
          expect(result.alias['@figma/code-connect/register']).toMatch(/runtime\.js$/)
          expect(result.filePath).toMatch(/runtime\.js$/)
          expect(fs.existsSync(result.filePath)).toBe(true)
          const contents = fs.readFileSync(result.filePath, 'utf8')
          expect(contents).toContain('Button')
          expect(contents).toContain('getComponentDescriptor')
        })
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })

    it('short-circuits when NODE_ENV === "production"', async () => {
      const root = setupProject({ 'Button.figma.ts': BUTTON_TEMPLATE })
      try {
        await withNodeEnv('production', async () => {
          const result = await prepareCodeConnect({ root })
          expect(result.templateFileCount).toBe(0)
          expect(result.alias).toEqual({})
          expect(fs.existsSync(result.filePath)).toBe(false)
        })
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })
  })

  describe('enabled: true (force on)', () => {
    it('overrides the production default and stays enabled in production', async () => {
      const root = setupProject({ 'Button.figma.ts': BUTTON_TEMPLATE })
      try {
        await withNodeEnv('production', async () => {
          const result = await prepareCodeConnect({ root, enabled: true })
          expect(result.templateFileCount).toBe(1)
          expect(result.alias['@figma/code-connect/register']).toMatch(/runtime\.js$/)
          expect(fs.existsSync(result.filePath)).toBe(true)
        })
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })
  })

  describe('enabled: false (force off — hard short-circuit)', () => {
    it('does not run the parser, does not emit, returns an empty alias map', async () => {
      const root = setupProject({ 'Button.figma.ts': BUTTON_TEMPLATE })
      try {
        const result = await prepareCodeConnect({ root, enabled: false })
        expect(result.templateFileCount).toBe(0)
        expect(result.warnings).toEqual([])
        expect(result.alias).toEqual({})
        // filePath is still surfaced so callers can build alias configs unconditionally,
        // but the file itself was never written.
        expect(result.filePath).toMatch(/runtime\.js$/)
        expect(fs.existsSync(result.filePath)).toBe(false)
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })
  })
})
