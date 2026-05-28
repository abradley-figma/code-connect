import { parseComponentDescriptorsFromSource } from '../../template_files/parse_template_file_source'

describe('edge cases', () => {
  it('handles emoji in prop names', () => {
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const v = figma.selectedInstance.getEnum('👥 Variant', { A: 'a', B: 'b' })
      export default figma.code\`<Button variant={\${v}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, 'Button.figma.ts')
    // The figma-side prop name (with emoji + space) survives in `label`.
    // `name` falls back to the figma-side name here too because the
    // JSX attribute (`variant`) and the figma-side name (`👥 Variant`)
    // disagree only in capitalization-ish ways — the parser uses the
    // recovered JSX attr.
    expect(r.descriptors[0].props[0].label).toBe('👥 Variant')
    expect(r.descriptors[0].props[0].name).toBe('variant')
  })

  it('handles prop names with spaces', () => {
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const v = figma.selectedInstance.getString('First name')
      export default figma.code\`<Field firstName={\${v}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, 'Field.figma.ts')
    // `label` keeps the original "First name" (with space). `name` is
    // the JSX attribute `firstName`, recovered from the `figma.code`
    // template — JSX won't accept a space in attribute names, so this
    // is exactly the case `name` recovery exists for.
    expect(r.descriptors[0].props[0].label).toBe('First name')
    expect(r.descriptors[0].props[0].name).toBe('firstName')
  })

  it('skips JSX enum-value entries via jsx-runtime stub', () => {
    const src = `
      // url=https://example.com
      import figma from 'figma'
      function Icon() { return null }
      const v = figma.selectedInstance.getEnum('X', { With: <Icon/>, Plain: 'p' })
      export default figma.code\`<Button x={\${v}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, 'Button.figma.tsx')
    expect(r.descriptors).toHaveLength(1)
    expect(
      (r.descriptors[0].props[0] as { options: unknown[] }).options,
    ).toEqual([{ value: 'p', label: 'Plain' }])
  })

  it('rejects top-level await', () => {
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const v = await Promise.resolve(figma.selectedInstance.getString('X'))
      export default figma.code\`<Button x={\${v}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, 'Button.figma.ts')
    // top-level await is not legal CJS — execution should report a failure.
    expect(r.descriptors[0]?.props ?? []).toHaveLength(0)
  })

  it('handles comments inside the getEnum call', () => {
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const v = figma.selectedInstance.getEnum('X', /* inline */ { A: 'a' })
      export default figma.code\`<Button x={\${v}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, 'Button.figma.ts')
    expect((r.descriptors[0].props[0] as { options: unknown[] }).options).toEqual([
      { value: 'a', label: 'A' },
    ])
  })
})
