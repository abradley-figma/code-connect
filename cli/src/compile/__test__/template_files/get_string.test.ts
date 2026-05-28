import { parseComponentDescriptorsFromSource } from '../../template_files/parse_template_file_source'

describe('getString -> string descriptor', () => {
  it('produces a string descriptor from getString', () => {
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const size = figma.selectedInstance.getString('Size')
      export default figma.code\`<Button size={\${size}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, 'Button.figma.ts')
    expect(r.descriptors).toHaveLength(1)
    const d = r.descriptors[0]
    expect(d.componentName).toBe('Button')
    expect(d.props).toEqual([
      // `name` is the JSX attribute (`size`) recovered from `figma.code`;
      // `label` is the figma-side prop name (`Size`) passed to getString.
      { name: 'size', label: 'Size', type: 'string' },
    ])
  })

  it('falls back to a stringified arg when getString is called with a non-string', () => {
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const v = undefined
      const size = figma.selectedInstance.getString(v)
      export default figma.code\`<Button size={\${size}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, 'Button.figma.ts')
    expect(r.descriptors[0].props[0].label).toBe('undefined')
    expect(r.descriptors[0].props[0].type).toBe('string')
  })
})
