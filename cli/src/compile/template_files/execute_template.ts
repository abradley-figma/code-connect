/**
 * Executes a transpiled template's CJS source inside a tightly scoped
 * `vm` context. The sandbox enforces several layers of containment so a
 * malicious or misbehaving template can't reach host capabilities or
 * burn unbounded CPU/memory:
 *
 * 1. **Realm isolation** — `vm.createContext({})` gives the script a
 *    fresh JavaScript realm with its OWN `Object`, `Array`, `Function`,
 *    `Promise`, etc. We do NOT inject the host's intrinsics into the
 *    context — that would let a template `Array.prototype.map = …` and
 *    poison every subsequent `.map()` call in our host process. Each
 *    template gets its own realm, so prototype mutations are scoped to
 *    that one execution and discarded with the context.
 *
 * 2. **V8-level codegen disable** — `codeGeneration: { strings: false,
 *    wasm: false }` on `vm.createContext` disables `eval`,
 *    `Function('…')`, `new Function('…')`, the constructor-walk escape
 *    `(function(){}).constructor('…')` (in all four callable kinds:
 *    function, generator, async, async-generator), AND
 *    `WebAssembly.compile` / `instantiate`, all enforced at the V8
 *    engine level rather than via prototype patching. Caveat: the
 *    disable only applies to codegen invoked *in the sandbox realm*.
 *    See layer (3) for the host-realm side.
 *
 * 3. **Null prototypes on every host-realm object we inject** —
 *    `module`, `exports`, `console`, the require shim, `figma`, and
 *    `jsxRuntime` are all host-realm references. Their prototype
 *    chains terminate in host `Object.prototype`, whose `.constructor`
 *    walks to host `Function` — which V8 codegen disable does NOT
 *    cover, since `Function('…')` invoked through the host-realm
 *    constructor executes in the host realm. We close that path by
 *    setting `Object.setPrototypeOf(injected, null)` so any
 *    `injected.constructor` lookup terminates at `undefined` and
 *    `injected.constructor.constructor(…)` throws TypeError before it
 *    can reach host Function.
 *
 *    The figma + jsxRuntime mocks have a deep static graph
 *    (helpers.react, selectedInstance, propertiesV1, …) — we walk it
 *    once with `nullProtoDeep` so every reachable node has its host
 *    prototype severed.
 *
 * 4. **Sandbox-realm arrays for mock returns** — host arrays returned
 *    by `findConnectedInstances`, `findLayers`, `executeTemplate().example`,
 *    and `figma.code\`…\`.values` (rest-parameter array) are still
 *    constructor-walk vectors: their `.constructor` is host `Array`,
 *    whose `.constructor` is host `Function`, NOT covered by the V8
 *    codegen disable. `patchFigmaMock` installs wrappers that
 *    convert returned host arrays into sandbox-realm arrays via the
 *    sandbox-realm `cloneArr` helper. Sandbox arrays'
 *    `.constructor` chain terminates at the sandbox `Function` —
 *    which IS gated by the V8 disable, so
 *    `arr.constructor.constructor('return process')()` throws
 *    "Code generation from strings disallowed" and the
 *    `process.env` exfiltration path through arrays is closed.
 *
 *    The helpers are captured via `vm.runInContext`'s return value
 *    rather than installed on `globalThis`, so a template can't
 *    enumerate or replace them.
 *
 * 5. **Host-error boundary** — V8's codegen disable is per-context,
 *    not per-realm. Host-realm `Function('…')()` invoked through a
 *    host-realm `Error.constructor.constructor` walk would still
 *    succeed because the host-realm `Function` runs in the host
 *    context, where codegen is allowed. `patchFigmaMock` therefore
 *    wraps every regular host method (in figma + jsxRuntime) with
 *    a sandbox-realm `wrapHostFn` boundary that catches any
 *    host-realm thrown value and rethrows as a sandbox-realm
 *    `Error`. Sandbox-realm Errors' `.constructor` chain terminates
 *    at sandbox `Function` (V8-disabled), closing the
 *    `try { method() } catch (e) {
 *       e.constructor.constructor('return process')() }` escape.
 *    Currently no mock method has a sandbox-controllable throw
 *    site, but this prevents future regressions from becoming
 *    exploitable.
 *
 * 6. **Stack-trace sanitization** — `new Error().stack` exposes V8's
 *    cross-realm frames, which include host filesystem paths
 *    (`/Users/…/cli/src/compile/template_files/…`). The sandbox
 *    helpers install a sandbox-realm `Error.prepareStackTrace`
 *    that filters frames to ones whose filename matches
 *    `figma-template:*` or `*.figma.*`, dropping host paths. This
 *    closes a fingerprinting / information-disclosure channel
 *    (not a credential-exfil one).
 *
 * 7. **Bounded execution time** — `vm.runInContext({ timeout })` aborts
 *    synchronous infinite loops. `microtaskMode: 'afterEvaluate'` on
 *    the context drains microtasks (including Promise.then chains)
 *    inside that same timeout window, so a malicious
 *    `Promise.resolve().then(while(true){})` can't defer work to the
 *    host event loop after the timeout fires.
 *
 * 8. **`require` shim** — only `'figma'` and `'react/jsx-runtime'` (+
 *    its dev variant) resolve to actual modules. Everything else
 *    returns an empty object and gets recorded in `unknownImports` for
 *    the orchestrator to surface. We deliberately do NOT throw on
 *    unknown ids: many templates have transpile-time imports they
 *    never actually call at runtime, and a hard error would force
 *    every parser-side run to align with runtime modules — which the
 *    parser doesn't have. The empty object is null-prototyped, same as
 *    the figma mock, so it isn't a constructor-walk vector.
 *
 * 9. **Locked binding shape** — `module`, `exports`, `require`, and
 *    `console` are installed via `defineProperty(... { writable:
 *    false, configurable: false })` so a template can't replace them
 *    (e.g. `require = somethingElse`). The transpiled CJS template
 *    only ever MUTATES `module.exports.X`, never rebinds the
 *    identifier itself, so legitimate usage is unaffected.
 *
 * 10. **Post-execution Proxy safety** — a template can return any value
 *    as its default export, including a Proxy whose `get` trap throws.
 *    Reading `module.exports.default` then runs that trap in the host,
 *    so the export-extraction logic is wrapped in try/catch and falls
 *    back to `undefined` on throw rather than propagating an unhandled
 *    error.
 *
 * Residual risks (NOT mitigated, accepted by design):
 *
 *  - **Memory exhaustion.** `vm.runInContext` doesn't bound heap
 *    usage. A template that does `'a'.repeat(2**30)` allocates ~1GB
 *    in the host process. Real defense requires a separate worker
 *    thread / process with `resourceLimits.maxOldGenerationSizeMb`,
 *    which adds significant complexity and per-template startup
 *    cost. The CLI is operator-trusted (you ran it), so we accept
 *    this tradeoff.
 *
 *  - **CPU side-channels (timing).** `Date.now()` and the sandbox's
 *    own performance APIs can be used for fingerprinting; we don't
 *    monkey-patch them.
 *
 *  - **Future host-realm mock changes.** `patchFigmaMock` covers
 *    every function-typed property in the static graph at
 *    execution time. If a future change adds a new host function
 *    via a path we don't traverse (e.g. installed via a getter
 *    that returns a fresh function each call), it would bypass the
 *    boundary. Treat the mock as a security-sensitive boundary:
 *    add new methods as plain own properties, not getters / Proxies.
 *
 * Performance (measured on Node 22 / Apple Silicon, steady state
 * after a 50-iteration warmup):
 *
 *   end-to-end executeTemplate (incl. context + helpers + run)
 *     small template  (1 capture, 1 figma.code call)
 *       mean=0.76ms  p50=0.74  p95=0.94  p99=1.49  max=2.46
 *     medium template (10 captures, JSX, enum, mapping)
 *       mean=0.78ms  p50=0.76  p95=0.98  p99=1.53  max=2.80
 *     heavy template  (20 captures, find* arrays, helper wrappers)
 *       mean=0.74ms  p50=0.73  p95=0.86  p99=1.61  max=2.71
 *
 *     ≈ 1300 templates/sec/core; a 1k-template monorepo parses in
 *       ~0.8s of sandbox time.
 *
 *   Per-phase microbench (1000 ops, mean):
 *     vm.createContext (raw)                        115us
 *     buildMockFigma()                                1us
 *     installSandboxHelpers (vm.runInContext IIFE)   ~6us  marginal
 *     executeTemplate small end-to-end              728us
 *
 *   The sandbox hardening (helper install + patchFigmaMock graph
 *   walk + per-call try/catch wrappers) accounts for <1% of
 *   end-to-end cost. The dominant cost is `vm.createContext` —
 *   V8 setting up a fresh JS realm — which is required for
 *   security (per-execution realm isolation). We deliberately do
 *   NOT cache contexts across templates: a reused context would
 *   let one template's mutations / globals leak into the next.
 *
 *   If throughput ever needs to exceed ~1300/s on a single core,
 *   the next levers are (1) precompiling the helper IIFE as a
 *   `vm.Script` (saves ~6us/run), (2) parallelism via
 *   `worker_threads`, NOT context reuse.
 */

