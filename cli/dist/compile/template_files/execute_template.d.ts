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
import type { FigmaCodeResult } from './figma_code_connect';
interface ExecutionInput {
    /** Already-transpiled CJS source. */
    js: string;
    /** Used for stack traces only. */
    filePath?: string;
    /** Mock figma object passed to `require('figma')`. */
    figma: unknown;
    /** Mock jsx-runtime passed to `require('react/jsx-runtime')`. */
    jsxRuntime: unknown;
    /** Max wall-clock budget. Default 300ms. */
    timeoutMs?: number;
}
interface ExecutionResult {
    /** What `module.exports.default ?? module.exports` evaluated to. */
    defaultExport: unknown;
    /** `figma.code` result (if the default export resolved to one). */
    figmaCode: FigmaCodeResult | undefined;
    /** Set if execution threw — empty string if it threw a non-Error. */
    threw?: string;
    /** Set if execution exceeded the timeout budget. */
    timedOut?: boolean;
    /** Module ids the template tried to require that we didn't resolve. */
    unknownImports: string[];
}
export declare function executeTemplate(input: ExecutionInput): ExecutionResult;
export {};
