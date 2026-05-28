import { ComponentDescriptorStore } from '../template_files/component_descriptor_store'
import type { ComponentDescriptor } from '../types'

const ROOT = '/a'

const D = (componentName: string, filePath?: string): ComponentDescriptor => ({
  componentName,
  filePath,
  props: [{ name: 'size', label: 'Size', type: 'string' }],
})

describe('ComponentDescriptorStore', () => {
  it('adds, has, and snapshots descriptors as a flat array', () => {
    const m = new ComponentDescriptorStore()
    m.set('/a/Button.figma.ts', [D('Button', '/a/Button.tsx')])
    expect(m.has('/a/Button.figma.ts')).toBe(true)
    expect(m.size()).toBe(1)
    const snap = m.snapshot(ROOT)
    // snapshot() emits a flat ComponentDescriptor[] with project-relative
    // POSIX filePaths. The template path (the `byFile` map's key) is
    // intentionally NOT surfaced — the runtime shim looks up by component
    // source path, not template path.
    expect(snap).toHaveLength(1)
    expect(snap[0].componentName).toBe('Button')
    expect(snap[0].filePath).toBe('Button.tsx')
  })

  it('keeps filePath undefined when the parser could not resolve a source path', () => {
    const m = new ComponentDescriptorStore()
    // No filePath on the descriptor — simulates a template whose imports[]
    // and sibling probe both miss.
    m.set('/a/Button.figma.ts', [D('Button')])
    const snap = m.snapshot(ROOT)
    expect(snap).toHaveLength(1)
    expect(snap[0].componentName).toBe('Button')
    expect(snap[0].filePath).toBeUndefined()
  })

  it('snapshot emits POSIX-separated relative paths even when the absolute path uses platform separators', () => {
    const m = new ComponentDescriptorStore()
    m.set('/proj/src/Button.figma.ts', [D('Button', '/proj/src/Button.tsx')])
    const snap = m.snapshot('/proj')
    expect(snap).toEqual([
      expect.objectContaining({
        componentName: 'Button',
        filePath: 'src/Button.tsx',
      }),
    ])
  })

  it('replaces descriptors only when content changes', () => {
    const m = new ComponentDescriptorStore()
    m.set('/a/Button.figma.ts', [D('Button', '/a/Button.tsx')])
    expect(m.replace('/a/Button.figma.ts', [D('Button', '/a/Button.tsx')])).toBe(false)
    expect(m.replace('/a/Button.figma.ts', [D('Button2', '/a/Button.tsx')])).toBe(true)
  })

  it('replacing with an empty array removes the file entry', () => {
    const m = new ComponentDescriptorStore()
    m.set('/a/Button.figma.ts', [D('Button', '/a/Button.tsx')])
    expect(m.replace('/a/Button.figma.ts', [])).toBe(true)
    expect(m.has('/a/Button.figma.ts')).toBe(false)
  })

  it('delete is idempotent', () => {
    const m = new ComponentDescriptorStore()
    m.set('/a/Button.figma.ts', [D('Button')])
    m.delete('/a/Button.figma.ts')
    m.delete('/a/Button.figma.ts')
    expect(m.has('/a/Button.figma.ts')).toBe(false)
  })

  it('snapshot is stable across insertion order', () => {
    const a = new ComponentDescriptorStore()
    a.set('/a/Button.figma.ts', [D('Button')])
    a.set('/a/Card.figma.ts', [D('Card')])
    const b = new ComponentDescriptorStore()
    b.set('/a/Card.figma.ts', [D('Card')])
    b.set('/a/Button.figma.ts', [D('Button')])
    expect(JSON.stringify(a.snapshot(ROOT))).toBe(JSON.stringify(b.snapshot(ROOT)))
  })
})
