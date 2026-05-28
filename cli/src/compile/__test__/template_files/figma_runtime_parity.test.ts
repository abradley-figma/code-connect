/**
 * Parity tests that verify the build-time mock in `figma_code_connect.ts`
 * accepts every shape a real production template file might use — without
 * silently dropping descriptors.
 *
 * The mock is intentionally a tiny subset of the runtime `figma` global —
 * it only needs to record property captures and surface the `figma.code`-
 * tagged template structure — but its accepted input must stay aligned
 * with the publicly documented template-file API surface.
 *
 * Each `describe` block here corresponds to a public surface of the
 * `figma` template-file API and asserts that a representative template
 * using that surface produces the expected prop descriptors. New patterns
 * observed in the wild should be added here, not to ad-hoc test files.
 *
 * Convention: fixtures use `size` / `Size` as the canonical prop name pair
 * — `name` is the JSX attribute (`size`), `label` is the figma-side prop
 * name (`Size`). Avoid using `label` as a JSX attribute in fixtures; it
 * collides with the `PropDescriptor.label` field name and confuses readers.
 */
import { parseComponentDescriptorsFromSource } from '../../template_files/parse_template_file_source'

const filePath = 'Button.figma.ts'

describe('export default shape parity', () => {
  it('accepts bare `export default figma.code`...`` (simple form)', () => {
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const size = figma.selectedInstance.getString('Size')
      export default figma.code\`<Button size={\${size}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, filePath)
    expect(r!.descriptors![0].props).toEqual([
      // `name` is the JSX attribute (`size`) recovered from `figma.code`;
      // `label` is the figma-side prop name (`Size`) passed to getString.
      { name: 'size', label: 'Size', type: 'string' },
    ])
  })

  it('accepts canonical `{ example, imports, id, metadata }` export object (documented form)', () => {
    // This is the form documented at https://developers.figma.com/docs/code-connect/template-files/
    // and what `code-connect publish` emits.
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const size = figma.selectedInstance.getString('Size')
      const variant = figma.selectedInstance.getEnum('Variant', { Primary: 'primary', Secondary: 'secondary' })
      export default {
        example: figma.code\`<Button variant={\${variant}} size={\${size}} />\`,
        imports: ['import Button from "./Button"'],
        id: 'button',
        metadata: { nestable: true },
      }
    `
    const r = parseComponentDescriptorsFromSource(src, filePath)
    const names = r!.descriptors![0].props.map((p) => p.name)
    expect(names).toEqual(['size', 'variant'])
  })

  it('does not emit "default export is not figma.code" warning for canonical-shape exports', () => {
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const size = figma.selectedInstance.getString('Size')
      export default {
        example: figma.code\`<Button size={\${size}} />\`,
        imports: [],
        id: 'button',
      }
    `
    const r = parseComponentDescriptorsFromSource(src, filePath)
    const warnings = r!.warnings ?? []
    expect(warnings.find((w) => w.includes('not the result of figma.code'))).toBeUndefined()
  })

  it('still warns when the export is neither figma.code nor { example: figma.code }', () => {
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const size = figma.selectedInstance.getString('Size')
      // example missing: not the canonical shape
      export default { imports: [], id: 'button', metadata: {} }
      // keep the capture alive so we still produce a descriptor
      void size
    `
    const r = parseComponentDescriptorsFromSource(src, filePath)
    const warnings = r!.warnings ?? []
    expect(warnings.some((w) => w.includes('not the result of figma.code'))).toBe(true)
  })

  it('accepts `module.exports = figma.code`...`` (CJS form, .figma.template.js)', () => {
    const src = `
      // url=https://example.com
      const figma = require('figma')
      const size = figma.selectedInstance.getString('Size')
      module.exports = figma.code\`<Button size={\${size}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, 'Button.figma.template.js')
    expect(r!.descriptors![0].props.map((p) => p.name)).toEqual(['size'])
  })
})

describe('template literal tag parity (figma.code | tsx | html | swift | kotlin)', () => {
  // The `figma` template-file API exposes 5 tag aliases — all of them follow
  // the same template-literal-result shape. The build-time mock should treat
  // them interchangeably so we still recover the root tag and JSX attribute
  // joins.
  const tags = ['code', 'tsx', 'html', 'swift', 'kotlin'] as const

  for (const tag of tags) {
    it(`figma.${tag} produces the same join recovery as figma.code`, () => {
      const src = `
        // url=https://example.com
        import figma from 'figma'
        const size = figma.selectedInstance.getString('Size')
        export default figma.${tag}\`<Button size={\${size}} />\`
      `
      const r = parseComponentDescriptorsFromSource(src, filePath)
      expect(r!.descriptors![0].componentName).toBe('Button')
      expect(r!.descriptors![0].props).toEqual([
        { name: 'size', label: 'Size', type: 'string' },
      ])
    })
  }
})

