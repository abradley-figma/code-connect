import { parseComponentDescriptorsFromSource } from '../../template_files/parse_template_file_source'

describe('legacy figma.connect() skip', () => {
  it('skips files that look legacy and emits a migrate warning', () => {
    const src = `
      import figma from '@figma/code-connect'
      import Button from './Button'

      figma.connect(Button, 'https://figma.com/x', {
        props: {
          label: figma.string('Label'),
        },
      })
    `
    const r = parseComponentDescriptorsFromSource(src, 'Button.figma.tsx')
    expect(r.descriptors).toHaveLength(0)
    expect(r.isLegacyConnectFile).toBe(true)
    expect(r.warnings?.some((w) => /legacy figma.connect/.test(w))).toBe(true)
  })

  it('parses a template when there is NO directive — body-marker recognition takes over', () => {
    const src = `
      import figma from 'figma'
      const v = figma.selectedInstance.getString('Size')
      export default figma.code\`<Button size={\${v}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, 'Button.figma.ts')
    expect(r.isLegacyConnectFile).not.toBe(true)
    expect(r.descriptors).toHaveLength(1)
    expect(r.descriptors[0].props[0]).toEqual({
      name: 'size',
      label: 'Size',
      type: 'string',
    })
  })
})
