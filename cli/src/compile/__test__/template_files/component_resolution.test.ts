import { parseComponentDescriptorsFromSource } from '../../template_files/parse_template_file_source'

describe('component name resolution', () => {
  it('takes the // component= directive when present', () => {
    const src = `
      // url=https://example.com
      // component=Avatar
      import figma from 'figma'
      const v = figma.selectedInstance.getString('Alt')
      export default figma.code\`<Whatever alt={\${v}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, '/abs/Button.figma.ts')
    expect(r.descriptors[0].componentName).toBe('Avatar')
  })

  it('falls back to the JSX root tag when no directive', () => {
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const v = figma.selectedInstance.getString('Alt')
      export default figma.code\`<Card alt={\${v}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, 'X.figma.ts')
    expect(r.descriptors[0].componentName).toBe('Card')
  })

  it('falls back to the basename when nothing else resolves', () => {
    // Use a lowercase root tag so it is ignored as a component candidate.
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const v = figma.selectedInstance.getString('Alt')
      export default figma.code\`<div alt={\${v}}>x</div>\`
    `
    const r = parseComponentDescriptorsFromSource(src, '/abs/SuperButton.figma.ts')
    expect(r.descriptors[0].componentName).toBe('SuperButton')
  })

  it('priority chain: directive beats JSX root', () => {
    const src = `
      // url=https://example.com
      // component=Avatar
      import figma from 'figma'
      const v = figma.selectedInstance.getString('Alt')
      export default figma.code\`<Card alt={\${v}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, '/abs/Other.figma.ts')
    expect(r.descriptors[0].componentName).toBe('Avatar')
  })

  it('drops descriptor + warns when nothing resolves', () => {
    // No directive, no JSX root capable of providing a name, and a file
    // basename that doesn't camelcase to a valid identifier (leading digit).
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const v = figma.selectedInstance.getString('Alt')
      export default figma.code\`<div>x</div>\`
    `
    const r = parseComponentDescriptorsFromSource(src, '123.figma.ts')
    expect(r.descriptors).toHaveLength(0)
    expect(r.warnings?.some((w) => /could not infer component name/.test(w))).toBe(true)
  })
})