describe('shared captures across multiple JSX attributes', () => {
  // Real templates sometimes thread the same capture into multiple JSX
  // attributes — e.g. Tabs uses `defaultValue` both on the wrapper and on
  // the matching `<TabsContent value={…}>`. We want `name` to reflect the
  // FIRST attribute the capture was bound to (typically on the root /
  // outermost tag, matching what users see on the props panel).
  it('picks the first JSX attribute when one capture is bound to several', () => {
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const defaultValue = figma.selectedInstance.getString('Default value')
      export default figma.code\`<Tabs defaultValue={\${defaultValue}}>
  <TabsContent value={\${defaultValue}} />
</Tabs>\`
    `
    const r = parseComponentDescriptorsFromSource(src, filePath)
    expect(r!.descriptors![0].props).toEqual([
      { name: 'defaultValue', label: 'Default value', type: 'string' },
    ])
  })
})

describe('legacy V1 figma.properties.* API', () => {
  // `figma.properties.*` (V1) is still part of the public template-file API
  // surface alongside the modern `selectedInstance.getX(...)` (V2). Templates
  // published before the V2 cutover use V1 and we must keep parsing them —
  // otherwise users upgrading the package see their existing templates emit
  // empty descriptors.
  it('figma.properties.string captures as text', () => {
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const size = figma.properties.string('Size')
      export default figma.code\`<Button size={\${size}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, filePath)
    expect(r!.descriptors![0].props).toEqual([
      { name: 'size', label: 'Size', type: 'string' },
    ])
  })

  it('figma.properties.boolean captures as boolean', () => {
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const disabled = figma.properties.boolean('Disabled')
      export default figma.code\`<Button disabled={\${disabled}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, filePath)
    expect(r!.descriptors![0].props).toEqual([
      { name: 'disabled', label: 'Disabled', type: 'boolean' },
    ])
  })

  it('figma.properties.enum captures as enum with options', () => {
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const size = figma.properties.enum('Size', { Sm: 'sm', Md: 'md', Lg: 'lg' })
      export default figma.code\`<Button size={\${size}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, filePath)
    expect(r!.descriptors![0].props[0]).toMatchObject({
      name: 'size',
      label: 'Size',
      type: 'enum',
      options: [
        { value: 'sm', label: 'Sm' },
        { value: 'md', label: 'Md' },
        { value: 'lg', label: 'Lg' },
      ],
    })
  })

  it('figma.properties.instance captures as reference', () => {
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const icon = figma.properties.instance('Icon')
      export default figma.code\`<Button icon={\${icon}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, filePath)
    expect(r!.descriptors![0].props).toEqual([
      { name: 'icon', label: 'Icon', type: 'reference' },
    ])
  })

  it('figma.properties.slot captures as slot', () => {
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const body = figma.properties.slot('Body')
      export default figma.code\`<Card>{${"$"}{body}}</Card>\`
    `.replace('${"$"}', '$') // keep literal ${body}
    const r = parseComponentDescriptorsFromSource(src, 'Card.figma.ts')
    expect(r!.descriptors![0].props).toEqual([
      // Slots in children position aren't bound to a JSX attribute, so
      // `name` falls back to the figma-side prop name.
      { name: 'Body', label: 'Body', type: 'slot' },
    ])
  })

  it('mixed V1 and V2 calls in one template both contribute captures', () => {
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const size = figma.properties.string('Size')
      const disabled = figma.selectedInstance.getBoolean('Disabled')
      export default figma.code\`<Button size={\${size}} disabled={\${disabled}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, filePath)
    expect(r!.descriptors![0].props.map((p) => p.name).sort()).toEqual([
      'disabled',
      'size',
    ])
  })

  it('figma.properties.children() does not crash (rendering helper, not a panel prop)', () => {
    // `children(layerNames)` returns rendered child sections; it's not a
    // schema prop. Confirm it doesn't crash execution and doesn't produce
    // a spurious descriptor for itself.
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const items = figma.properties.children(['Item'])
      const size = figma.properties.string('Size')
      export default figma.code\`<List size={\${size}}>{${"$"}{items}}</List>\`
    `.replace('${"$"}', '$')
    const r = parseComponentDescriptorsFromSource(src, 'List.figma.ts')
    expect(r!.descriptors![0].props.map((p) => p.name)).toEqual(['size'])
    expect(r!.warnings?.find((w) => w.includes('threw'))).toBeUndefined()
  })
})

