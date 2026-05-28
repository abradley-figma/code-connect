import { parseComponentDescriptorsFromSource } from '../../template_files/parse_template_file_source'
import { executeTemplate } from '../../template_files/execute_template'
import { buildMockFigma } from '../../template_files/figma_code_connect'
import { transpileSource } from '../../transpile'

function transpileAndRun(
  src: string,
  opts: {
    timeoutMs?: number
    mutateMock?: (build: ReturnType<typeof buildMockFigma>) => void
  } = {},
) {
  const { js } = transpileSource(src, 'sandbox.figma.ts')
  const build = buildMockFigma()
  if (opts.mutateMock) opts.mutateMock(build)
  return executeTemplate({
    js,
    filePath: 'sandbox.figma.ts',
    figma: build.figma,
    jsxRuntime: build.jsxRuntime,
    timeoutMs: opts.timeoutMs,
  })
}

describe('execution sandbox', () => {
  it('aborts infinite loops within the timeout budget', () => {
    const r = transpileAndRun(
      `
        import figma from 'figma'
        while (true) {}
        module.exports.default = figma.code\`<X/>\`
      `,
      { timeoutMs: 50 },
    )
    expect(r.timedOut).toBe(true)
  })

  it('catches runtime exceptions and reports threw', () => {
    const r = transpileAndRun(`throw new Error('boom')`)
    expect(r.threw).toMatch(/boom/)
    expect(r.defaultExport).toBeUndefined()
  })

  it('records unknown imports without crashing', () => {
    const r = transpileAndRun(`
      const x = require('./does-not-exist')
      module.exports.default = 1
    `)
    expect(r.unknownImports).toContain('./does-not-exist')
  })

  it('records unknown imports for `react`', () => {
    const r = transpileAndRun(`
      const React = require('react')
      module.exports.default = 1
    `)
    expect(r.unknownImports).toContain('react')
  })

  it('does not expose process / global / setTimeout / fs / fetch', () => {
    const r = transpileAndRun(`
      module.exports.default = {
        process: typeof process,
        global: typeof global,
        globalThis_process: typeof globalThis.process,
        setTimeout: typeof setTimeout,
        setImmediate: typeof setImmediate,
        queueMicrotask: typeof queueMicrotask,
        Buffer: typeof Buffer,
        fetch: typeof fetch,
        XMLHttpRequest: typeof XMLHttpRequest,
      }
    `)
    expect(r.threw).toBeUndefined()
    const typeofs = r.defaultExport as Record<string, string>
    expect(typeofs.process).toBe('undefined')
    expect(typeofs.global).toBe('undefined')
    expect(typeofs.globalThis_process).toBe('undefined')
    expect(typeofs.setTimeout).toBe('undefined')
    expect(typeofs.setImmediate).toBe('undefined')
    expect(typeofs.queueMicrotask).toBe('undefined')
    expect(typeofs.Buffer).toBe('undefined')
    expect(typeofs.fetch).toBe('undefined')
    expect(typeofs.XMLHttpRequest).toBe('undefined')
  })

  it('records `fs` as an unknown require (does not actually import fs)', () => {
    const r = transpileAndRun(`
      const fs = require('fs')
      module.exports.default = { fs: typeof fs.readFileSync }
    `)
    expect(r.unknownImports).toContain('fs')
    expect((r.defaultExport as Record<string, string>).fs).toBe('undefined')
  })

  describe('codegen-from-strings is disabled', () => {
    it('blocks direct eval()', () => {
      const r = transpileAndRun(`module.exports.default = eval('1 + 1')`)
      expect(r.threw).toMatch(/code generation from strings (is disabled|disallowed)/i)
    })

    it('blocks indirect eval (0, eval)("...")', () => {
      const r = transpileAndRun(`module.exports.default = (0, eval)('1 + 1')`)
      expect(r.threw).toMatch(/code generation from strings (is disabled|disallowed)/i)
    })

    it('blocks the Function constructor', () => {
      const r = transpileAndRun(`module.exports.default = new Function('return 1')()`)
      expect(r.threw).toMatch(/code generation from strings (is disabled|disallowed)/i)
    })

    it('blocks Function called as a function', () => {
      const r = transpileAndRun(`module.exports.default = Function('return 1')()`)
      expect(r.threw).toMatch(/code generation from strings (is disabled|disallowed)/i)
    })

    it('blocks the constructor-walk escape (function(){}).constructor("...")', () => {
      const r = transpileAndRun(
        `module.exports.default = (function(){}).constructor('return process')()`,
      )
      expect(r.threw).toMatch(/code generation from strings (is disabled|disallowed)/i)
    })

    it('blocks the async-function constructor walk', () => {
      const r = transpileAndRun(
        `module.exports.default = (async function(){}).constructor('return 1')()`,
      )
      expect(r.threw).toMatch(/code generation from strings (is disabled|disallowed)/i)
    })

    it('blocks the generator-function constructor walk', () => {
      const r = transpileAndRun(
        `module.exports.default = (function*(){}).constructor('return 1')()`,
      )
      expect(r.threw).toMatch(/code generation from strings (is disabled|disallowed)/i)
    })

    it('blocks the async-generator constructor walk', () => {
      const r = transpileAndRun(
        `module.exports.default = (async function*(){}).constructor('return 1')()`,
      )
      expect(r.threw).toMatch(/code generation from strings (is disabled|disallowed)/i)
    })

    it('blocks WebAssembly codegen from bytes', () => {
      // Use the synchronous `new WebAssembly.Module(bytes)` API rather than
      // `WebAssembly.compile(bytes)` — the latter returns a rejected
      // Promise which surfaces as an unhandledRejection rather than as a
      // sync throw the sandbox can catch into `r.threw`.
      const r = transpileAndRun(`
        module.exports.default = new WebAssembly.Module(new Uint8Array([0]))
      `)
      expect(r.threw).toMatch(/wasm code generation/i)
    })

    it('still allows function literals and arrow functions', () => {
      const r = transpileAndRun(`
        function double(n) { return n * 2 }
        const triple = (n) => n * 3
        module.exports.default = double(5) + triple(10)
      `)
      expect(r.threw).toBeUndefined()
      expect(r.defaultExport).toBe(40)
    })
  })

  describe('realm isolation', () => {
    it('does not allow the template to mutate the host Array.prototype', () => {
      const before = [1, 2, 3].map((x) => x * 2)
      transpileAndRun(`Array.prototype.map = function () { throw new Error('poisoned') }`)
      const after = [1, 2, 3].map((x) => x * 2)
      expect(after).toEqual(before)
    })

    it('does not allow the template to mutate the host Object.prototype', () => {
      transpileAndRun(`Object.prototype.poisoned = 'pwned'`)
      expect((Object.prototype as Record<string, unknown>).poisoned).toBeUndefined()
    })

    it('does not allow the template to overwrite the require shim', () => {
      const r = transpileAndRun(`
        try {
          require = function () { return { secret: 'host' } }
          module.exports.default = 'rebound'
        } catch (e) {
          module.exports.default = 'locked: ' + e.message
        }
      `)
      // 'use strict' makes the assignment throw a TypeError. Either way,
      // the binding stays our shim.
      expect(String(r.defaultExport)).toMatch(/^locked:/)
    })

    it('does not allow the template to replace module.exports binding', () => {
      const r = transpileAndRun(`
        try {
          module = { exports: { default: 'replaced' } }
          module.exports.default = 'this should not survive'
        } catch (e) {
          module.exports.default = 'binding-locked'
        }
      `)
      // Either the assignment throws (strict mode + non-writable) or the
      // module binding is locked. Either way, our moduleObj.exports is
      // mutated through the original reference, so we read the value the
      // template set on it.
      expect(['binding-locked', 'this should not survive']).toContain(r.defaultExport)
    })
  })

  describe('async work is bounded', () => {
    it('aborts a Promise.then chain that loops forever', () => {
      const r = transpileAndRun(
        `Promise.resolve().then(() => { while (true) {} }); module.exports.default = 1`,
        { timeoutMs: 50 },
      )
      // microtaskMode: 'afterEvaluate' drains the queued microtask inside
      // the timeout window — without it, the infinite loop would run in
      // the host event loop after the script returns.
      expect(r.timedOut).toBe(true)
    })
  })

  describe('post-execution defensive reads', () => {
    it('handles a Proxy export with a throwing get trap', () => {
      const r = transpileAndRun(`
        module.exports = new Proxy({}, {
          get() { throw new Error('proxy.get fired in host') }
        })
      `)
      // The throw should be caught and reported as `threw`, not
      // propagated up to the parser.
      expect(r.threw).toBeDefined()
      expect(r.threw).toMatch(/failed to read module\.exports/)
      expect(r.defaultExport).toBeUndefined()
    })
  })

  /**
   * Host-realm objects we inject (`module`, `exports`, `console`, the
   * `require` shim, and the figma + jsxRuntime mocks) live in the host
   * realm and would normally expose host `Function` via
   * `obj.constructor.constructor`. V8's codegen disable does NOT cover
   * host-realm Function calls — they execute in a realm where the
   * disable doesn't apply. The defense is null-prototyping at injection
   * time so `obj.constructor` short-circuits to `undefined`.
   */
  describe('host-realm constructor-walk escapes are closed', () => {
    /**
     * Probes whether `injected.constructor.constructor('return process')()`
     * reaches a callable Function. Returns:
     *   - `reached: true`  → escape worked, host process reachable.
     *   - `reached: false` AND `ctor: 'undefined'` → null-prototype defense
     *     short-circuited the walk before any Function constructor was
     *     reachable (this is the desired outcome).
     *   - `reached: false` AND `error: '...'` → some other failure mode
     *     (e.g. the codegen disable threw). Still safe, but we want the
     *     null-prototype defense to be the primary stop, so we assert
     *     on `ctor: 'undefined'` separately.
     *
     * Includes `import figma from 'figma'` so the figma binding actually
     * resolves — otherwise probes that walk through `figma.*` would
     * trivially fail at lookup time without exercising the defense.
     */
    function probeProcessTypeof(injected: string) {
      const r = transpileAndRun(`
        import figma from 'figma'
        try {
          const ctor = ${injected}.constructor
          if (!ctor) {
            module.exports.default = { reached: false, ctor: 'undefined' }
          } else {
            const F = ctor.constructor
            if (typeof F !== 'function') {
              module.exports.default = { reached: false, ctor: 'present-but-no-Fn-ctor' }
            } else {
              const got = F('return process')()
              module.exports.default = { reached: true, processTypeof: typeof got, hasVersion: !!(got && got.versions) }
            }
          }
        } catch (e) {
          module.exports.default = { reached: false, error: e.message }
        }
      `)
      return r.defaultExport as { reached: boolean; ctor?: string; error?: string; hasVersion?: boolean }
    }

    it('module.constructor.constructor is unreachable', () => {
      const out = probeProcessTypeof('module')
      expect(out.reached).toBe(false)
      expect(out.ctor).toBe('undefined')
    })

    it('exports.constructor.constructor is unreachable', () => {
      const out = probeProcessTypeof('exports')
      expect(out.reached).toBe(false)
      expect(out.ctor).toBe('undefined')
    })

    it('console.constructor.constructor is unreachable', () => {
      const out = probeProcessTypeof('console')
      expect(out.reached).toBe(false)
      expect(out.ctor).toBe('undefined')
    })

    it('require.constructor.constructor is unreachable', () => {
      const out = probeProcessTypeof('require')
      expect(out.reached).toBe(false)
      expect(out.ctor).toBe('undefined')
    })

    it('figma.constructor.constructor is unreachable', () => {
      const out = probeProcessTypeof('figma')
      expect(out.reached).toBe(false)
      expect(out.ctor).toBe('undefined')
    })

    it('figma.helpers.react.constructor.constructor is unreachable', () => {
      const out = probeProcessTypeof('figma.helpers.react')
      expect(out.reached).toBe(false)
      expect(out.ctor).toBe('undefined')
    })

    it('figma.code result is unreachable', () => {
      const out = probeProcessTypeof('figma.code`x`')
      expect(out.reached).toBe(false)
      expect(out.ctor).toBe('undefined')
    })

    it('figma.value result is unreachable', () => {
      const out = probeProcessTypeof('figma.value("x")')
      expect(out.reached).toBe(false)
      expect(out.ctor).toBe('undefined')
    })

    it('figma.helpers.react.jsxElement result is unreachable', () => {
      const out = probeProcessTypeof('figma.helpers.react.jsxElement("<X/>")')
      expect(out.reached).toBe(false)
      expect(out.ctor).toBe('undefined')
    })

    it('token proxy from figma.selectedInstance.getString is unreachable', () => {
      const out = probeProcessTypeof('figma.selectedInstance.getString("X")')
      expect(out.reached).toBe(false)
      expect(out.ctor).toBe('undefined')
    })

    it('token proxy Object.getPrototypeOf returns null', () => {
      const r = transpileAndRun(`
        import figma from 'figma'
        const tok = figma.selectedInstance.getString('X')
        const proto = Object.getPrototypeOf(tok)
        module.exports.default = {
          protoIsNull: proto === null,
          ctorOnTok: typeof tok.constructor,
        }
      `)
      const out = r.defaultExport as { protoIsNull: boolean; ctorOnTok: string }
      expect(out.protoIsNull).toBe(true)
      expect(out.ctorOnTok).toBe('undefined')
    })

    it('chainStub via token.foo.bar.baz is unreachable', () => {
      // Walk a deep chain off a token to verify the chainStub also has
      // its prototype-walk escape closed.
      const out = probeProcessTypeof('figma.selectedInstance.getString("X").foo.bar.baz')
      expect(out.reached).toBe(false)
      expect(out.ctor).toBe('undefined')
    })

    it('jsxRuntime.constructor.constructor is unreachable', () => {
      const out = probeProcessTypeof("require('react/jsx-runtime')")
      expect(out.reached).toBe(false)
      expect(out.ctor).toBe('undefined')
    })

    it('result of jsxRuntime.jsx() has null prototype', () => {
      const r = transpileAndRun(`
        const jsxRuntime = require('react/jsx-runtime')
        const el = jsxRuntime.jsx('div', { children: 'x' })
        module.exports.default = {
          ctor: typeof el.constructor,
          protoIsNull: Object.getPrototypeOf(el) === null,
        }
      `)
      const out = r.defaultExport as { ctor: string; protoIsNull: boolean }
      expect(out.ctor).toBe('undefined')
      expect(out.protoIsNull).toBe(true)
    })

    it('require shim returns null-prototype objects for unknown modules', () => {
      const r = transpileAndRun(`
        const x = require('totally-unknown-module')
        module.exports.default = {
          xType: typeof x,
          ctor: typeof x.constructor,
          protoIsNull: Object.getPrototypeOf(x) === null,
        }
      `)
      const out = r.defaultExport as { xType: string; ctor: string; protoIsNull: boolean }
      expect(out.xType).toBe('object')
      expect(out.ctor).toBe('undefined')
      expect(out.protoIsNull).toBe(true)
    })
  })

  /**
   * Documented residual escape: host-realm arrays returned by figma
   * mock methods (`findConnectedInstances`, `findLayers`,
   * `executeTemplate().example`) keep their `Array.prototype` chain so
   * legitimate templates can still call `.map()` / `.filter()`. That
   * chain reaches host `Function` via `arr.constructor.constructor`,
   * and host `Function('…')` is not gated by V8's codegen disable
   * (which only applies to codegen invoked in the sandbox realm).
   *
   * Closing this would either break `[].map(…)` for legitimate templates
   * (the documented Template API surface uses array methods on
   * `findConnectedInstances` results) or require a full membrane
   * refactor of the figma mock — see the file-level docstring's
   * "Residual risk" section.
   *
   * This test pins the CURRENT BEHAVIOR so any future change that
   * ALSO closes this path will trip the test and force a docs update.
   */
  describe('process.env exfiltration is blocked', () => {
    // Plant a marker on the host so a successful escape would surface
    // it as the `defaultExport`. Restored after each test.
    const KEY = 'CC_SANDBOX_PROCESS_ENV_PROBE'
    const SECRET = 'leaked-' + Math.random().toString(36).slice(2)
    let saved: string | undefined
    beforeAll(() => {
      saved = process.env[KEY]
      process.env[KEY] = SECRET
    })
    afterAll(() => {
      if (saved === undefined) delete process.env[KEY]
      else process.env[KEY] = saved
    })

    function probe(setupSrc: string, escapeExpr: string) {
      return transpileAndRun(`
        import figma from 'figma'
        ${setupSrc}
        let r = 'unreachable'
        try {
          const F = (${escapeExpr})
          if (typeof F === 'function') r = F('return process')().env['${KEY}']
        } catch (e) { r = 'threw: ' + ((e && e.message) || String(e)) }
        module.exports.default = r
      `)
    }

    it('typeof process is undefined', () => {
      const r = transpileAndRun(`module.exports.default = typeof process`)
      expect(r.defaultExport).toBe('undefined')
    })

    it('direct `process.env` access throws ReferenceError', () => {
      const r = transpileAndRun(`
        let r
        try { r = process.env.PATH } catch (e) { r = 'threw' }
        module.exports.default = r
      `)
      expect(r.defaultExport).toBe('threw')
    })

    it('host-array constructor walk via findConnectedInstances() is blocked', () => {
      const r = probe(
        `const arr = figma.selectedInstance.findConnectedInstances(() => true)`,
        `arr.constructor.constructor`,
      )
      expect(r.defaultExport).not.toBe(SECRET)
      expect(String(r.defaultExport)).toMatch(/code generation from strings (is disabled|disallowed)/i)
    })

    it('host-array constructor walk via findLayers() is blocked', () => {
      const r = probe(
        `const arr = figma.selectedInstance.findLayers(() => true)`,
        `arr.constructor.constructor`,
      )
      expect(r.defaultExport).not.toBe(SECRET)
      expect(String(r.defaultExport)).toMatch(/code generation from strings (is disabled|disallowed)/i)
    })

    it('host-array constructor walk via executeTemplate().example is blocked', () => {
      const r = probe(
        `const arr = figma.selectedInstance.executeTemplate().example`,
        `arr.constructor.constructor`,
      )
      expect(r.defaultExport).not.toBe(SECRET)
      expect(String(r.defaultExport)).toMatch(/code generation from strings (is disabled|disallowed)/i)
    })

    it('host-array constructor walk via figma.code`...`.values is blocked', () => {
      const r = probe(
        'const arr = figma.code`hi ${1}`.values',
        `arr.constructor.constructor`,
      )
      expect(r.defaultExport).not.toBe(SECRET)
      expect(String(r.defaultExport)).toMatch(/code generation from strings (is disabled|disallowed)/i)
    })

    it('escape via Array.prototype.map fetched from a mock array is blocked', () => {
      const r = probe(
        `const arr = figma.selectedInstance.findLayers(() => true)`,
        `arr.map.constructor.constructor`,
      )
      expect(r.defaultExport).not.toBe(SECRET)
      expect(String(r.defaultExport)).toMatch(/code generation from strings (is disabled|disallowed)/i)
    })

    it('escape via Array.prototype.indexOf fetched from a mock array is blocked', () => {
      const r = probe(
        `const arr = figma.selectedInstance.findConnectedInstances(() => true)`,
        `arr.indexOf.constructor.constructor`,
      )
      expect(r.defaultExport).not.toBe(SECRET)
      expect(String(r.defaultExport)).toMatch(/code generation from strings (is disabled|disallowed)/i)
    })
  })

  it('arrays returned by mock methods still behave like arrays', () => {
    const r = transpileAndRun(`
      import figma from 'figma'
      const arr = figma.selectedInstance.findLayers(() => true)
      arr.push(1, 2, 3)
      module.exports.default = {
        isArray: Array.isArray(arr),
        length: arr.length,
        mapped: arr.map((x) => x * 2).join(','),
        spread: [...arr].join(','),
      }
    `)
    expect(r.threw).toBeUndefined()
    expect(r.defaultExport).toEqual({
      isArray: true,
      length: 3,
      mapped: '2,4,6',
      spread: '1,2,3',
    })
  })

  it('figma.code`...`.values is iterable and array-like after wrapping', () => {
    const r = transpileAndRun(`
      import figma from 'figma'
      const tagged = figma.code\`a \${1} b \${2} c\`
      module.exports.default = {
        isArray: Array.isArray(tagged.values),
        values: [...tagged.values],
        stringsIsArray: Array.isArray(tagged.strings),
      }
    `)
    expect(r.threw).toBeUndefined()
    expect(r.defaultExport).toEqual({
      isArray: true,
      values: [1, 2],
      stringsIsArray: true,
    })
  })

  it('swallows console.log', () => {
    const spy = jest.spyOn(global.console, 'log').mockImplementation(() => { })
    try {
      transpileAndRun(`console.log('secret'); module.exports.default = 1`)
    } finally {
      spy.mockRestore()
    }
    // Note: the sandbox console is a separate object; the host console.log is
    // never invoked. We rely on the no-op stub baked into the sandbox.
    expect(spy).not.toHaveBeenCalled()
  })

  it('emits a warning when there is no default export to parse', () => {
    const r = parseComponentDescriptorsFromSource(
      `
      // url=https://example.com
      import figma from 'figma'
      const v = figma.selectedInstance.getString('X')
      // No default export
    `,
      'NoDefault.figma.ts',
    )
    expect(r.warnings?.some((w) => /not the result of figma.code/.test(w))).toBe(true)
  })

  it('warns when the default export is not a figma.code result', () => {
    const r = parseComponentDescriptorsFromSource(
      `
      // url=https://example.com
      import figma from 'figma'
      const v = figma.selectedInstance.getString('X')
      export default { example: 'not figma.code' }
    `,
      'Malformed.figma.ts',
    )
    expect(r.warnings?.some((w) => /not the result of figma.code/.test(w))).toBe(true)
    // The capture still made it through; without a `figma.code` template
    // there's no JSX attr to recover, so `name` falls back to the figma-side
    // prop name (which is also what `label` carries).
    expect(r.descriptors[0].props[0].name).toBe('X')
    expect(r.descriptors[0].props[0].label).toBe('X')
  })

  describe('host-realm Error escape is closed', () => {
    // V8's `codeGeneration: { strings: false }` disable is per-context,
    // not per-realm. A host-realm `Error.constructor.constructor`
    // escape would still execute in the host context where codegen
    // is allowed. The fix wraps every host function exposed to the
    // sandbox with a sandbox-realm boundary that rethrows host
    // throws as sandbox-realm Errors.
    const KEY = 'CC_SANDBOX_HOST_THROW_PROBE'
    const SECRET = 'leaked-' + Math.random().toString(36).slice(2)
    let saved: string | undefined
    beforeAll(() => {
      saved = process.env[KEY]
      process.env[KEY] = SECRET
    })
    afterAll(() => {
      if (saved === undefined) delete process.env[KEY]
      else process.env[KEY] = saved
    })

    function probeWithHostThrow(install: (build: ReturnType<typeof buildMockFigma>) => void, callExpr: string) {
      return transpileAndRun(
        `
        import figma from 'figma'
        let r = 'unreachable'
        try { ${callExpr} } catch (e) {
          try {
            const F = e && e.constructor && e.constructor.constructor
            r = typeof F === 'function' ? F('return process')().env['${KEY}'] : 'no F: ' + typeof F
          } catch (e2) { r = 'F threw: ' + ((e2 && e2.message) || String(e2)) }
        }
        module.exports.default = r
      `,
        { mutateMock: install },
      )
    }

    it('host throw from selectedInstance.findLayers cannot exfiltrate process.env', () => {
      const r = probeWithHostThrow(
        (b) => {
          ;(b.figma as any).selectedInstance.findLayers = function () {
            throw new Error('host-realm boom')
          }
        },
        `figma.selectedInstance.findLayers(() => true)`,
      )
      expect(r.defaultExport).not.toBe(SECRET)
      expect(String(r.defaultExport)).toMatch(/code generation from strings (is disabled|disallowed)/i)
    })

    it('host throw from figma.code cannot exfiltrate process.env', () => {
      const r = probeWithHostThrow(
        (b) => {
          ;(b.figma as any).code = function () {
            throw new Error('code host throw')
          }
        },
        'figma.code`x`',
      )
      expect(r.defaultExport).not.toBe(SECRET)
      expect(String(r.defaultExport)).toMatch(/code generation from strings (is disabled|disallowed)/i)
    })

    it('host throw from helpers.react.jsxElement cannot exfiltrate process.env', () => {
      const r = probeWithHostThrow(
        (b) => {
          ;(b.figma as any).helpers.react.jsxElement = function () {
            throw new Error('jsx host throw')
          }
        },
        `figma.helpers.react.jsxElement(null)`,
      )
      expect(r.defaultExport).not.toBe(SECRET)
      expect(String(r.defaultExport)).toMatch(/code generation from strings (is disabled|disallowed)/i)
    })

    it('host throw from jsxRuntime.jsx cannot exfiltrate process.env', () => {
      const r = probeWithHostThrow(
        (b) => {
          ;(b.jsxRuntime as any).jsx = function () {
            throw new Error('jsxRuntime host throw')
          }
        },
        `require('react/jsx-runtime').jsx('div', {})`,
      )
      expect(r.defaultExport).not.toBe(SECRET)
      expect(String(r.defaultExport)).toMatch(/code generation from strings (is disabled|disallowed)/i)
    })

    it('host throw message still surfaces in the sandbox-realm Error', () => {
      const r = transpileAndRun(
        `
        import figma from 'figma'
        let m = 'no-throw'
        try { figma.selectedInstance.findLayers() } catch (e) { m = e && e.message }
        module.exports.default = m
      `,
        {
          mutateMock: (b) => {
            ;(b.figma as any).selectedInstance.findLayers = function () {
              throw new Error('boundary-test-message')
            }
          },
        },
      )
      // The boundary preserves the message string while sanitizing the realm.
      expect(r.defaultExport).toBe('boundary-test-message')
    })

    it('boundary tolerates a host throw of a non-Error value', () => {
      // String thrown from host — boundary should still produce a
      // sandbox-realm Error rather than letting the raw value cross.
      const r = probeWithHostThrow(
        (b) => {
          ;(b.figma as any).selectedInstance.findLayers = function () {
            // eslint-disable-next-line no-throw-literal
            throw 'raw-string-throw'
          }
        },
        `figma.selectedInstance.findLayers()`,
      )
      expect(r.defaultExport).not.toBe(SECRET)
      // Either codegen-disabled (sandbox Error caught) or no F (no constructor).
      expect(String(r.defaultExport)).toMatch(
        /code generation from strings (is disabled|disallowed)|no F/i,
      )
    })
  })

  describe('sandbox helpers do not pollute globalThis', () => {
    it('only the documented bindings are present on globalThis', () => {
      const r = transpileAndRun(`
        const keys = Object.keys(globalThis).sort()
        module.exports.default = keys
      `)
      expect(r.threw).toBeUndefined()
      // The sandbox should expose ONLY the four bindings we install.
      // No __cloneArr, no __wrapHostFn, no leftover helpers.
      expect(r.defaultExport).toEqual(['console', 'exports', 'module', 'require'])
    })

    it('sandbox cannot enumerate or replace internal helpers', () => {
      const r = transpileAndRun(`
        // Try to find any helper-like name.
        const candidates = ['__cloneArr', '__wrapHostFn', 'cloneArr', 'wrapHostFn']
        const found = candidates.filter((n) => n in globalThis)
        module.exports.default = found
      `)
      expect(r.defaultExport).toEqual([])
    })
  })

  describe('Error.stack does not leak host filesystem paths', () => {
    it('sandbox Error.stack contains only sandbox script frames', () => {
      const r = transpileAndRun(`
        const s = String(new Error('probe').stack || '')
        module.exports.default = {
          hasUsersHomePath: /[\\\\/](Users|home)[\\\\/]/.test(s),
          hasExecuteTemplate: s.includes('execute_template'),
          hasNodeInternal: s.includes('node:internal'),
          hasOurScript: s.includes('sandbox.figma.ts') || s.includes('figma-template'),
          sample: s.slice(0, 300),
        }
      `)
      const out = r.defaultExport as {
        hasUsersHomePath: boolean
        hasExecuteTemplate: boolean
        hasNodeInternal: boolean
        hasOurScript: boolean
        sample: string
      }
      expect(out.hasUsersHomePath).toBe(false)
      expect(out.hasExecuteTemplate).toBe(false)
      expect(out.hasNodeInternal).toBe(false)
      expect(out.hasOurScript).toBe(true)
    })
  })
})
