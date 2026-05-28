import { parseComponentDescriptorsFromSource } from '../../template_files/parse_template_file_source'

describe('getBoolean -> boolean descriptor', () => {
  it('produces a boolean descriptor with no mapping', () => {
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const dis = figma.selectedInstance.getBoolean('Disabled')
      export default figma.code\`<Button disabled={\${dis}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, 'Button.figma.ts')
    expect(r.descriptors[0].props[0]).toEqual({
      name: 'disabled',
      label: 'Disabled',
      type: 'boolean',
    })
  })

  it('ignores any boolean mapping (still a boolean descriptor)', () => {
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const dis = figma.selectedInstance.getBoolean('Disabled', { true: 'yes', false: 'no' })
      export default figma.code\`<Button disabled={\${dis}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, 'Button.figma.ts')
    expect(r.descriptors[0].props[0].type).toBe('boolean')
  })

  it('partial boolean mapping is also ignored', () => {
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const dis = figma.selectedInstance.getBoolean('Disabled', { true: 'y' })
      export default figma.code\`<Button disabled={\${dis}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, 'Button.figma.ts')
    expect(r.descriptors[0].props[0].type).toBe('boolean')
  })
})
