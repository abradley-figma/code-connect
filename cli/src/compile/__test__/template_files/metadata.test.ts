import { extractMetadata } from '../../template_files/parse_template_file_source'

describe('extractMetadata', () => {
  it('picks up url=', () => {
    expect(extractMetadata('// url=https://figma.com/x\n').url).toBe('https://figma.com/x')
  })

  it('picks up component=', () => {
    expect(extractMetadata('// component=Button\n').componentDirective).toBe('Button')
  })

  it('picks up source=', () => {
    expect(extractMetadata('// source=./Button.tsx\n').sourceDirective).toBe('./Button.tsx')
  })

  it('is case-insensitive on the field name', () => {
    expect(extractMetadata('// URL=https://x\n// Component=Y\n').url).toBe('https://x')
    expect(extractMetadata('// URL=https://x\n// Component=Y\n').componentDirective).toBe('Y')
  })

  it('tolerates whitespace around field name and equals', () => {
    expect(extractMetadata('//   url   =   https://x\n').url).toBe('https://x')
  })

  it('stops scanning at the first non-comment line', () => {
    const src = ['// component=Stop', 'const x = 1', '// url=https://x'].join('\n')
    expect(extractMetadata(src).componentDirective).toBe('Stop')
    expect(extractMetadata(src).url).toBeUndefined()
  })

  it('first directive wins when repeated', () => {
    const src = ['// url=A', '// url=B'].join('\n')
    expect(extractMetadata(src).url).toBe('A')
  })

  it('ignores unknown directives', () => {
    expect(extractMetadata('// foo=bar\n').url).toBeUndefined()
  })
})
