import {
  resolveComponentSourcePath,
  ResolveComponentSourceOpts,
} from '../../template_files/resolve_component_source'

/**
 * Build an injectable `fileExists` that returns true for any path in `present`
 * and false otherwise. Tests use this to drive the resolver's matrix without
 * touching the disk.
 */
function mockFileExists(present: string[]): (p: string) => boolean {
  const set = new Set(present)
  return (p: string) => set.has(p)
}

/**
 * Thin wrapper that defaults `root` to `/proj` — the project-root prefix
 * every test already builds its `templateFilePath` and `fileExists` set
 * around. Inlining `root: '/proj'` in every call would be pure noise; tests
 * that need a different root (e.g. templates that live at `/`) override it
 * explicitly.
 */
function callResolver(
  opts: Omit<ResolveComponentSourceOpts, 'root'> & { root?: string },
): string | undefined {
  return resolveComponentSourcePath({ root: '/proj', ...opts })
}

describe('resolveComponentSourcePath', () => {
  describe('// source= directive', () => {
    it('resolves a relative directive against the template directory', () => {
      const got = callResolver({
        templateFilePath: '/proj/src/Button.figma.ts',
        componentName: 'Button',
        defaultExport: undefined,
        sourceDirective: './Button.tsx',
        fileExists: mockFileExists(['/proj/src/Button.tsx']),
      })
      expect(got).toBe('/proj/src/Button.tsx')
    })

    it('returns undefined when the relative directive does not resolve (does NOT fall through to imports[])', () => {
      const got = callResolver({
        templateFilePath: '/proj/src/Button.figma.ts',
        componentName: 'Button',
        defaultExport: { imports: ['import Button from "./Button"'] },
        sourceDirective: './Button.tsx',
        fileExists: mockFileExists(['/proj/src/Button.jsx']), // matches imports[] tier, not directive tier
      })
      expect(got).toBeUndefined()
    })

    it('takes an absolute directive verbatim', () => {
      const got = callResolver({
        templateFilePath: '/proj/src/Button.figma.ts',
        componentName: 'Button',
        defaultExport: undefined,
        sourceDirective: '/somewhere/else/Button.tsx',
        fileExists: mockFileExists(['/somewhere/else/Button.tsx']),
      })
      expect(got).toBe('/somewhere/else/Button.tsx')
    })

    it('skips an http(s) directive (URL-shaped → metadata-only)', () => {
      const got = callResolver({
        templateFilePath: '/proj/src/Button.figma.ts',
        componentName: 'Button',
        defaultExport: { imports: ['import Button from "./Button"'] },
        sourceDirective: 'https://github.com/x/y/blob/main/Button.tsx',
        fileExists: mockFileExists(['/proj/src/Button.tsx']),
      })
      // http-shaped directive is bypassed; falls through to imports[] tier.
      expect(got).toBe('/proj/src/Button.tsx')
    })

    it('also skips http:// (not just https://)', () => {
      const got = callResolver({
        templateFilePath: '/proj/src/Button.figma.ts',
        componentName: 'Button',
        defaultExport: undefined,
        sourceDirective: 'http://example.com/Button.tsx',
        fileExists: mockFileExists(['/proj/src/Button.tsx']),
      })
      // No imports[] match either, falls through to sibling probe.
      expect(got).toBe('/proj/src/Button.tsx')
    })

    it('probes extensions when the directive has no extension', () => {
      const got = callResolver({
        templateFilePath: '/proj/src/Button.figma.ts',
        componentName: 'Button',
        defaultExport: undefined,
        sourceDirective: './Button',
        fileExists: mockFileExists(['/proj/src/Button.jsx']),
      })
      expect(got).toBe('/proj/src/Button.jsx')
    })

    it('treats an empty directive as absent (falls through to imports[])', () => {
      // `extractMetadata` would normally strip empty directive values, but
      // the resolver should be defensive too.
      const got = callResolver({
        templateFilePath: '/proj/src/Button.figma.ts',
        componentName: 'Button',
        defaultExport: { imports: ['import Button from "./Button"'] },
        sourceDirective: '',
        fileExists: mockFileExists(['/proj/src/Button.tsx']),
      })
      expect(got).toBe('/proj/src/Button.tsx')
    })

    it('navigates `..` correctly when the directive points to a sibling directory', () => {
      const got = callResolver({
        templateFilePath: '/proj/src/templates/Button.figma.ts',
        componentName: 'Button',
        defaultExport: undefined,
        sourceDirective: '../components/Button.tsx',
        fileExists: mockFileExists(['/proj/src/components/Button.tsx']),
      })
      expect(got).toBe('/proj/src/components/Button.tsx')
    })

    it('returns undefined when the directive resolves to an absolute path that does not exist', () => {
      const got = callResolver({
        templateFilePath: '/proj/src/Button.figma.ts',
        componentName: 'Button',
        defaultExport: { imports: ['import Button from "./Button"'] },
        sourceDirective: '/some/other/Button.tsx',
        fileExists: mockFileExists(['/proj/src/Button.tsx']), // matches imports tier, not directive
      })
      // Directive is authoritative — no fall-through.
      expect(got).toBeUndefined()
    })

    describe('project-root fallback (project-rooted directive shapes)', () => {
      // The project-root fallback fires whenever the template-relative
      // attempt misses. Two natural-but-otherwise-broken shapes are
      // normalized to the same project-relative path:
      //
      //   `// source=src/foo.tsx`  — looks template-relative, but users mean
      //     project-relative; absent a `./` prefix, today's
      //     `path.resolve(templateDir, 'src/foo.tsx')` produces a nonsense
      //     path under the template directory that almost never exists.
      //   `// source=/src/foo.tsx` — looks absolute, but users mean
      //     project-relative; `path.resolve` short-circuits to the literal
      //     absolute path which exists nowhere.
      //
      // Tests here pin the strip-leading-slash equivalence and the
      // try-on-miss ordering (template-relative wins when it resolves).

      it('treats /src/foo as project-relative when the template-relative attempt misses', () => {
        const got = callResolver({
          templateFilePath: '/proj/src/app/components/ui/Button.figma.ts',
          componentName: 'Button',
          defaultExport: undefined,
          sourceDirective: '/src/app/components/ui/Button.tsx',
          fileExists: mockFileExists(['/proj/src/app/components/ui/Button.tsx']),
        })
        expect(got).toBe('/proj/src/app/components/ui/Button.tsx')
      })

      it('treats src/foo (no leading slash) as project-relative when the template-relative attempt misses', () => {
        const got = callResolver({
          templateFilePath: '/proj/src/app/components/ui/Button.figma.ts',
          componentName: 'Button',
          defaultExport: undefined,
          sourceDirective: 'src/app/components/ui/Button.tsx',
          fileExists: mockFileExists(['/proj/src/app/components/ui/Button.tsx']),
        })
        expect(got).toBe('/proj/src/app/components/ui/Button.tsx')
      })

      it('strips multiple leading slashes (//src/foo and /src/foo resolve identically)', () => {
        const got = callResolver({
          templateFilePath: '/proj/src/Button.figma.ts',
          componentName: 'Button',
          defaultExport: undefined,
          sourceDirective: '//src/Button.tsx',
          fileExists: mockFileExists(['/proj/src/Button.tsx']),
        })
        expect(got).toBe('/proj/src/Button.tsx')
      })

      it('probes extensions on the project-rooted fallback when the directive is extension-less', () => {
        const got = callResolver({
          templateFilePath: '/proj/src/app/Button.figma.ts',
          componentName: 'Button',
          defaultExport: undefined,
          sourceDirective: 'src/app/Button',
          fileExists: mockFileExists(['/proj/src/app/Button.jsx']),
        })
        expect(got).toBe('/proj/src/app/Button.jsx')
      })

      it('template-relative wins when both attempts could resolve (try-on-miss, not parallel)', () => {
        const got = callResolver({
          templateFilePath: '/proj/src/Button.figma.ts',
          componentName: 'Button',
          // `./local/Button.tsx` would resolve template-relative AND
          // `/proj/local/Button.tsx` would resolve project-rooted (after
          // stripping the leading slash). The first hit wins.
          defaultExport: undefined,
          sourceDirective: './local/Button.tsx',
          fileExists: mockFileExists([
            '/proj/src/local/Button.tsx', // template-relative target
            '/proj/local/Button.tsx', // project-rooted target (decoy)
          ]),
        })
        expect(got).toBe('/proj/src/local/Button.tsx')
      })

      it('genuine absolute path that exists still resolves on the first try (no fallback needed)', () => {
        const got = callResolver({
          templateFilePath: '/proj/src/Button.figma.ts',
          componentName: 'Button',
          defaultExport: undefined,
          sourceDirective: '/somewhere/else/Button.tsx',
          fileExists: mockFileExists(['/somewhere/else/Button.tsx']),
        })
        expect(got).toBe('/somewhere/else/Button.tsx')
      })

      it('returns undefined when neither template-relative nor project-rooted resolves', () => {
        const got = callResolver({
          templateFilePath: '/proj/src/Button.figma.ts',
          componentName: 'Button',
          defaultExport: undefined,
          sourceDirective: 'nonexistent/Button.tsx',
          fileExists: mockFileExists([]),
        })
        expect(got).toBeUndefined()
      })

      it('directive that is just slashes resolves to undefined (no infinite path)', () => {
        const got = callResolver({
          templateFilePath: '/proj/src/Button.figma.ts',
          componentName: 'Button',
          defaultExport: undefined,
          sourceDirective: '/',
          fileExists: mockFileExists(['/proj/Button.tsx']),
        })
        // `/` → strips to ``; the resolver short-circuits without probing.
        expect(got).toBeUndefined()
      })

      it('does NOT fall back for explicit ./ directives that miss template-relative', () => {
        // `./Button.tsx` is unambiguously template-relative. If it misses
        // there, we MUST NOT silently reroute to `<root>/Button.tsx` —
        // that's a different file and would publish wrong data. The user
        // typed the dot prefix on purpose.
        const got = callResolver({
          templateFilePath: '/proj/src/deep/Button.figma.ts',
          componentName: 'Button',
          defaultExport: undefined,
          sourceDirective: './Button.tsx',
          fileExists: mockFileExists([
            // `<templateDir>/Button.tsx` is missing.
            // `<root>/Button.tsx` exists as a decoy — fallback would
            // (incorrectly) route here if we didn't guard against `.`.
            '/proj/Button.tsx',
          ]),
        })
        expect(got).toBeUndefined()
      })

      it('does NOT fall back for explicit ../ directives that miss template-relative', () => {
        const got = callResolver({
          templateFilePath: '/proj/src/deep/Button.figma.ts',
          componentName: 'Button',
          defaultExport: undefined,
          sourceDirective: '../Button.tsx',
          fileExists: mockFileExists([
            // `<templateDir>/../Button.tsx` (= `/proj/src/Button.tsx`) is missing.
            // `<root>/Button.tsx` exists; fallback must not pick it up.
            '/proj/Button.tsx',
          ]),
        })
        expect(got).toBeUndefined()
      })

      it('resolves docs-style src/... directives from a deeply-nested template', () => {
        // The shape promoted by the official docs:
        // https://developers.figma.com/docs/code-connect/template-files/
        //   // source=src/components/MyButton.tsx
        // — exercise it from a template that lives 4 levels deep.
        const got = callResolver({
          templateFilePath: '/proj/src/app/components/ui/button.figma.ts',
          componentName: 'Button',
          defaultExport: undefined,
          sourceDirective: 'src/app/components/ui/button.tsx',
          fileExists: mockFileExists(['/proj/src/app/components/ui/button.tsx']),
        })
        expect(got).toBe('/proj/src/app/components/ui/button.tsx')
      })
    })

    it('treats an extension-less directive as a base to probe — directory hits do not count', () => {
      // The probe is a file-existence check; tests treat `present` as set
      // membership, so a directory path would simply be absent and the probe
      // returns false. This documents that directory paths cannot satisfy
      // the resolver.
      const got = callResolver({
        templateFilePath: '/proj/src/Button.figma.ts',
        componentName: 'Button',
        defaultExport: undefined,
        sourceDirective: './Button',
        fileExists: mockFileExists([]), // no .tsx, no .jsx, no .ts, no .js
      })
      expect(got).toBeUndefined()
    })
  })

  describe('imports[] matching', () => {
    it('resolves a default import whose name matches componentName', () => {
      const got = callResolver({
        templateFilePath: '/proj/src/Button.figma.ts',
        componentName: 'Button',
        defaultExport: { imports: ['import Button from "./Button"'] },
        fileExists: mockFileExists(['/proj/src/Button.tsx']),
      })
      expect(got).toBe('/proj/src/Button.tsx')
    })

    it('TypeScript-first extension order: .tsx beats .jsx beats .ts beats .js', () => {
      const all = [
        '/proj/src/Button.tsx',
        '/proj/src/Button.jsx',
        '/proj/src/Button.ts',
        '/proj/src/Button.js',
      ]
      expect(
        callResolver({
          templateFilePath: '/proj/src/Button.figma.ts',
          componentName: 'Button',
          defaultExport: { imports: ['import Button from "./Button"'] },
          fileExists: mockFileExists(all),
        }),
      ).toBe('/proj/src/Button.tsx')

      expect(
        callResolver({
          templateFilePath: '/proj/src/Button.figma.ts',
          componentName: 'Button',
          defaultExport: { imports: ['import Button from "./Button"'] },
          fileExists: mockFileExists(all.slice(1)), // no .tsx
        }),
      ).toBe('/proj/src/Button.jsx')

      expect(
        callResolver({
          templateFilePath: '/proj/src/Button.figma.ts',
          componentName: 'Button',
          defaultExport: { imports: ['import Button from "./Button"'] },
          fileExists: mockFileExists(all.slice(2)), // .ts, .js only
        }),
      ).toBe('/proj/src/Button.ts')

      expect(
        callResolver({
          templateFilePath: '/proj/src/Button.figma.ts',
          componentName: 'Button',
          defaultExport: { imports: ['import Button from "./Button"'] },
          fileExists: mockFileExists(all.slice(3)), // .js only
        }),
      ).toBe('/proj/src/Button.js')
    })

    it('skips named imports', () => {
      const got = callResolver({
        templateFilePath: '/proj/src/Button.figma.ts',
        componentName: 'Button',
        defaultExport: { imports: ['import { Button } from "./components"'] },
        fileExists: mockFileExists(['/proj/src/components.tsx']),
      })
      // Named imports are skipped; falls through to sibling probe (no sibling here).
      expect(got).toBeUndefined()
    })

    it('skips namespace imports', () => {
      const got = callResolver({
        templateFilePath: '/proj/src/Button.figma.ts',
        componentName: 'Button',
        defaultExport: { imports: ['import * as Button from "./Button"'] },
        fileExists: mockFileExists(['/proj/src/Button.tsx']),
      })
      // Namespace import isn't a default; imports[] tier doesn't match. Sibling
      // probe still finds Button.tsx because the basename matches.
      expect(got).toBe('/proj/src/Button.tsx')
    })

    it('skips side-effect imports', () => {
      const got = callResolver({
        templateFilePath: '/proj/src/Button.figma.ts',
        componentName: 'Button',
        defaultExport: { imports: ['import "./side-effect"'] },
        fileExists: mockFileExists(['/proj/src/side-effect.tsx']),
      })
      expect(got).toBeUndefined()
    })

    it('skips bare specifiers (node_modules / package imports)', () => {
      const got = callResolver({
        templateFilePath: '/proj/src/Button.figma.ts',
        componentName: 'Button',
        defaultExport: { imports: ['import Button from "@my/lib"'] },
        fileExists: mockFileExists([]),
      })
      expect(got).toBeUndefined()
    })

    it('matches the import whose default name equals componentName when multiple are present', () => {
      const got = callResolver({
        templateFilePath: '/proj/src/Page.figma.ts',
        componentName: 'Card',
        defaultExport: {
          imports: [
            'import Button from "./Button"',
            'import Card from "../shared/Card"',
            'import Icon from "./Icon"',
          ],
        },
        fileExists: mockFileExists([
          '/proj/src/Button.tsx',
          '/proj/shared/Card.tsx',
          '/proj/src/Icon.tsx',
        ]),
      })
      expect(got).toBe('/proj/shared/Card.tsx')
    })

    it('honours an explicit extension on the import specifier', () => {
      const got = callResolver({
        templateFilePath: '/proj/src/Button.figma.ts',
        componentName: 'Button',
        defaultExport: { imports: ['import Button from "./Button.jsx"'] },
        fileExists: mockFileExists(['/proj/src/Button.jsx', '/proj/src/Button.tsx']),
      })
      expect(got).toBe('/proj/src/Button.jsx')
    })

    it('matches a default import combined with a named clause (`import Foo, { Bar } from ...`)', () => {
      const got = callResolver({
        templateFilePath: '/proj/src/Button.figma.ts',
        componentName: 'Button',
        defaultExport: {
          imports: ['import Button, { ButtonProps } from "./Button"'],
        },
        fileExists: mockFileExists(['/proj/src/Button.tsx']),
      })
      expect(got).toBe('/proj/src/Button.tsx')
    })

    it('matches a default import combined with a namespace clause (`import Foo, * as Bar from ...`)', () => {
      const got = callResolver({
        templateFilePath: '/proj/src/Button.figma.ts',
        componentName: 'Button',
        defaultExport: {
          imports: ['import Button, * as ButtonNS from "./Button"'],
        },
        fileExists: mockFileExists(['/proj/src/Button.tsx']),
      })
      expect(got).toBe('/proj/src/Button.tsx')
    })

    it('accepts single-quoted specifiers', () => {
      const got = callResolver({
        templateFilePath: '/proj/src/Button.figma.ts',
        componentName: 'Button',
        defaultExport: { imports: ["import Button from './Button'"] },
        fileExists: mockFileExists(['/proj/src/Button.tsx']),
      })
      expect(got).toBe('/proj/src/Button.tsx')
    })

    it('tolerates a trailing semicolon', () => {
      const got = callResolver({
        templateFilePath: '/proj/src/Button.figma.ts',
        componentName: 'Button',
        defaultExport: { imports: ['import Button from "./Button";'] },
        fileExists: mockFileExists(['/proj/src/Button.tsx']),
      })
      expect(got).toBe('/proj/src/Button.tsx')
    })

    it('tolerates leading/trailing whitespace inside the import string', () => {
      const got = callResolver({
        templateFilePath: '/proj/src/Button.figma.ts',
        componentName: 'Button',
        defaultExport: { imports: ['   import Button from "./Button"   '] },
        fileExists: mockFileExists(['/proj/src/Button.tsx']),
      })
      expect(got).toBe('/proj/src/Button.tsx')
    })

    it('matches identifier characters: `_` and `$`-prefixed default names', () => {
      expect(
        callResolver({
          templateFilePath: '/proj/src/Underscore.figma.ts',
          componentName: '_Internal',
          defaultExport: { imports: ['import _Internal from "./Internal"'] },
          fileExists: mockFileExists(['/proj/src/Internal.tsx']),
        }),
      ).toBe('/proj/src/Internal.tsx')

      expect(
        callResolver({
          templateFilePath: '/proj/src/Dollar.figma.ts',
          componentName: '$Money',
          defaultExport: { imports: ['import $Money from "./Money"'] },
          fileExists: mockFileExists(['/proj/src/Money.tsx']),
        }),
      ).toBe('/proj/src/Money.tsx')
    })

    it('first matching default-name wins when imports[] has duplicates', () => {
      const got = callResolver({
        templateFilePath: '/proj/src/Page.figma.ts',
        componentName: 'Button',
        defaultExport: {
          imports: [
            'import Button from "./first/Button"',
            'import Button from "./second/Button"',
          ],
        },
        fileExists: mockFileExists([
          '/proj/src/first/Button.tsx',
          '/proj/src/second/Button.tsx',
        ]),
      })
      expect(got).toBe('/proj/src/first/Button.tsx')
    })

    it('returns undefined when the matching default-import\'s specifier does not resolve (does NOT fall back to sibling probe under that import name)', () => {
      // The matching imports[] specifier `./missing/Button` returns nothing
      // from the probe; the resolver bails out of the imports[] tier and
      // then tries the sibling probe with the TEMPLATE basename — which
      // here is `Page`, not `Button`. So no resolution.
      const got = callResolver({
        templateFilePath: '/proj/src/Page.figma.ts',
        componentName: 'Button',
        defaultExport: {
          imports: ['import Button from "./missing/Button"'],
        },
        fileExists: mockFileExists(['/proj/src/Button.tsx']),
      })
      expect(got).toBeUndefined()
    })

    it('handles an empty imports[] array', () => {
      const got = callResolver({
        templateFilePath: '/proj/src/Button.figma.ts',
        componentName: 'Button',
        defaultExport: { imports: [] },
        fileExists: mockFileExists(['/proj/src/Button.tsx']),
      })
      // No imports[] match; sibling probe finds it.
      expect(got).toBe('/proj/src/Button.tsx')
    })

    it('navigates `..` segments correctly', () => {
      const got = callResolver({
        templateFilePath: '/proj/src/templates/Button.figma.ts',
        componentName: 'Button',
        defaultExport: {
          imports: ['import Button from "../components/Button"'],
        },
        fileExists: mockFileExists(['/proj/src/components/Button.tsx']),
      })
      expect(got).toBe('/proj/src/components/Button.tsx')
    })

    it('normalises redundant `./` segments', () => {
      const got = callResolver({
        templateFilePath: '/proj/src/Button.figma.ts',
        componentName: 'Button',
        defaultExport: {
          imports: ['import Button from "././Button"'],
        },
        fileExists: mockFileExists(['/proj/src/Button.tsx']),
      })
      expect(got).toBe('/proj/src/Button.tsx')
    })
  })

  describe('sibling-file fallback', () => {
    it('resolves <dir>/<base>.tsx when no // source= and no matching imports[]', () => {
      const got = callResolver({
        templateFilePath: '/proj/src/Button.figma.ts',
        componentName: 'Button',
        defaultExport: undefined,
        fileExists: mockFileExists(['/proj/src/Button.tsx']),
      })
      expect(got).toBe('/proj/src/Button.tsx')
    })

    it('strips .figma.template.tsx style suffixes too', () => {
      const got = callResolver({
        templateFilePath: '/proj/src/Button.figma.template.ts',
        componentName: 'Button',
        defaultExport: undefined,
        fileExists: mockFileExists(['/proj/src/Button.tsx']),
      })
      expect(got).toBe('/proj/src/Button.tsx')
    })

    it('returns undefined when no sibling exists', () => {
      const got = callResolver({
        templateFilePath: '/proj/src/Button.figma.ts',
        componentName: 'Button',
        defaultExport: undefined,
        fileExists: mockFileExists([]),
      })
      expect(got).toBeUndefined()
    })

    it('returns undefined when the basename has no recognisable .figma.* suffix', () => {
      const got = callResolver({
        templateFilePath: '/proj/src/template.ts',
        componentName: 'Button',
        defaultExport: undefined,
        fileExists: mockFileExists(['/proj/src/template.tsx']),
      })
      expect(got).toBeUndefined()
    })
  })

  describe('defensive parsing of imports[]', () => {
    it('tolerates non-array imports', () => {
      const got = callResolver({
        templateFilePath: '/proj/src/Button.figma.ts',
        componentName: 'Button',
        defaultExport: { imports: 'not-an-array' },
        fileExists: mockFileExists(['/proj/src/Button.tsx']),
      })
      // Falls through to sibling probe.
      expect(got).toBe('/proj/src/Button.tsx')
    })

    it('tolerates non-string entries inside imports[]', () => {
      const got = callResolver({
        templateFilePath: '/proj/src/Button.figma.ts',
        componentName: 'Button',
        defaultExport: { imports: [42, null, { not: 'a-string' }] },
        fileExists: mockFileExists(['/proj/src/Button.tsx']),
      })
      expect(got).toBe('/proj/src/Button.tsx')
    })

    it('tolerates a non-object default export', () => {
      const got = callResolver({
        templateFilePath: '/proj/src/Button.figma.ts',
        componentName: 'Button',
        defaultExport: 'just a string',
        fileExists: mockFileExists(['/proj/src/Button.tsx']),
      })
      expect(got).toBe('/proj/src/Button.tsx')
    })
  })

  describe('all tiers fail', () => {
    it('returns undefined when nothing resolves', () => {
      const got = callResolver({
        templateFilePath: '/proj/src/Button.figma.ts',
        componentName: 'Button',
        defaultExport: { imports: ['import Other from "./Other"'] },
        sourceDirective: undefined,
        fileExists: mockFileExists([]),
      })
      expect(got).toBeUndefined()
    })
  })

  describe('probe defaults', () => {
    it('falls back to fs.statSync when no probeFile is supplied', () => {
      // Probe a path that almost certainly doesn't exist on disk; the resolver
      // should return undefined rather than throwing.
      const got = callResolver({
        templateFilePath: '/this/path/definitely/does/not/exist/Button.figma.ts',
        componentName: 'Button',
        defaultExport: undefined,
      })
      expect(got).toBeUndefined()
    })
  })

  describe('tier priority interplay', () => {
    // When all three tiers could plausibly match, `// source=` wins. When tier
    // 1 is absent, imports[] wins over the sibling probe. These tests pin
    // that ordering down end-to-end.

    it('tier 1 (// source=) wins over a matching imports[] entry', () => {
      const got = callResolver({
        templateFilePath: '/proj/src/Button.figma.ts',
        componentName: 'Button',
        sourceDirective: './directive/Button.tsx',
        defaultExport: { imports: ['import Button from "./imports/Button"'] },
        fileExists: mockFileExists([
          '/proj/src/directive/Button.tsx',
          '/proj/src/imports/Button.tsx',
          '/proj/src/Button.tsx',
        ]),
      })
      expect(got).toBe('/proj/src/directive/Button.tsx')
    })

    it('tier 2 (imports[]) wins over the sibling probe', () => {
      const got = callResolver({
        templateFilePath: '/proj/src/Button.figma.ts',
        componentName: 'Button',
        defaultExport: { imports: ['import Button from "./imports/Button"'] },
        fileExists: mockFileExists([
          '/proj/src/imports/Button.tsx',
          '/proj/src/Button.tsx',
        ]),
      })
      expect(got).toBe('/proj/src/imports/Button.tsx')
    })

    it('falls through to sibling probe when imports[] match resolves nowhere', () => {
      const got = callResolver({
        templateFilePath: '/proj/src/Button.figma.ts',
        componentName: 'Button',
        defaultExport: { imports: ['import Button from "@my/lib"'] },
        fileExists: mockFileExists(['/proj/src/Button.tsx']),
      })
      expect(got).toBe('/proj/src/Button.tsx')
    })
  })

  describe('probe call efficiency', () => {
    // `existsSync`/`statSync` aren't free in large monorepos. The resolver
    // should short-circuit on the first hit and not keep probing later tiers.

    function countingProbe(present: string[]) {
      const set = new Set(present)
      const calls: string[] = []
      const fn = (p: string) => {
        calls.push(p)
        return set.has(p)
      }
      return { fn, calls }
    }

    it('stops probing after a successful // source= hit (no imports[] or sibling probes)', () => {
      const probe = countingProbe(['/proj/src/Button.tsx'])
      callResolver({
        templateFilePath: '/proj/src/Button.figma.ts',
        componentName: 'Button',
        sourceDirective: './Button.tsx',
        defaultExport: { imports: ['import Button from "./Button"'] },
        fileExists: probe.fn,
      })
      expect(probe.calls).toEqual(['/proj/src/Button.tsx'])
    })

    it('stops probing after a successful imports[] hit (no sibling probes)', () => {
      const probe = countingProbe(['/proj/src/Button.tsx'])
      callResolver({
        templateFilePath: '/proj/src/Button.figma.ts',
        componentName: 'Button',
        defaultExport: { imports: ['import Button from "./Button"'] },
        fileExists: probe.fn,
      })
      // Hits on the first extension probe.
      expect(probe.calls).toEqual(['/proj/src/Button.tsx'])
    })

    it('stops walking the extension list once one matches (TS-first)', () => {
      const probe = countingProbe(['/proj/src/Button.tsx'])
      callResolver({
        templateFilePath: '/proj/src/Button.figma.ts',
        componentName: 'Button',
        defaultExport: undefined,
        fileExists: probe.fn,
      })
      expect(probe.calls).toEqual(['/proj/src/Button.tsx'])
    })

    it('walks all extensions when none exist', () => {
      const probe = countingProbe([])
      callResolver({
        templateFilePath: '/proj/src/Button.figma.ts',
        componentName: 'Button',
        defaultExport: undefined,
        fileExists: probe.fn,
      })
      // 4 sibling extension probes only — no directive, no imports[].
      expect(probe.calls).toEqual([
        '/proj/src/Button.tsx',
        '/proj/src/Button.jsx',
        '/proj/src/Button.ts',
        '/proj/src/Button.js',
      ])
    })

    it('does NOT probe at all for a bare-specifier imports[] match', () => {
      const probe = countingProbe([])
      callResolver({
        templateFilePath: '/proj/src/template.ts', // no .figma.* suffix → no sibling probe
        componentName: 'Button',
        defaultExport: { imports: ['import Button from "@my/lib"'] },
        fileExists: probe.fn,
      })
      expect(probe.calls).toEqual([])
    })
  })

  describe('various template basenames', () => {
    it.each([
      ['/proj/Button.figma.ts', '/proj/Button.tsx'],
      ['/proj/Button.figma.tsx', '/proj/Button.tsx'],
      ['/proj/Button.figma.js', '/proj/Button.tsx'],
      ['/proj/Button.figma.jsx', '/proj/Button.tsx'],
      ['/proj/Button.figma.template.ts', '/proj/Button.tsx'],
      ['/proj/Button.figma.template.tsx', '/proj/Button.tsx'],
      ['/proj/Button.figma.template.js', '/proj/Button.tsx'],
      ['/proj/Button.figma.template.jsx', '/proj/Button.tsx'],
    ])('strips the template suffix for %s', (templatePath, expected) => {
      const got = callResolver({
        templateFilePath: templatePath,
        componentName: 'Button',
        defaultExport: undefined,
        fileExists: mockFileExists([expected]),
      })
      expect(got).toBe(expected)
    })

    it('handles a template at the project root', () => {
      const got = callResolver({
        templateFilePath: '/Button.figma.ts',
        componentName: 'Button',
        defaultExport: undefined,
        fileExists: mockFileExists(['/Button.tsx']),
      })
      expect(got).toBe('/Button.tsx')
    })
  })
})
