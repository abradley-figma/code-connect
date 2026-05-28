import { parseComponentDescriptorsFromSource } from '../../template_files/parse_template_file_source'

describe('getInstanceSwap -> reference descriptor', () => {
  it('captures instance swap as a reference descriptor', () => {
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const icon = figma.selectedInstance.getInstanceSwap('Icon')
      export default figma.code\`<Button icon={\${icon}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, 'Button.figma.ts')
    expect(r.descriptors[0].props[0]).toEqual({
      name: 'icon',
      label: 'Icon',
      type: 'reference',
    })
  })
})
