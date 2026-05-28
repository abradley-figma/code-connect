import { extractJsxInfo } from '../../template_files/extract_jsx_info'
import type { FigmaCodeResult } from '../../template_files/figma_code_connect'
import {
  FIGMA_CODE_MARKER,
  RENDER_PROP_MARKER,
  buildMockFigma,
  readTokenMeta,
} from '../../template_files/figma_code_connect'

/**
 * Helper that builds a fake figma.code result with synthetic tokens.
 * `extractJsxInfo` looks up symbol identity through `readTokenMeta`, so
 * tests that need real capture tokens use `buildMockFigma()` to get them.
 */
function fake(strings: TemplateStringsArray | string[], ...values: unknown[]): FigmaCodeResult {
  return {
    [FIGMA_CODE_MARKER]: true,
    strings: strings as unknown as string[],
    values,
  }
}

interface MockFigmaShape {
  selectedInstance: {
    getString(name: string): object
    getBoolean(name: string): object
    getSlot(name: string): object
  }
}

function makeTokenObject(figma: MockFigmaShape) {
  return figma.selectedInstance.getString('Probe')
}

describe('extractJsxInfo', () => {
  describe('root-tag recovery', () => {
    it('recovers root JSX tag from single-line example', () => {
      const jsx = extractJsxInfo(fake(['<Button x={', '} />'], 'value'))
      expect(jsx.rootTag).toBe('Button')
      expect(jsx.rootIsComponent).toBe(true)
    })

    it('recovers root JSX tag from multiline example', () => {
      const jsx = extractJsxInfo(fake(['\n  <Button\n    x={', '}\n  />\n'], 'v'))
      expect(jsx.rootTag).toBe('Button')
    })

    it('returns undefined root for dynamic tag', () => {
      const jsx = extractJsxInfo(fake(['<', ' x={', '}/>'], 'tag', 'v'))
      expect(jsx.rootTag).toBeUndefined()
    })

    it('returns the open-tag from paired tags', () => {
      const jsx = extractJsxInfo(fake(['<Button>...</Button>'], []))
      expect(jsx.rootTag).toBe('Button')
    })

    it('flags lowercase root tag as non-component', () => {
      const jsx = extractJsxInfo(fake(['<div x={', '} />'], 'v'))
      expect(jsx.rootTag).toBe('div')
      expect(jsx.rootIsComponent).toBe(false)
    })

    it('preserves namespaced tag names', () => {
      const jsx = extractJsxInfo(fake(['<Slot.Trigger>{', '}</Slot.Trigger>'], 'x'))
      expect(jsx.rootTag).toBe('Slot.Trigger')
      expect(jsx.rootIsComponent).toBe(true)
    })
  })

  describe('attribute → token binding', () => {
    it('binds attr→token on a single-line example', () => {
      const { figma } = buildMockFigma()
      const mock = figma as MockFigmaShape
      const a = makeTokenObject(mock)
      const b = mock.selectedInstance.getBoolean('Disabled')
      const code = fake(['<X a={', '} b={', '}/>'], a, b)
      const jsx = extractJsxInfo(code)
      expect(jsx.attrToToken.get('a')).toBe(readTokenMeta(a)!.symbol)
      expect(jsx.attrToToken.get('b')).toBe(readTokenMeta(b)!.symbol)
    })

    it('handles whitespace around `=`', () => {
      const { figma } = buildMockFigma()
      const a = makeTokenObject(figma as MockFigmaShape)
      const code = fake(['<X\n  a   =   {', '}\n/>'], a)
      const jsx = extractJsxInfo(code)
      expect(jsx.attrToToken.get('a')).toBe(readTokenMeta(a)!.symbol)
    })

    it('classifies children-position interpolations as unbound', () => {
      const { figma } = buildMockFigma()
      const child = (figma as MockFigmaShape).selectedInstance.getSlot('Content')
      const code = fake(['<X>{', '}</X>'], child)
      const jsx = extractJsxInfo(code)
      expect(jsx.attrToToken.size).toBe(0)
      expect(jsx.unboundTokens).toContain(readTokenMeta(child)!.symbol)
    })

    it('keeps the first attribute when the same token is bound twice', () => {
      const { figma } = buildMockFigma()
      const v = makeTokenObject(figma as MockFigmaShape)
      const code = fake(['<X a={', '} b={', '}/>'], v, v)
      const jsx = extractJsxInfo(code)
      expect(jsx.attrToToken.get('a')).toBe(readTokenMeta(v)!.symbol)
      expect(jsx.attrToToken.has('b')).toBe(true)
    })

    it('ignores plain-string interpolations', () => {
      const code = fake(['<X a={', '} />'], 'plain string')
      const jsx = extractJsxInfo(code)
      expect(jsx.attrToToken.size).toBe(0)
      expect(jsx.unboundTokens).toHaveLength(0)
    })

    it('does not panic on a non-figma-code shape', () => {
      const jsx = extractJsxInfo(fake(['', ''], 'unrelated'))
      expect(jsx.rootTag).toBeUndefined()
      expect(jsx.attrToToken.size).toBe(0)
      expect(jsx.unboundTokens).toHaveLength(0)
    })
  })

  describe('renderProp marker recovery', () => {
    it('binds attr→token from a renderProp marker in tag-content position', () => {
      const { figma } = buildMockFigma()
      const variant = (figma as MockFigmaShape).selectedInstance.getString('Variant')
      const marker = {
        [RENDER_PROP_MARKER]: true as const,
        attrName: 'variant',
        prop: variant,
      }
      // Placeholder lives between `<Button` and `>` — strings[0] = '<Button',
      // strings[1] = '/>'. The walker can't see an `attr={` shape; the
      // marker carries the JSX attr name explicitly.
      const code = fake(['<Button', '/>'], marker)
      const jsx = extractJsxInfo(code)
      expect(jsx.attrToToken.get('variant')).toBe(readTokenMeta(variant)!.symbol)
      expect(jsx.unboundTokens).toHaveLength(0)
    })

    it('silently skips renderProp markers wrapping non-capture values', () => {
      const marker = {
        [RENDER_PROP_MARKER]: true as const,
        attrName: 'staticAttr',
        prop: 'literal-string',
      }
      const code = fake(['<Button', '/>'], marker)
      const jsx = extractJsxInfo(code)
      // No capture token to bind, so attrToToken stays empty.
      expect(jsx.attrToToken.size).toBe(0)
      expect(jsx.unboundTokens).toHaveLength(0)
    })

    it('keeps the first renderProp marker when the same attr is rendered twice', () => {
      const { figma } = buildMockFigma()
      const a = (figma as MockFigmaShape).selectedInstance.getString('A')
      const b = (figma as MockFigmaShape).selectedInstance.getString('B')
      const code = fake(
        ['<Button', '', '/>'],
        { [RENDER_PROP_MARKER]: true as const, attrName: 'x', prop: a },
        { [RENDER_PROP_MARKER]: true as const, attrName: 'x', prop: b },
      )
      const jsx = extractJsxInfo(code)
      expect(jsx.attrToToken.get('x')).toBe(readTokenMeta(a)!.symbol)
    })

    it('mixes renderProp markers and bare attr={…} placeholders in one template', () => {
      const { figma } = buildMockFigma()
      const variant = (figma as MockFigmaShape).selectedInstance.getString('Variant')
      const size = (figma as MockFigmaShape).selectedInstance.getString('Size')
      const code = fake(
        ['<Button', ' size={', '}/>'],
        { [RENDER_PROP_MARKER]: true as const, attrName: 'variant', prop: variant },
        size,
      )
      const jsx = extractJsxInfo(code)
      expect(jsx.attrToToken.get('variant')).toBe(readTokenMeta(variant)!.symbol)
      expect(jsx.attrToToken.get('size')).toBe(readTokenMeta(size)!.symbol)
    })
  })
})
