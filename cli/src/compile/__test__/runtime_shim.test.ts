/**
 * Runs the serialized shim against a real-ish `window` (jsdom) to assert
 * `window.figmaCodeConnect.getComponentDescriptor` behaves exactly as the
 * host environment will exercise it.
 *
 * We avoid the `@jest-environment jsdom` pragma because the `jest-environment-jsdom`
 * package is not installed in this repo — instead we use `jsdom` (which IS a
 * runtime dep) to spin up a fresh window per test.
 */

import vm from 'node:vm'
import { JSDOM } from 'jsdom'
import { ComponentDescriptorStore } from '../template_files/component_descriptor_store'
import type { ComponentDescriptor, FigmaCodeConnectApi } from '../types'
import { generateRuntimeShim } from '../runtime'

type TestWindow = Window & typeof globalThis & { figmaCodeConnect?: FigmaCodeConnectApi }

function freshWindow(): TestWindow {
  return new JSDOM('').window as unknown as TestWindow
}

function evalShimInWindow(source: string, w: TestWindow) {
  // The shim is an IIFE that uses `typeof window` and reads `window` from
  // the lexical scope of its containing module. We wire `window` in via a
  // single-arg Function wrapper.
  const fn = new Function('window', source)
  fn(w)
}

// snapshot() rewrites filePath project-relative; all fixtures live under
// /proj so the rewritten paths are stable regardless of test cwd.
const ROOT = '/proj'

function makeMap(descriptors: ComponentDescriptor[]): ComponentDescriptorStore {
  const m = new ComponentDescriptorStore()
  for (let i = 0; i < descriptors.length; i++) {
    m.set(`/proj/file_${i}.figma.ts`, [descriptors[i]])
  }
  return m
}

function shimFor(map: ComponentDescriptorStore): string {
  return generateRuntimeShim({ componentDescriptors: map.snapshot(ROOT) })
}