import vm from 'node:vm'
import type { FigmaCodeResult } from './figma_code_connect'
import { isFigmaCodeResult } from './figma_code_connect'

interface ExecutionInput {
  /** Already-transpiled CJS source. */
  js: string
  /** Used for stack traces only. */
  filePath?: string
  /** Mock figma object passed to `require('figma')`. */
  figma: unknown
  /** Mock jsx-runtime passed to `require('react/jsx-runtime')`. */
  jsxRuntime: unknown
  /** Max wall-clock budget. Default 300ms. */
  timeoutMs?: number
}

interface ExecutionResult {
  /** What `module.exports.default ?? module.exports` evaluated to. */
  defaultExport: unknown
  /** `figma.code` result (if the default export resolved to one). */
  figmaCode: FigmaCodeResult | undefined
  /** Set if execution threw — empty string if it threw a non-Error. */
  threw?: string
  /** Set if execution exceeded the timeout budget. */
  timedOut?: boolean
  /** Module ids the template tried to require that we didn't resolve. */
  unknownImports: string[]
}

const DEFAULT_TIMEOUT_MS = 300

/**
 * Build a hardened sandbox context. Layered defense:
 *
 *  - `vm.createContext({})` gives the realm its own intrinsics
 *    (Object, Array, JSON, Math, Map, Set, Promise, …) — those are
 *    realm-isolated, so prototype mutations from inside the sandbox
 *    can't reach the host.
 *  - `codeGeneration: { strings: false, wasm: false }` disables
 *    `eval`, `Function('…')`, `(fn).constructor('…')`, and
 *    `WebAssembly.compile` at the V8 engine level for all sandbox-
 *    realm code. This is more thorough than prototype patching —
 *    V8 enforces it regardless of which prototype chain the script
 *    walks to find a Function constructor.
 *  - `microtaskMode: 'afterEvaluate'` drains queued Promise.then
 *    microtasks inside the `runInContext` timeout window so the
 *    template can't escape the wall-clock budget by deferring work
 *    to the host event loop.
 *
 * Then we inject only the bindings the CJS-transpiled template
 * requires (`module`, `exports`, `require`, `console`), each
 * null-prototyped to close the host-realm constructor-walk escape and
 * locked with `writable: false, configurable: false` so the template
 * can't rebind them.
 */