describe('nested instance handles (findInstance / findText / findConnectedInstance)', () => {
  // Templates that compose multiple connected instances read props off the
  // nested handle, e.g. `selectedInstance.findInstance('Icon').getString('Color')`.
  // Captures from the nested mockInstance flow into the same `captures` array,
  // so descriptors should be produced as if the calls were on selectedInstance.
  it('findInstance(...).getString() captures correctly', () => {
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const icon = figma.selectedInstance.findInstance('Icon')
      const iconColor = icon.getString('Color')
      export default figma.code\`<Button iconColor={\${iconColor}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, filePath)
    expect(r!.descriptors![0].props).toEqual([
      // `name` reflects the JSX attribute (`iconColor`); `label` is the
      // figma-side prop name (`Color`) read off the nested instance.
      { name: 'iconColor', label: 'Color', type: 'string' },
    ])
  })

  it('findInstance(...) with options (path / traverseInstances) does not crash', () => {
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const icon = figma.selectedInstance.findInstance('Icon', { path: ['Group'], traverseInstances: true })
      const size = icon.getEnum('Size', { Sm: 'sm', Lg: 'lg' })
      export default figma.code\`<Button iconSize={\${size}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, filePath)
    expect(r!.descriptors![0].props[0].name).toBe('iconSize')
  })

  it('findText(...).textContent reads as a string and does not crash', () => {
    // findText is a layer lookup keyed by the layer's name (`'Title'`),
    // distinct from a prop-name lookup. Use a different fixture name to
    // avoid mixing layer names and prop names visually.
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const txt = figma.selectedInstance.findText('Title')
      const titleText = txt.textContent
      const size = figma.selectedInstance.getString('Size')
      export default figma.code\`<Button size={\${size}} fallback={\${titleText}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, filePath)
    // We only capture getX calls; raw textContent reads are not captures.
    expect(r!.descriptors![0].props.map((p) => p.name)).toEqual(['size'])
    expect(r!.warnings?.find((w) => w.includes('threw'))).toBeUndefined()
  })

  it('findConnectedInstance / findConnectedInstances / findLayers do not crash', () => {
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const sel = figma.selectedInstance
      const ci = sel.findConnectedInstance('button')
      const cis = sel.findConnectedInstances(() => true)
      const layers = sel.findLayers(() => true, { traverseInstances: true })
      const size = sel.getString('Size')
      // suppress unused
      void ci; void cis; void layers
      export default figma.code\`<Button size={\${size}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, filePath)
    expect(r!.descriptors![0].props.map((p) => p.name)).toEqual(['size'])
    expect(r!.warnings?.find((w) => w.includes('threw'))).toBeUndefined()
  })
})

describe('inert figma surfaces do not crash execution', () => {
  // These are real Figma runtime objects that templates might touch but that
  // never produce panel-prop captures. The mock provides inert stubs that
  // must not throw — the test confirms the captures still come through.

  it('figma.batch[key] returns a placeholder and does not crash', () => {
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const designKey = figma.batch.designKey
      const size = figma.selectedInstance.getString('Size')
      // designKey would be used in URL or imports in a real batch run
      void designKey
      export default figma.code\`<Button size={\${size}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, filePath)
    expect(r!.descriptors![0].props.map((p) => p.name)).toEqual(['size'])
    expect(r!.warnings?.find((w) => w.includes('threw'))).toBeUndefined()
  })

  it('figma.value(raw) usage as an enum option does not crash', () => {
    // Some templates use `figma.value()` to inject raw expressions into
    // an enum mapping. Our build-time mock just returns a marker object;
    // figma_code_connect skips non-primitives via `coerceEnumValue`.
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const v = figma.selectedInstance.getEnum('Theme', {
        Light: figma.value('themes.light'),
        Dark: 'dark',
      })
      export default figma.code\`<Button theme={\${v}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, filePath)
    const opts = (r!.descriptors![0].props[0] as { options: unknown[] }).options
    // The figma.value(...) option gets dropped (returns the marker object,
    // which coerceEnumValue can't coerce), the string option stays.
    expect(opts).toEqual([{ value: 'dark', label: 'Dark' }])
  })

  it('figma.helpers.react.renderProp does not crash', () => {
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const variant = figma.selectedInstance.getEnum('Variant', { A: 'a' })
      const x = figma.helpers.react.renderProp('variant', variant)
      void x
      export default figma.code\`<Button variant={\${variant}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, filePath)
    expect(r!.descriptors![0].props[0].name).toBe('variant')
    expect(r!.warnings?.find((w) => w.includes('threw'))).toBeUndefined()
  })

  it('figma.helpers.react.renderProp recovers JSX attr name from tag-content position', () => {
    // Real-world templates frequently use `renderProp(attrName, capture)` to
    // emit a JSX attribute conditionally (omitting it when the prop is the
    // default). The placeholder lands BETWEEN `<Tag` and `>` rather than
    // inside `attr={…}`, so a naive walker can't recover the JSX attribute
    // name from `strings[i]` alone. The mock's `renderProp` returns a
    // marker object that carries `(attrName, captureToken)` so the
    // attribute → capture binding is preserved at compile time.
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const variant = figma.selectedInstance.getEnum('Variant', { Primary: 'primary' })
      const size = figma.selectedInstance.getEnum('Size', { Sm: 'sm' })
      const disabled = figma.selectedInstance.getBoolean('Disabled')
      export default figma.code\`<Button\${figma.helpers.react.renderProp('variant', variant)}\${figma.helpers.react.renderProp('size', size)}\${figma.helpers.react.renderProp('disabled', disabled)}/>\`
    `
    const r = parseComponentDescriptorsFromSource(src, filePath)
    const props = r!.descriptors![0].props
    expect(props.map((p) => ({ name: p.name, label: p.label }))).toEqual([
      // `name` recovered from the renderProp marker (camelCase JSX attr);
      // `label` stays the figma-side prop name (TitleCase).
      { name: 'variant', label: 'Variant' },
      { name: 'size', label: 'Size' },
      { name: 'disabled', label: 'Disabled' },
    ])
  })

  it('figma.helpers.react.renderProp wrapping a non-capture value does not break recovery', () => {
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const size = figma.selectedInstance.getString('Size')
      export default figma.code\`<Button\${figma.helpers.react.renderProp('staticAttr', 'literal-string')}\${figma.helpers.react.renderProp('size', size)}/>\`
    `
    const r = parseComponentDescriptorsFromSource(src, filePath)
    // The literal-string renderProp is silently ignored (no capture to bind);
    // the `size` capture binds normally.
    expect(r!.descriptors![0].props).toEqual([
      { name: 'size', label: 'Size', type: 'string' },
    ])
  })

  it('figma.helpers.swift.renderChildren / kotlin.renderChildren do not crash', () => {
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const size = figma.selectedInstance.getString('Size')
      const s = figma.helpers.swift.renderChildren([], '  ')
      const k = figma.helpers.kotlin.renderChildren([], '  ')
      void s; void k
      export default figma.code\`<Button size={\${size}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, filePath)
    expect(r!.descriptors![0].props.map((p) => p.name)).toEqual(['size'])
  })

  it('getPropertyValue / hasCodeConnect / codeConnectId do not crash', () => {
    // getPropertyValue takes the *figma-side* prop name and returns the raw
    // bound value. It's not a capture, so it doesn't produce a descriptor.
    // The companion getString call is the one that contributes the prop.
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const sel = figma.selectedInstance
      const raw = sel.getPropertyValue('Size')
      const isCC = sel.hasCodeConnect()
      const id = sel.codeConnectId()
      void raw; void isCC; void id
      const size = sel.getString('Size')
      export default figma.code\`<Button size={\${size}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, filePath)
    expect(r!.descriptors![0].props.map((p) => p.name)).toEqual(['size'])
    expect(r!.warnings?.find((w) => w.includes('threw'))).toBeUndefined()
  })

  it('executeTemplate() on a nested instance does not crash', () => {
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const child = figma.selectedInstance.findInstance('Child')
      const t = child.executeTemplate()
      void t
      const size = figma.selectedInstance.getString('Size')
      export default figma.code\`<Button size={\${size}} />\`
    `
    const r = parseComponentDescriptorsFromSource(src, filePath)
    expect(r!.descriptors![0].props.map((p) => p.name)).toEqual(['size'])
  })
})

