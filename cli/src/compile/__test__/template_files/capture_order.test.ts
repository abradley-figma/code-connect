/**
 * Capture-order + dedup contract for `parseComponentDescriptorsFromSource`.
 *
 *  - `props[]` order MUST equal the order in which `getX('Name')` calls
 *    execute. The `BasePropDescriptor.sortPosition` field is not
 *    producible from a `.figma.ts` template (see `compile/types.ts`),
 *    so panels fall back to source order — and source order IS our
 *    capture-emit order. Locking this here means a future refactor
 *    that, say, sorts captures by name (or groups by kind) can't
 *    silently break the panel's row ordering.
 *
 *  - Same `figmaPropName` + same kind dedups silently — first-write-wins,
 *    matching the existing behaviour for templates that call the same
 *    `getX('Foo')` twice.
 *
 *  - Same `figmaPropName` + DIFFERENT kind keeps the first capture and
 *    surfaces a warning. A single Figma property maps to one row in the
 *    panel, so emitting two descriptors for the same name produces
 *    duplicate rows. The most likely cause is an author bug (typo,
 *    copy-paste, stale refactor).
 */
import { parseComponentDescriptorsFromSource } from '../../template_files/parse_template_file_source'

describe('capture order + dedup', () => {
  describe('capture order is preserved in props[]', () => {
    it('emits props in getX-call order, not alphabetical order', () => {
      // Three captures in NON-alphabetical order. If a future refactor
      // groups/sorts captures, this fails loudly.
      const src = `
        // url=https://example.com
        import figma from 'figma'
        const z = figma.selectedInstance.getString('Z')
        const a = figma.selectedInstance.getBoolean('A')
        const m = figma.selectedInstance.getEnum('M', { x: 'x', y: 'y' })
        export default figma.code\`<Comp z={\${z}} a={\${a}} m={\${m}} />\`
      `
      const r = parseComponentDescriptorsFromSource(src, 'Comp.figma.ts')
      expect(r.descriptors).toHaveLength(1)
      // Source order is Z, A, M — emitted order must match. The panel's
      // implicit `sortPosition` fallback (when no descriptor sets
      // `sortPosition`, fall back to source order) only works if this
      // contract holds.
      expect(r.descriptors[0].props.map((p) => p.label)).toEqual(['Z', 'A', 'M'])
    })

    it('preserves order across all five capture kinds', () => {
      // Every supported kind, deliberately interleaved.
      const src = `
        // url=https://example.com
        import figma from 'figma'
        const slot = figma.selectedInstance.getSlot('Footer')
        const text = figma.selectedInstance.getString('Heading')
        const ref = figma.selectedInstance.getInstanceSwap('Icon')
        const bool = figma.selectedInstance.getBoolean('Disabled')
        const en = figma.selectedInstance.getEnum('Variant', { Primary: 'primary', Secondary: 'secondary' })
        export default figma.code\`<Card heading={\${text}} disabled={\${bool}} variant={\${en}} icon={\${ref}}>\${slot}</Card>\`
      `
      const r = parseComponentDescriptorsFromSource(src, 'Card.figma.tsx')
      expect(r.descriptors).toHaveLength(1)
      // Source order: slot → text → ref → bool → enum. Emit order must match.
      // Note this differs from JSX-attribute order in `figma.code` (which has
      // heading, disabled, variant, icon, then slot in children position) —
      // we lock CAPTURE order, not attribute order.
      expect(r.descriptors[0].props.map((p) => ({ label: p.label, type: p.type }))).toEqual([
        { label: 'Footer', type: 'slot' },
        { label: 'Heading', type: 'string' },
        { label: 'Icon', type: 'reference' },
        { label: 'Disabled', type: 'boolean' },
        { label: 'Variant', type: 'enum' },
      ])
    })

    it('preserves order through V1 figma.properties.* alias calls', () => {
      // V1 API routes through the same recording surface as V2; the
      // ordering contract holds regardless of which API the template uses.
      const src = `
        // url=https://example.com
        import figma from 'figma'
        const c = figma.properties.string('C')
        const b = figma.properties.boolean('B')
        const a = figma.properties.enum('A', { On: 'on', Off: 'off' })
        export default figma.code\`<Mix c={\${c}} b={\${b}} a={\${a}} />\`
      `
      const r = parseComponentDescriptorsFromSource(src, 'Mix.figma.ts')
      expect(r.descriptors[0].props.map((p) => p.label)).toEqual(['C', 'B', 'A'])
    })
  })

  describe('dedup on figmaPropName', () => {
    it('silently dedups same name + same kind, keeping the first capture', () => {
      // Template calls `getString('Foo')` twice — common when a value is
      // threaded through multiple JSX attrs and the author forgets to hoist.
      // No warning; first-write wins.
      const src = `
        // url=https://example.com
        import figma from 'figma'
        const a = figma.selectedInstance.getString('Foo')
        const b = figma.selectedInstance.getString('Foo')
        export default figma.code\`<Comp a={\${a}} b={\${b}} />\`
      `
      const r = parseComponentDescriptorsFromSource(src, 'Comp.figma.ts')
      expect(r.descriptors[0].props).toHaveLength(1)
      // `name` recovery picks the first JSX attribute the capture bound to;
      // both `a={…}` and `b={…}` point at the SAME first capture's token,
      // so `name` is `'a'` (the first attr in `figma.code` source order).
      expect(r.descriptors[0].props[0].label).toBe('Foo')
      // No warnings from the dedup path. (Other unrelated warnings could
      // exist in principle; assert specifically that no conflict warning
      // was emitted.)
      const warns = r.warnings ?? []
      expect(warns.some((w) => w.includes("captured with kind"))).toBe(false)
    })

    it('warns and skips the second capture on same name + different kind', () => {
      // Author bug: same figma-side prop name captured as both string and
      // boolean. Only the first descriptor is emitted; a warning surfaces
      // the conflict.
      const src = `
        // url=https://example.com
        import figma from 'figma'
        const s = figma.selectedInstance.getString('Foo')
        const b = figma.selectedInstance.getBoolean('Foo')
        export default figma.code\`<Comp s={\${s}} b={\${b}} />\`
      `
      const r = parseComponentDescriptorsFromSource(src, 'Comp.figma.ts')
      expect(r.descriptors[0].props).toHaveLength(1)
      // First-write wins: the string descriptor is kept.
      expect(r.descriptors[0].props[0].label).toBe('Foo')
      expect(r.descriptors[0].props[0].type).toBe('string')

      const warns = r.warnings ?? []
      const conflict = warns.find((w) => w.includes("prop name 'Foo' captured"))
      expect(conflict).toBeDefined()
      expect(conflict!).toContain("kind 'string'")
      expect(conflict!).toContain("'boolean'")
      expect(conflict!).toContain('Comp.figma.ts')
    })

    it('keeps the FIRST kind regardless of capture order', () => {
      // Reverse the order from the previous test: boolean first, string
      // second. The boolean wins now.
      const src = `
        // url=https://example.com
        import figma from 'figma'
        const b = figma.selectedInstance.getBoolean('Foo')
        const s = figma.selectedInstance.getString('Foo')
        export default figma.code\`<Comp b={\${b}} s={\${s}} />\`
      `
      const r = parseComponentDescriptorsFromSource(src, 'Comp.figma.ts')
      expect(r.descriptors[0].props).toHaveLength(1)
      expect(r.descriptors[0].props[0].type).toBe('boolean')

      const warns = r.warnings ?? []
      const conflict = warns.find((w) => w.includes("prop name 'Foo' captured"))
      expect(conflict).toBeDefined()
      // The warning lists kinds in order: seenKind ('boolean') then the
      // conflicting one ('string').
      expect(conflict!).toContain("kind 'boolean'")
      expect(conflict!).toContain("'string'")
    })

    it('dedups across kinds without affecting unrelated captures', () => {
      // Only 'Foo' is duplicated; 'Bar' should still emit. The conflict
      // warning must mention only the duplicated name.
      const src = `
        // url=https://example.com
        import figma from 'figma'
        const fooS = figma.selectedInstance.getString('Foo')
        const bar = figma.selectedInstance.getBoolean('Bar')
        const fooB = figma.selectedInstance.getBoolean('Foo')
        export default figma.code\`<Comp foo={\${fooS}} bar={\${bar}} alt={\${fooB}} />\`
      `
      const r = parseComponentDescriptorsFromSource(src, 'Comp.figma.ts')
      expect(r.descriptors[0].props).toHaveLength(2)
      // Order preserved: Foo (first capture, type string), then Bar.
      expect(r.descriptors[0].props.map((p) => ({ label: p.label, type: p.type }))).toEqual([
        { label: 'Foo', type: 'string' },
        { label: 'Bar', type: 'boolean' },
      ])

      const warns = r.warnings ?? []
      const conflict = warns.find((w) => w.includes("captured with kind"))
      expect(conflict).toBeDefined()
      expect(conflict!).toContain("'Foo'")
      expect(conflict!).not.toContain("'Bar'")
    })
  })
})