function buildSandbox(opts: {
  module: { exports: Record<string, unknown> }
  exports: Record<string, unknown>
  require: NodeRequire
}): vm.Context {
  const consoleStub = {
    log: () => { },
    warn: () => { },
    error: () => { },
    info: () => { },
    debug: () => { },
  }
  Object.setPrototypeOf(consoleStub, null)
  Object.freeze(consoleStub)

  const ctx = vm.createContext(
    {},
    {
      name: 'figma-template',
      microtaskMode: 'afterEvaluate',
      codeGeneration: { strings: false, wasm: false },
    },
  )

  Object.defineProperties(ctx, {
    module: { value: opts.module, writable: false, configurable: false, enumerable: true },
    exports: { value: opts.exports, writable: false, configurable: false, enumerable: true },
    require: { value: opts.require, writable: false, configurable: false, enumerable: true },
    console: { value: consoleStub, writable: false, configurable: false, enumerable: true },
  })

  return ctx
}

export function executeTemplate(input: ExecutionInput): ExecutionResult {
  const unknownImports: string[] = []

  const moduleObj = { exports: {} as Record<string, unknown> }
  Object.setPrototypeOf(moduleObj, null)
  Object.setPrototypeOf(moduleObj.exports, null)

  const requireShim = ((id: string) => {
    if (id === 'figma') return input.figma
    if (id === 'react/jsx-runtime' || id === 'react/jsx-dev-runtime') return input.jsxRuntime
    // Tolerate but record. Returning a null-prototype empty object lets
    // `const _ = require('foo')` not blow up, and prevents the result
    // from being a constructor-walk vector. Chains off the result yield
    // `undefined`, so any template that *actually* depends on the
    // missing module fails loudly on first use.
    unknownImports.push(id)
    return Object.create(null)
  }) as unknown as NodeRequire
  Object.setPrototypeOf(requireShim, null)

  const sandbox = buildSandbox({
    module: moduleObj,
    exports: moduleObj.exports,
    require: requireShim,
  })

  // Install sandbox-realm helpers and patch the mocks. Order matters:
  //  1. Helpers must come first — they're the building blocks.
  //  2. patchFigmaMock installs the array-conversion wrappers AND
  //     wraps every regular method with the host-error boundary, so
  //     no host-realm throw can carry e.constructor.constructor back
  //     into the sandbox.
  //  3. nullProtoDeep severs host `Object.prototype` reachability on
  //     the static graph, including the new wrapper functions
  //     installed in step 2.
  const helpers = installSandboxHelpers(sandbox)
  patchFigmaMock(input.figma, input.jsxRuntime, helpers)
  nullProtoDeep(input.figma)
  nullProtoDeep(input.jsxRuntime)

  try {
    vm.runInContext(input.js, sandbox, {
      filename: input.filePath ?? 'figma-template.figma.ts',
      timeout: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      displayErrors: false,
      breakOnSigint: true,
    })
  } catch (err) {
    // `vm.runInContext` throws a special `Error: Script execution timed out`
    // when `timeout` fires; surface that separately so the orchestrator can
    // emit a friendlier warning.
    const message = err instanceof Error ? err.message : String(err)
    const timedOut = /timed out/i.test(message)
    return {
      defaultExport: undefined,
      figmaCode: undefined,
      unknownImports,
      threw: message,
      timedOut: timedOut || undefined,
    }
  }

  // Reading `module.exports.default` (or any property) on a template-supplied
  // value can run arbitrary user code — e.g. a `new Proxy({}, { get() { throw } })`
  // returned as the export. Catch and treat as a failed extraction so the
  // orchestrator gets a structured result instead of an unhandled throw.
  try {
    const exports = moduleObj.exports
    let defaultExport: unknown = (exports as any).default
    if (defaultExport === undefined) {
      // If exports has only one own property and it's not __esModule, take it.
      const keys = Object.keys(exports).filter((k) => k !== '__esModule')
      if (keys.length === 1) defaultExport = (exports as any)[keys[0]]
      else if (keys.length === 0) {
        defaultExport = undefined
      } else {
        defaultExport = exports
      }
    }

    return {
      defaultExport,
      figmaCode: extractFigmaCode(defaultExport),
      unknownImports,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      defaultExport: undefined,
      figmaCode: undefined,
      unknownImports,
      threw: `failed to read module.exports: ${message}`,
    }
  }
}