describe('language-tag interpolation edge cases', () => {
  it('figma.code with no interpolations still recovers a root tag', () => {
    const src = `
      // url=https://example.com
      import figma from 'figma'
      export default figma.code\`<Button size="md" />\`
    `
    const r = parseComponentDescriptorsFromSource(src, filePath)
    expect(r!.descriptors![0].componentName).toBe('Button')
    expect(r!.descriptors![0].props).toEqual([])
  })

  it('figma.code nested inside another figma.code call still resolves attribute joins', () => {
    // Real templates compose tagged templates — e.g. when a sub-prop is
    // itself a template fragment. The mock's tag returns a marker object
    // that `extract_jsx_info` ignores as an attr value, so the prop appears
    // as "unbound" rather than triggering a spurious attribute.
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const size = figma.selectedInstance.getString('Size')
      const subtitle = figma.tsx\`<span>{${"$"}{size}}</span>\`
      export default figma.code\`<Button size={\${size}} subtitle={\${subtitle}} />\`
    `.replace('${"$"}', '$')
    const r = parseComponentDescriptorsFromSource(src, filePath)
    // We still get a `size` prop. `subtitle` is not a capture because
    // figma.tsx`...` is not a capture token.
    expect(r!.descriptors![0].props.map((p) => p.name)).toEqual(['size'])
  })

  it('boolean placeholder in children position is not bound to a JSX attr', () => {
    const src = `
      // url=https://example.com
      import figma from 'figma'
      const visible = figma.selectedInstance.getBoolean('Visible')
      export default figma.code\`<Wrapper>{${"$"}{visible} && <Inner />}</Wrapper>\`
    `.replace('${"$"}', '$')
    const r = parseComponentDescriptorsFromSource(src, 'Wrapper.figma.ts')
    // Capture is in children position, so JSX-attr recovery has nothing
    // to bind to and `name` falls back to the figma-side prop name.
    expect(r!.descriptors![0].props).toEqual([
      { name: 'Visible', label: 'Visible', type: 'boolean' },
    ])
  })
})