describe('runtime shim', () => {
  it('installs window.figmaCodeConnect.getComponentDescriptor and resolves exact matches', async () => {
    const w = freshWindow()
    const map = makeMap([
      {
        componentName: 'Button',
        filePath: '/proj/Button.tsx',
        props: [{ name: 'size', label: 'Size', type: 'string' }],
      },
    ])
    evalShimInWindow(shimFor(map), w)
    const got = await w.figmaCodeConnect!.getComponentDescriptor({
      componentName: 'Button',
      filePath: '/proj/Button.tsx',
    })
    expect(got?.componentName).toBe('Button')
  })

  it('falls back to name-only lookup when filePath does not match', async () => {
    const w = freshWindow()
    const map = makeMap([
      { componentName: 'Button', props: [] },
      { componentName: 'Card', filePath: '/proj/Card.tsx', props: [] },
    ])
    evalShimInWindow(shimFor(map), w)
    const got = await w.figmaCodeConnect!.getComponentDescriptor({ componentName: 'Button' })
    expect(got?.componentName).toBe('Button')
  })

  it('returns undefined when no match exists', async () => {
    const w = freshWindow()
    const map = makeMap([{ componentName: 'Button', props: [] }])
    evalShimInWindow(shimFor(map), w)
    const got = await w.figmaCodeConnect!.getComponentDescriptor({ componentName: 'Nope' })
    expect(got).toBeUndefined()
  })

  it('last bundle wins when multiple bundles each install the shim', async () => {
    // Every bundler we support dedupes the runtime module so this case
    // only arises in multi-bundle setups (Module Federation, micro-frontends,
    // host page + embedded widget). Documented behavior: the most recently
    // loaded bundle owns `window.figmaCodeConnect`. No merge.
    const w = freshWindow()
    const a = makeMap([{ componentName: 'Button', filePath: '/proj/Button.tsx', props: [] }])
    const b = makeMap([{ componentName: 'Card', filePath: '/proj/Card.tsx', props: [] }])
    evalShimInWindow(shimFor(a), w)
    evalShimInWindow(shimFor(b), w)
    expect(
      (
        await w.figmaCodeConnect!.getComponentDescriptor({
          componentName: 'Card',
          filePath: '/proj/Card.tsx',
        })
      )?.componentName,
    ).toBe('Card')
    // Button was in the first-loaded bundle — overwritten by the second.
    expect(
      await w.figmaCodeConnect!.getComponentDescriptor({
        componentName: 'Button',
        filePath: '/proj/Button.tsx',
      }),
    ).toBeUndefined()
  })

  it('is a no-op on Node (typeof window === undefined)', () => {
    const map = makeMap([{ componentName: 'Button', props: [] }])
    const source = shimFor(map)
    // Run the shim source in a brand new VM context that has NO window global.
    // It must NOT throw.
    expect(() => vm.runInNewContext(source, {})).not.toThrow()
  })

  it('window.figmaCodeConnect exposes only getComponentDescriptor - no internal state leaks', () => {
    const w = freshWindow()
    const map = makeMap([{ componentName: 'Button', props: [] }])
    evalShimInWindow(shimFor(map), w)
    expect(Object.keys(w.figmaCodeConnect!)).toEqual(['getComponentDescriptor'])
    expect(typeof w.figmaCodeConnect!.getComponentDescriptor).toBe('function')
  })

  it('overwrites any pre-existing window.figmaCodeConnect (no merge)', () => {
    const w = freshWindow()
      ; (w as unknown as { figmaCodeConnect: { customField: number } }).figmaCodeConnect = {
        customField: 42,
      }
    const map = makeMap([{ componentName: 'Button', props: [] }])
    evalShimInWindow(shimFor(map), w)
    expect((w.figmaCodeConnect as unknown as { customField?: number }).customField).toBeUndefined()
    expect(typeof w.figmaCodeConnect!.getComponentDescriptor).toBe('function')
  })

  it('dispatches a figmaCodeConnectLoad event on window after install', () => {
    const w = freshWindow()
    const seen: string[] = []
    w.addEventListener('figmaCodeConnectLoad', () => seen.push('loaded'))
    const map = makeMap([{ componentName: 'Button', props: [] }])
    evalShimInWindow(shimFor(map), w)
    expect(seen).toEqual(['loaded'])
  })

  describe('suffix-match tolerance', () => {
    // The manifest stores POSIX project-relative paths (e.g. `src/Button.tsx`)
    // but the host environment calls the shim from inside the running app,
    // where the bundler-supplied `_debugSource.fileName` is shaped differently
    // per bundler. The shim's suffix-match tier absorbs that drift.

    it('matches a Vite-shape leading-slash root-relative filePath', async () => {
      const w = freshWindow()
      // Manifest emits `src/Button.tsx` (project-relative).
      const map = makeMap([
        {
          componentName: 'Button',
          filePath: '/proj/src/Button.tsx',
          props: [],
        },
      ])
      evalShimInWindow(shimFor(map), w)

      // Vite hands us `/src/Button.tsx`.
      const got = await w.figmaCodeConnect!.getComponentDescriptor({
        componentName: 'Button',
        filePath: '/src/Button.tsx',
      })
      expect(got?.componentName).toBe('Button')
    })

    it('matches a Webpack-shape absolute filePath', async () => {
      const w = freshWindow()
      const map = makeMap([
        {
          componentName: 'Button',
          filePath: '/proj/src/Button.tsx',
          props: [],
        },
      ])
      evalShimInWindow(shimFor(map), w)

      // Webpack hands us the absolute path on disk.
      const got = await w.figmaCodeConnect!.getComponentDescriptor({
        componentName: 'Button',
        filePath: '/abs/proj/src/Button.tsx',
      })
      expect(got?.componentName).toBe('Button')
    })

    it('disambiguates between siblings with the same basename (vendor vs src)', async () => {
      const w = freshWindow()
      // Same component name lives at two different paths.
      const m = new ComponentDescriptorStore()
      m.set('/proj/src/Button.figma.ts', [
        {
          componentName: 'Button',
          filePath: '/proj/src/Button.tsx',
          props: [{ name: 'size', label: 'Size', type: 'string' }],
        },
      ])
      m.set('/proj/vendor/Button.figma.ts', [
        {
          componentName: 'Button',
          filePath: '/proj/vendor/Button.tsx',
          props: [{ name: 'kind', label: 'Kind', type: 'string' }],
        },
      ])
      evalShimInWindow(generateRuntimeShim({ componentDescriptors: m.snapshot(ROOT) }), w)

      // Look up the vendor path — must NOT return the src/ entry just because
      // the basename matches.
      const got = await w.figmaCodeConnect!.getComponentDescriptor({
        componentName: 'Button',
        filePath: '/abs/proj/vendor/Button.tsx',
      })
      expect(got?.props[0]?.name).toBe('kind')
    })

    it('does NOT cross path-segment boundaries (rc/Button.tsx is not a match for src/Button.tsx)', async () => {
      const w = freshWindow()
      const map = makeMap([
        {
          componentName: 'Button',
          filePath: '/proj/rc/Button.tsx',
          props: [],
        },
      ])
      evalShimInWindow(shimFor(map), w)

      // Suffix match must require a `/` boundary; otherwise `rc/Button.tsx`
      // would falsely match a needle of `/abs/src/Button.tsx`.
      const got = await w.figmaCodeConnect!.getComponentDescriptor({
        componentName: 'Button',
        filePath: '/abs/src/Button.tsx',
      })
      // Falls through to the name-only tier and returns the entry by name
      // (since there's only one Button). The sentinel is the next case
      // below: with a second descriptor competing, we must pick the right
      // one — proving the suffix tier itself did not produce a false hit.
      expect(got?.componentName).toBe('Button')

      // Now add a second Button at a path that DOES boundary-match the needle.
      const m2 = new ComponentDescriptorStore()
      m2.set('/proj/rc/Button.figma.ts', [
        {
          componentName: 'Button',
          filePath: '/proj/rc/Button.tsx',
          props: [{ name: 'a', label: 'A', type: 'string' }],
        },
      ])
      m2.set('/proj/src/Button.figma.ts', [
        {
          componentName: 'Button',
          filePath: '/proj/src/Button.tsx',
          props: [{ name: 'b', label: 'B', type: 'string' }],
        },
      ])
      const w2 = freshWindow()
      evalShimInWindow(generateRuntimeShim({ componentDescriptors: m2.snapshot(ROOT) }), w2)
      const got2 = await w2.figmaCodeConnect!.getComponentDescriptor({
        componentName: 'Button',
        filePath: '/abs/src/Button.tsx',
      })
      // Must pick `src/Button.tsx`, not `rc/Button.tsx`.
      expect(got2?.props[0]?.name).toBe('b')
    })

    it('exact match still wins over suffix match', async () => {
      const w = freshWindow()
      const m = new ComponentDescriptorStore()
      // Two descriptors, the suffix-match-eligible one inserted first.
      m.set('/proj/vendor/Button.figma.ts', [
        {
          componentName: 'Button',
          filePath: '/proj/vendor/Button.tsx',
          props: [{ name: 'wrong', label: 'Wrong', type: 'string' }],
        },
      ])
      m.set('/proj/src/Button.figma.ts', [
        {
          componentName: 'Button',
          filePath: '/proj/src/Button.tsx',
          props: [{ name: 'right', label: 'Right', type: 'string' }],
        },
      ])
      evalShimInWindow(generateRuntimeShim({ componentDescriptors: m.snapshot(ROOT) }), w)

      // Look up by the exact project-relative path — exact match must win.
      const got = await w.figmaCodeConnect!.getComponentDescriptor({
        componentName: 'Button',
        filePath: 'src/Button.tsx',
      })
      expect(got?.props[0]?.name).toBe('right')
    })
  })
})
