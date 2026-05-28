import { parseComponentDescriptorsFromSource } from '../../template_files/parse_template_file_source'

describe('source path metadata', () => {
  it('records the // source= directive as metadata.source verbatim', () => {
    const src = `
      // url=https://example.com
      // source=./Button.tsx
      import figma from 'figma'
      const v = figma.selectedInstance.getString('Alt')
      export default figma.code\`<Button alt={\${v}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, '/abs/foo/Button.figma.ts')
    expect(r.metadata?.source).toBe('./Button.tsx')
  })

  it('keeps http(s) urls in metadata.source verbatim', () => {
    const src = `
      // url=https://example.com
      // source=https://github.com/x/y/blob/main/Button.tsx
      import figma from 'figma'
      const v = figma.selectedInstance.getString('Alt')
      export default figma.code\`<Button alt={\${v}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, 'Button.figma.ts')
    expect(r.metadata?.source).toBe('https://github.com/x/y/blob/main/Button.tsx')
  })

  it('leaves metadata.source undefined when nothing resolves', () => {
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const v = figma.selectedInstance.getString('Alt')
      export default figma.code\`<Button alt={\${v}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, 'Button.figma.ts')
    expect(r.metadata?.source).toBeUndefined()
  })
})
