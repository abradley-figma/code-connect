/**
 * `parseComponentDescriptorsFromFile` is the on-disk wrapper around the
 * pure `parseComponentDescriptorsFromSource` orchestrator. It is the
 * single primitive used by both `compile/build.ts` (full discover pass)
 * and `compile/compiler.ts#updateFile` (single-file HMR re-parse). The
 * contract that matters for adapters is:
 *
 *   - successful read → `ParseResult`
 *   - read failure (missing / unreadable) → `undefined`
 *
 * `undefined` is the signal `updateFile` and `build()` use to treat the
 * path as a deletion. Locking that down here keeps the two call sites
 * from drifting on read-failure semantics.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { parseComponentDescriptorsFromFile } from '../../template_files/parse_template_file_source'

const TEMPLATE = [
  '// url=https://example.com',
  "import figma from 'figma'",
  "const v = figma.selectedInstance.getString('Label')",
  'export default figma.code`<Button label={${v}} />`',
].join('\n')

describe('parseComponentDescriptorsFromFile', () => {
  it('returns a ParseResult and resolves filePath to the sibling component source', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'figma-parse-from-file-'))
    try {
      const templateFile = path.join(dir, 'Button.figma.ts')
      const sourceFile = path.join(dir, 'Button.tsx')
      fs.writeFileSync(templateFile, TEMPLATE, 'utf8')
      // Sibling-probe tier resolves to this file. Contents don't matter — the
      // resolver only stats existence.
      fs.writeFileSync(sourceFile, 'export const Button = () => null;\n', 'utf8')

      const r = await parseComponentDescriptorsFromFile(templateFile, 500)
      expect(r).toBeDefined()
      expect(r?.descriptors[0]?.componentName).toBe('Button')
      // filePath is the resolved component source path, NOT the template path.
      expect(r?.descriptors[0]?.filePath).toBe(sourceFile)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('leaves filePath undefined when no sibling/import resolves', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'figma-parse-from-file-'))
    try {
      const templateFile = path.join(dir, 'Button.figma.ts')
      // Only the template exists — no Button.{tsx,jsx,ts,js} sibling.
      fs.writeFileSync(templateFile, TEMPLATE, 'utf8')

      const r = await parseComponentDescriptorsFromFile(templateFile, 500)
      expect(r).toBeDefined()
      expect(r?.descriptors[0]?.componentName).toBe('Button')
      expect(r?.descriptors[0]?.filePath).toBeUndefined()
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns undefined when the file does not exist (delete semantics)', async () => {
    const r = await parseComponentDescriptorsFromFile(
      '/definitely/does/not/exist/Foo.figma.ts',
      500,
    )
    expect(r).toBeUndefined()
  })

  it('resolves a project-rooted // source= directive when root is supplied', async () => {
    // End-to-end check that the root threading actually reaches
    // `resolveComponentSourcePath`. The template lives in a subdirectory
    // and writes `// source=<project-relative path>` — exactly the shape
    // a hand-written `.figma.ts` would use.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'figma-parse-from-file-'))
    try {
      const subdir = path.join(dir, 'src/app/components/ui')
      fs.mkdirSync(subdir, { recursive: true })
      const templateFile = path.join(subdir, 'Button.figma.ts')
      const sourceFile = path.join(subdir, 'Button.tsx')
      const TEMPLATE_WITH_PROJECT_SOURCE = [
        '// url=https://example.com',
        // Project-rooted shape with leading `/` — this is the shape that
        // failed before the projectRoot fallback because `path.resolve`
        // short-circuited to the literal absolute path.
        '// source=/src/app/components/ui/Button.tsx',
        "import figma from 'figma'",
        "const v = figma.selectedInstance.getString('Label')",
        'export default figma.code`<Button label={${v}} />`',
      ].join('\n')
      fs.writeFileSync(templateFile, TEMPLATE_WITH_PROJECT_SOURCE, 'utf8')
      fs.writeFileSync(sourceFile, 'export const Button = () => null;\n', 'utf8')

      const r = await parseComponentDescriptorsFromFile(templateFile, 500, dir)
      expect(r).toBeDefined()
      expect(r?.descriptors[0]?.componentName).toBe('Button')
      expect(r?.descriptors[0]?.filePath).toBe(sourceFile)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('resolves a project-relative // source= directive without leading slash when root is supplied', async () => {
    // The other natural shape — `// source=src/...` (no leading `/`).
    // Without the fallback this resolved to a nonsense path under the
    // template directory; with it we look it up under root.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'figma-parse-from-file-'))
    try {
      const subdir = path.join(dir, 'src/app/components/ui')
      fs.mkdirSync(subdir, { recursive: true })
      const templateFile = path.join(subdir, 'Button.figma.ts')
      const sourceFile = path.join(subdir, 'Button.tsx')
      const TEMPLATE_WITH_PROJECT_SOURCE = [
        '// url=https://example.com',
        '// source=src/app/components/ui/Button.tsx',
        "import figma from 'figma'",
        "const v = figma.selectedInstance.getString('Label')",
        'export default figma.code`<Button label={${v}} />`',
      ].join('\n')
      fs.writeFileSync(templateFile, TEMPLATE_WITH_PROJECT_SOURCE, 'utf8')
      fs.writeFileSync(sourceFile, 'export const Button = () => null;\n', 'utf8')

      const r = await parseComponentDescriptorsFromFile(templateFile, 500, dir)
      expect(r).toBeDefined()
      expect(r?.descriptors[0]?.filePath).toBe(sourceFile)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
