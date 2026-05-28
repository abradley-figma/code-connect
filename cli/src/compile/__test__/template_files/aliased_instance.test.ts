import { parseComponentDescriptorsFromSource } from '../../template_files/parse_template_file_source'

describe('aliased instance receivers', () => {
  it('handles `const inst = figma.selectedInstance`', () => {
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const inst = figma.selectedInstance
      const v = inst.getEnum('Size', { Sm: 'sm', Lg: 'lg' })
      export default figma.code\`<Button size={\${v}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, 'Button.figma.ts')
    expect(r.descriptors[0].props[0].name).toBe('size')
    expect(r.descriptors[0].props[0].type).toBe('enum')
  })

  it('handles figma.currentLayer alias', () => {
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const v = figma.currentLayer.getEnum('Size', { Sm: 'sm' })
      export default figma.code\`<Button size={\${v}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, 'Button.figma.ts')
    expect(r.descriptors[0].props[0].name).toBe('size')
  })

  it('handles multi-hop aliasing', () => {
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const a = figma.selectedInstance
      const b = a
      const v = b.getEnum('Size', { Sm: 'sm' })
      export default figma.code\`<Button size={\${v}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, 'Button.figma.ts')
    expect(r.descriptors[0].props[0].name).toBe('size')
  })
})