/**
 * The documented canonical export shape is:
 *
 *   export default {
 *     example: figma.code`<MyComponent ... />`,
 *     imports: ['import MyComponent from "./MyComponent"'],
 *     id: 'my-component',
 *     metadata: { nestable: true },
 *   }
 *
 * (see https://developers.figma.com/docs/code-connect/template-files/).
 * Older fixtures and the simpler form also support a bare
 * `export default figma.code\`...\`` value. Accept both: peel one layer
 * of `.example` if it's there.
 *
 * Wrapped in try/catch — if `value` is a sandbox-realm Proxy with a
 * throwing `get` trap, the property access can throw arbitrary user
 * code at us. Treat any throw as "no figma.code result".
 */
function extractFigmaCode(value: unknown): FigmaCodeResult | undefined {
  try {
    if (isFigmaCodeResult(value)) return value
    if (value && typeof value === 'object') {
      const example = (value as { example?: unknown }).example
      if (isFigmaCodeResult(example)) return example
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * Walk the object graph rooted at `value` and set `prototype = null`
 * on every host-realm object/function reachable through enumerable
 * own keys. Idempotent and cycle-safe (`seen` guards re-entry).
 *
 * Why: a host-realm object whose prototype chain ends in host
 * `Object.prototype` is a reachable path to host `Function` via
 * `.constructor.constructor`, and host-realm Function is NOT gated by
 * the sandbox's V8 codegen disable. Severing the prototype chain
 * makes `obj.constructor` evaluate to `undefined`, which short-
 * circuits the walk before any code synthesis can happen.
 *
 * Skips arrays — they need their `Array.prototype` chain so legitimate
 * templates can call `.map()` / `.filter()`. Host-realm arrays are
 * instead converted to sandbox-realm arrays by `wrapMockArrayReturns`
 * before they cross the boundary; sandbox arrays' `.constructor` chain
 * terminates at the sandbox `Function` constructor, which IS gated by
 * the V8 codegen disable.
 *
 * Also skips any object whose prototype can't be set (frozen, sealed,
 * non-extensible, or a Proxy with a throwing `setPrototypeOf` trap).
 */
function nullProtoDeep(value: unknown, seen: WeakSet<object> = new WeakSet()): void {
  if (value === null) return
  const t = typeof value
  if (t !== 'object' && t !== 'function') return
  const obj = value as object
  if (seen.has(obj)) return
  seen.add(obj)

  if (!Array.isArray(obj)) {
    try {
      Object.setPrototypeOf(obj, null)
    } catch {
      // Frozen / sealed / non-extensible / Proxy that throws on
      // setPrototypeOf — leave alone.
    }
  }

  for (const key of Reflect.ownKeys(obj)) {
    let val: unknown
    try {
      val = (obj as Record<string | symbol, unknown>)[key as string]
    } catch {
      continue
    }
    nullProtoDeep(val, seen)
  }
}

/**
 * Sandbox-realm helpers we install once per execution. Each is a
 * sandbox-realm function whose `.constructor` chain terminates at
 * the sandbox `Function` constructor (which IS gated by the V8
 * codegen disable), so any hostile constructor-walk through these
 * helpers terminates at "Code generation from strings disallowed".
 *
 *  - `cloneArr(hostArr)` — copies a host-realm array's contents
 *    into a fresh sandbox-realm array. Closes the
 *    `findLayers().constructor.constructor('return process')()`
 *    style escape that exfiltrates `process.env`.
 *
 *  - `wrapHostFn(hostFn)` — wraps a host-realm function so it
 *    catches any host-realm thrown value and rethrows as a
 *    sandbox-realm `Error`. Closes the
 *    `try { hostFnThatThrows() } catch (e) {
 *       e.constructor.constructor('return process')() }` escape:
 *    sandbox-realm `Error.constructor` chain terminates at sandbox
 *    `Function`, which IS gated by the V8 disable.
 *
 *  - `sanitizeStack()` — installs a sandbox-realm
 *    `Error.prepareStackTrace` that strips host-filesystem frames
 *    from `new Error().stack`, preventing information disclosure
 *    of the CLI's source layout.
 *
 * The helpers are installed via `vm.runInContext` and CAPTURED via
 * its return value rather than via `globalThis`. The sandbox can't
 * see them, can't replace them, can't iterate to them.
 */
interface SandboxHelpers {
  cloneArr: (host: unknown[]) => unknown[]
  wrapHostFn: <F extends Function>(fn: F) => F
}

function installSandboxHelpers(sandbox: vm.Context): SandboxHelpers {
  const helpers = vm.runInContext(
    `(function () {
       var ObjectFreeze = Object.freeze
       function cloneArr (host) {
         var out = []
         var len = (host && host.length) | 0
         for (var i = 0; i < len; i++) out[i] = host[i]
         return out
       }
       function wrapHostFn (hostFn) {
         return function () {
           try { return hostFn.apply(this, arguments) }
           catch (e) {
             // Read \`e.message\` defensively — \`e\` may be a host-realm
             // value with a throwing getter. Fall back to a fixed
             // string if reading throws or if the value isn't an object.
             var msg = 'host call threw'
             try {
               if (e != null && typeof e === 'object' && typeof e.message === 'string') {
                 msg = e.message
               } else if (typeof e === 'string') {
                 msg = e
               }
             } catch (_) { /* keep default msg */ }
             // Construct the rethrown Error here — it's sandbox-realm,
             // so e.constructor.constructor is sandbox Function (V8-disabled).
             throw new Error(msg)
           }
         }
       }
       // Strip host-filesystem frames from Error.stack so the
       // sandbox can't fingerprint the CLI's source layout.
       Error.prepareStackTrace = function (err, frames) {
         var lines = [String(err)]
         for (var i = 0; i < frames.length; i++) {
           var f = frames[i]
           var fileName
           try { fileName = f.getFileName() } catch (_) { fileName = null }
           if (typeof fileName !== 'string') continue
           // Allow only frames whose filename is the script we ran
           // (figma-template:* or the explicit input.filePath). Drop
           // every other frame — host paths, node:internal frames,
           // anonymous callbacks from host functions.
           if (fileName.indexOf('figma-template') === 0 || fileName.indexOf('.figma.') >= 0) {
             var line, col, fn
             try { line = f.getLineNumber() } catch (_) { line = '?' }
             try { col = f.getColumnNumber() } catch (_) { col = '?' }
             try { fn = f.getFunctionName() || '<anonymous>' } catch (_) { fn = '<anonymous>' }
             lines.push('    at ' + fn + ' (' + fileName + ':' + line + ':' + col + ')')
           }
         }
         return lines.join('\\n')
       }
       return ObjectFreeze({ cloneArr: cloneArr, wrapHostFn: wrapHostFn })
     })()`,
    sandbox,
    { filename: 'figma-template:install-helpers', timeout: 50, displayErrors: false },
  )
  return helpers as SandboxHelpers
}

/**
 * Patch the figma mock so:
 *
 *  1. Every method that returns a host-realm array returns a
 *     SANDBOX-realm array instead — closes the
 *     `findLayers().constructor.constructor('return process')()`
 *     escape via host `Array.prototype`.
 *
 *  2. Every regular host method is wrapped with a sandbox-realm
 *     boundary that converts any host-realm thrown value into a
 *     sandbox-realm `Error` — closes the
 *     `try { method() } catch (e) { e.constructor.constructor('…')() }`
 *     escape. Currently NO mock method has a sandbox-controllable
 *     throw site (audited in `figma_code_connect.ts`), but this
 *     defense-in-depth prevents a future regression from becoming
 *     an exploitable boundary.
 *
 * The two transformations compose: the array wrappers themselves
 * are wrapped by `wrapHostFn`, so a hypothetical throw from
 * `cloneArr` or the original method also goes through the
 * boundary.
 *
 * Targets for array conversion:
 *  - `selectedInstance.findConnectedInstances(…)` → `[]`
 *  - `selectedInstance.findLayers(…)` → `[]`
 *  - `selectedInstance.executeTemplate().example` → `[]`
 *  - `figma.code\`…\`.values` (and language aliases
 *    `tsx`/`html`/`swift`/`kotlin`) — the rest-parameter values
 *    array is a host-realm allocation
 *
 * Targets for error wrapping: every function-typed property in the
 * figma + jsxRuntime static graph, EXCLUDING the proxy-typed paths
 * (`figma.batch`) which need their proxy traps intact and aren't
 * regular callable methods. Proxies returned at runtime
 * (`tokenProxy`, `chainStub`) live behind `getPrototypeOf: null`
 * traps and are covered by Layer 3 (null prototypes), not by the
 * boundary.
 */
function patchFigmaMock(figma: unknown, jsxRuntime: unknown, helpers: SandboxHelpers): void {
  if (!figma || typeof figma !== 'object') return
  const { cloneArr, wrapHostFn } = helpers

  const f = figma as Record<string, unknown>

  // 1. Array-return wrappers — installed BEFORE wrapHostFn so the
  //    wrappers themselves get error-boundaried.
  const inst = f.selectedInstance as Record<string, unknown> | undefined
  if (inst) {
    for (const m of ['findConnectedInstances', 'findLayers'] as const) {
      const orig = inst[m]
      if (typeof orig === 'function') {
        inst[m] = function (...args: unknown[]) {
          const r = (orig as Function).apply(inst, args)
          return Array.isArray(r) ? cloneArr(r) : r
        }
      }
    }
    const origExec = inst.executeTemplate
    if (typeof origExec === 'function') {
      inst.executeTemplate = function (...args: unknown[]) {
        const r = (origExec as Function).apply(inst, args) as Record<string, unknown> | undefined
        if (r && Array.isArray(r.example)) {
          r.example = cloneArr(r.example as unknown[])
        }
        return r
      }
    }
  }

  for (const k of ['code', 'tsx', 'html', 'swift', 'kotlin'] as const) {
    const orig = f[k]
    if (typeof orig === 'function') {
      f[k] = function (...args: unknown[]) {
        const r = (orig as Function).apply(f, args) as Record<string, unknown> | undefined
        if (r && Array.isArray(r.values)) {
          r.values = cloneArr(r.values as unknown[])
        }
        return r
      }
    }
  }

  // 2. Walk both static graphs and replace every regular function
  //    value with `wrapHostFn(fn)`. The skip set names the keys
  //    whose values are Proxies whose traps (rather than `apply`-as-
  //    a-callable) are the contract — wrapping them in a function
  //    would lose the trap behavior.
  const seen = new WeakSet<object>()
  const skip = new Set<string>(['batch'])
  walkAndWrapFunctions(figma, wrapHostFn, skip, seen)
  walkAndWrapFunctions(jsxRuntime, wrapHostFn, skip, seen)
}

function walkAndWrapFunctions(
  obj: unknown,
  wrap: <F extends Function>(fn: F) => F,
  skip: Set<string>,
  seen: WeakSet<object>,
): void {
  if (!obj) return
  const t = typeof obj
  if (t !== 'object' && t !== 'function') return
  const o = obj as Record<string | symbol, unknown>
  if (seen.has(o)) return
  seen.add(o)

  for (const key of Reflect.ownKeys(o)) {
    if (typeof key === 'string' && skip.has(key)) continue
    let v: unknown
    try {
      v = o[key]
    } catch {
      continue
    }
    if (typeof v === 'function') {
      // Replace in place. The wrapper preserves the call shape
      // (`apply(this, arguments)`) so consumers see the same
      // behavior, just with host throws converted to sandbox
      // throws at the boundary.
      try {
        o[key] = wrap(v as Function)
      } catch {
        // Property is non-writable / non-configurable — leave alone.
        // Unlikely on the mock since nothing freezes its methods.
      }
    } else if (v && typeof v === 'object') {
      walkAndWrapFunctions(v, wrap, skip, seen)
    }
  }
}
