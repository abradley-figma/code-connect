import { parseComponentDescriptorsFromSource } from '../../template_files/parse_template_file_source'

describe('getSlot -> slot descriptor', () => {
  it('captures slot as a slot descriptor', () => {
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const content = figma.selectedInstance.getSlot('Content')
      export default figma.code\`<Card content={\${content}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, 'Card.figma.ts')
    expect(r.descriptors[0].props[0]).toEqual({
      name: 'content',
      label: 'Content',
      type: 'slot',
    })
  })
})
