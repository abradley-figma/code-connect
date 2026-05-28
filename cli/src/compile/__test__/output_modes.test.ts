/**
 * Both output modes (virtual module + emitted file) MUST produce
 * byte-identical content so the runtime contract is identical regardless of
 * which bundler the user picked.
 *
 * `generateRuntimeShim(manifest)` is the single source of truth for the
 * bytes — virtual-module mode (Vite's `load` hook) returns it directly,
 * emitted-file mode (`emitRuntimeModule`) writes it to disk. These tests
 * lock in that equivalence + the idempotency of `emitRuntimeModule`.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { ComponentDescriptorStore } from '../template_files/component_descriptor_store'
import {
  emitRuntimeModule,
  generateManifest,
  generateRuntimeShim,
  resolveRuntimeFilePath,
} from '../runtime'

function fillMap() {
  const m = new ComponentDescriptorStore()
  m.set('/proj/Button.figma.ts', [
    {
      componentName: 'Button',
      filePath: '/proj/Button.tsx',
      props: [
        { name: 'size', label: 'Size', type: 'string' },
        {
          name: 'variant',
          label: 'Variant',
          type: 'enum',
          options: [
            { value: 'primary', label: 'Primary' },
            { value: 'danger', label: 'Danger' },
          ],
        },
      ],
    },
  ])
  return m
}

// All fixtures are rooted at `/proj`; the snapshot's project-relative
// rewrite produces deterministic keys regardless of where this test runs.
const ROOT = '/proj'

async function manifestFor(m: ComponentDescriptorStore) {
  return generateManifest(m.snapshot(ROOT))
}

describe('dual output modes', () => {
  it('virtual-module content equals emitted-file content (byte-identical)', async () => {
    const map = fillMap()
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'figma-code-connect-'))
    try {
      const outFile = path.join(tmp, 'runtime.js')
      const wrote = await emitRuntimeModule(outFile, await manifestFor(map))
      expect(wrote).toBe(true)
      const written = fs.readFileSync(outFile, 'utf8')
      expect(generateRuntimeShim(await manifestFor(map))).toBe(written)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('emit is idempotent when content matches', async () => {
    const map = fillMap()
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'figma-code-connect-'))
    try {
      const outFile = path.join(tmp, 'runtime.js')
      const wrote1 = await emitRuntimeModule(outFile, await manifestFor(map))
      const wrote2 = await emitRuntimeModule(outFile, await manifestFor(map))
      expect(wrote1).toBe(true)
      expect(wrote2).toBe(false)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('emit rewrites when content changes', async () => {
    const map = fillMap()
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'figma-code-connect-'))
    try {
      const outFile = path.join(tmp, 'runtime.js')
      await emitRuntimeModule(outFile, await manifestFor(map))
      map.set('/proj/Card.figma.ts', [
        {
          componentName: 'Card',
          filePath: '/proj/Card.tsx',
          props: [{ name: 'title', label: 'Title', type: 'string' }],
        },
      ])
      const wrote = await emitRuntimeModule(outFile, await manifestFor(map))
      expect(wrote).toBe(true)
      const written = fs.readFileSync(outFile, 'utf8')
      expect(written).toContain('Card')
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it('resolveRuntimeFilePath respects override', () => {
    expect(resolveRuntimeFilePath('/r', '/abs/x.js')).toBe('/abs/x.js')
    expect(resolveRuntimeFilePath('/r')).toMatch(/node_modules\/\.cache\/figma-code-connect\/runtime\.js$/)
  })

  it('generateRuntimeShim does not corrupt JSON containing $-replace patterns', async () => {
    // String.prototype.replace(needle, replString) treats `$&`, `$1`, `$$` etc.
    // specially in `replString`. Component labels like "Price (US$&UK)" must
    // survive round-tripping unchanged.
    const m = new ComponentDescriptorStore()
    m.set('/proj/Money.figma.ts', [
      {
        componentName: 'Money$Amount',
        filePath: '/proj/Money.tsx',
        props: [
          {
            name: '$amount',
            label: 'Price (US$&UK)',
            type: 'string',
          },
        ],
      },
    ])
    const out = generateRuntimeShim(await manifestFor(m))
    expect(out).toContain('Money$Amount')
    expect(out).toContain('Price (US$&UK)')
    expect(out).toContain('$amount')
    expect(out).not.toContain('{/*__MANIFEST__*/}')
  })
})
