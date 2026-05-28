/**
 * Integration safety net: every committed Code Connect template fixture
 * (`.figma.{ts,tsx,js,jsx,template.ts,template.tsx,template.js,template.jsx}`)
 * is fed through `parseComponentDescriptorsFromSource` and its descriptor output is
 * snapshotted. Legacy `figma.connect()`-style `.figma.tsx` files are also
 * covered to assert the migrate-warning + empty-descriptor behavior.
 *
 * Snapshots intentionally do NOT include warnings — warning copy is allowed
 * to change without invalidating the fixture matrix.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { parseComponentDescriptorsFromSource } from '../template_files/parse_template_file_source'

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures')

interface Fixture {
  filename: string
  source: string
}

// Match every supported template extension:
//   .figma.{ts,tsx,js,jsx}                  — modern form (post-1.4.0)
//   .figma.template.{ts,tsx,js,jsx}         — legacy form (still supported)
const TEMPLATE_FIXTURE_RE = /\.figma\.(template\.)?(tsx?|jsx?)$/

function loadFixtures(): Fixture[] {
  return fs
    .readdirSync(FIXTURES_DIR)
    .filter((f) => TEMPLATE_FIXTURE_RE.test(f))
    .sort()
    .map((filename) => ({
      filename,
      source: fs.readFileSync(path.join(FIXTURES_DIR, filename), 'utf8'),
    }))
}

describe('real fixtures snapshot', () => {
  for (const { filename, source } of loadFixtures()) {
    it(`parses ${filename}`, () => {
      const result = parseComponentDescriptorsFromSource(
        source,
        path.join(FIXTURES_DIR, filename),
      )

      // Normalize filePath to be project-relative so snapshots are stable
      // across machines.
      const normalized = result.descriptors?.map((d) => ({
        ...d,
        filePath: d.filePath ? `<fixtures>/${path.basename(d.filePath)}` : undefined,
      }))

      expect({
        isLegacyConnectFile: result.isLegacyConnectFile,
        metadata: result.metadata,
        descriptors: normalized,
      }).toMatchSnapshot()
    })
  }

  it('flags every legacy .figma.tsx as legacy + empty descriptors', () => {
    const legacy = loadFixtures().filter((f) => /\.figma\.tsx$/.test(f.filename))
    expect(legacy.length).toBeGreaterThan(0)
    for (const { source, filename } of legacy) {
      const result = parseComponentDescriptorsFromSource(source, filename)
      expect(result.isLegacyConnectFile).toBe(true)
      expect(result.descriptors).toHaveLength(0)
      expect(result.warnings?.some((w) => /legacy figma\.connect/.test(w))).toBe(true)
    }
  })
})
