import { parseComponentDescriptorsFromSource } from '../../template_files/parse_template_file_source'

function parse(src: string) {
  return parseComponentDescriptorsFromSource(src, 'Button.figma.tsx')
}

function header() {
  return ['// url=https://example.com', `import figma from 'figma'`, ''].join('\n')
}

describe('getEnum -> enum descriptor', () => {
  it('captures string-valued mappings', () => {
    const r = parse(`
      ${header()}
      const v = figma.selectedInstance.getEnum('Variant', { Primary: 'primary', Danger: 'danger' })
      export default figma.code\`<Button variant={\${v}} />\`
    `)
    const prop = r.descriptors[0].props[0]
    expect(prop.type).toBe('enum')
    expect(prop).toMatchObject({
      type: 'enum',
      options: [
        { value: 'primary', label: 'Primary' },
        { value: 'danger', label: 'Danger' },
      ],
    })
  })

  it('coerces numbers, floats, negatives, scientific notation to strings', () => {
    const r = parse(`
      ${header()}
      const v = figma.selectedInstance.getEnum('Size', { Small: 0.5, Large: -2, Huge: 1e3 })
      export default figma.code\`<Button size={\${v}} />\`
    `)
    expect(r.descriptors[0].props[0]).toMatchObject({
      type: 'enum',
      options: [
        { value: '0.5', label: 'Small' },
        { value: '-2', label: 'Large' },
        { value: '1000', label: 'Huge' },
      ],
    })
  })

  it('coerces booleans to strings', () => {
    const r = parse(`
      ${header()}
      const v = figma.selectedInstance.getEnum('Flag', { On: true, Off: false })
      export default figma.code\`<Button flag={\${v}} />\`
    `)
    expect(r.descriptors[0].props[0]).toMatchObject({
      type: 'enum',
      options: [
        { value: 'true', label: 'On' },
        { value: 'false', label: 'Off' },
      ],
    })
  })

  it('keeps undefined/null entries with empty value', () => {
    const r = parse(`
      ${header()}
      const v = figma.selectedInstance.getEnum('Variant', { Wide: undefined, None: null })
      export default figma.code\`<Button variant={\${v}} />\`
    `)
    expect(r.descriptors[0].props[0]).toMatchObject({
      type: 'enum',
      options: [
        { value: '', label: 'Wide' },
        { value: '', label: 'None' },
      ],
    })
  })

  it('skips JSX-valued options and emits a warning', () => {
    const r = parseComponentDescriptorsFromSource(
      `
        // url=https://example.com
        import figma from 'figma'
        function Icon() { return null }
        const v = figma.selectedInstance.getEnum('Variant', { With: <Icon/>, Without: 'no' })
        export default figma.code\`<Button variant={\${v}} />\`
      `,
      'Button.figma.tsx',
    )
    const prop = r.descriptors[0].props[0]
    expect(prop.type).toBe('enum')
    const opts = (prop as { options: unknown[] }).options
    expect(opts).toEqual([{ value: 'no', label: 'Without' }])
    expect(r.warnings?.some((w) => /dropped 1 non-primitive/.test(w))).toBe(true)
  })

  it('skips function options and warns', () => {
    const r = parse(`
      ${header()}
      const v = figma.selectedInstance.getEnum('X', { Cancellable: () => 'x', Always: 'yes' })
      export default figma.code\`<Button x={\${v}} />\`
    `)
    const prop = r.descriptors[0].props[0]
    const opts = (prop as { options: unknown[] }).options
    expect(opts).toEqual([{ value: 'yes', label: 'Always' }])
    expect(r.warnings?.some((w) => /dropped 1 non-primitive/.test(w))).toBe(true)
  })

  it('skips nested capture-token values and warns', () => {
    const r = parse(`
      ${header()}
      const inner = figma.selectedInstance.getString('Inner')
      const v = figma.selectedInstance.getEnum('Variant', { Primary: inner, Danger: 'danger' })
      export default figma.code\`<Button variant={\${v}} />\`
    `)
    const enumProp = r.descriptors[0].props.find((p) => p.label === 'Variant')!
    const opts = (enumProp as { options: unknown[] }).options
    expect(opts).toEqual([{ value: 'danger', label: 'Danger' }])
    expect(r.warnings?.some((w) => /dropped 1 non-primitive/.test(w))).toBe(true)
  })

  it('skips plain-object values and warns', () => {
    const r = parse(`
      ${header()}
      const v = figma.selectedInstance.getEnum('Variant', { Primary: { foo: 1 }, Danger: 'danger' })
      export default figma.code\`<Button variant={\${v}} />\`
    `)
    const opts = (r.descriptors[0].props[0] as { options: unknown[] }).options
    expect(opts).toEqual([{ value: 'danger', label: 'Danger' }])
  })

  it('preserves keys with spaces and emoji and propagates them as the label default', () => {
    const r = parse(`
      ${header()}
      const v = figma.selectedInstance.getEnum('👥 Variant', {
        'Secondary Destruct': 'sd',
        '👥 Friendly': 'f',
      })
      export default figma.code\`<Button variant={\${v}} />\`
    `)
    const prop = r.descriptors[0].props[0]
    // `label` keeps the figma-side prop name verbatim (spaces, emoji, all).
    // `name` is the JSX attribute name (`variant`) recovered from
    // `figma.code` — JSX attributes can't contain spaces or emoji.
    expect(prop.name).toBe('variant')
    expect(prop.label).toBe('👥 Variant')
    const opts = (prop as { options: unknown[] }).options
    expect(opts).toEqual([
      { value: 'sd', label: 'Secondary Destruct' },
      { value: 'f', label: '👥 Friendly' },
    ])
  })

  it('materializes computed keys at runtime', () => {
    const r = parse(`
      ${header()}
      const k = 'Dynamic'
      const v = figma.selectedInstance.getEnum('Variant', { [k]: 'd', Static: 's' })
      export default figma.code\`<Button variant={\${v}} />\`
    `)
    const opts = (r.descriptors[0].props[0] as { options: unknown[] }).options
    expect(opts).toEqual([
      { value: 'd', label: 'Dynamic' },
      { value: 's', label: 'Static' },
    ])
  })

  it('captures mapping built by a local helper', () => {
    const r = parse(`
      ${header()}
      function makeMap() { return { A: 'a', B: 'b' } }
      const m = makeMap()
      const v = figma.selectedInstance.getEnum('X', m)
      export default figma.code\`<Button x={\${v}} />\`
    `)
    expect((r.descriptors[0].props[0] as { options: unknown[] }).options).toEqual([
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ])
  })

  it('drops the capture entirely when mapping is empty', () => {
    const r = parse(`
      ${header()}
      const v = figma.selectedInstance.getEnum('X', {})
      export default figma.code\`<Button x={\${v}} />\`
    `)
    // Capture still exists, but option list is empty and a warning explains why.
    const prop = r.descriptors[0].props[0]
    expect(prop).toMatchObject({ type: 'enum', options: [] })
    expect(r.warnings?.some((w) => /no usable options/.test(w))).toBe(true)
  })

  it('captures mapping built with spread', () => {
    const r = parse(`
      ${header()}
      const base = { A: 'a' }
      const m = { ...base, B: 'b' }
      const v = figma.selectedInstance.getEnum('X', m)
      export default figma.code\`<Button x={\${v}} />\`
    `)
    expect((r.descriptors[0].props[0] as { options: unknown[] }).options).toEqual([
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ])
  })
})
