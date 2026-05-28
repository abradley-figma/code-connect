import { transpileSource } from '../../transpile'

describe('transpileSource', () => {
  it('emits CJS output that defines module.exports', () => {
    const { js, diagnostics } = transpileSource(`export default 1`, 'test.figma.ts')
    expect(diagnostics).toHaveLength(0)
    expect(js).toMatch(/exports\.(default|_default)\s*=\s*1/)
  })

  it('handles TS generics on getEnum', () => {
    const src = `
      import figma from 'figma'
      const v = figma.selectedInstance.getEnum<'a' | 'b'>('Size', { A: 'a', B: 'b' })
      export default figma.code\`<Button size={\${v}} />\`
    `
    const { js, diagnostics } = transpileSource(src, 'test.figma.ts')
    expect(diagnostics).toHaveLength(0)
    expect(js).not.toMatch(/<\s*'a'\s*\|\s*'b'\s*>/)
  })

  it('handles `as const` on the mapping', () => {
    const src = `
      import figma from 'figma'
      const m = { A: 'a', B: 'b' } as const
      const v = figma.selectedInstance.getEnum('Size', m)
      export default figma.code\`<Button size={\${v}} />\`
    `
    const { diagnostics } = transpileSource(src, 'test.figma.ts')
    expect(diagnostics).toHaveLength(0)
  })

  it('transpiles JSX in template interpolation to react/jsx-runtime calls', () => {
    const src = `
      import figma from 'figma'
      const v = figma.selectedInstance.getEnum('Size', { With: <Icon /> })
      export default figma.code\`<X size={\${v}} />\`
    `
    const { js, diagnostics } = transpileSource(src, 'snippet.figma.tsx')
    // Should not produce hard errors that block execution.
    expect(diagnostics.every((d) => !/error TS\d+/i.test(d))).toBe(true)
    expect(js).toMatch(/react\/jsx-runtime/)
  })

  it('does not throw on unparseable TS, instead returns diagnostics', () => {
    const src = `export default !! const x = `
    const { diagnostics } = transpileSource(src, 'test.figma.ts')
    expect(Array.isArray(diagnostics)).toBe(true)
  })
})
