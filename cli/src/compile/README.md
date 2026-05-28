# Code Connect Compiler

Build-time compiler for Code Connect template files (any of `.figma.ts`,
`.figma.tsx`, `.figma.js`, `.figma.jsx`, or the legacy
`.figma.template.{ts,tsx,js,jsx}` form) and the runtime shim that ships their
prop metadata to the browser as `window.figmaCodeConnect.getComponentDescriptor`.

The compiler is the shared core that every bundler adapter wraps. Today it
implements the code-component descriptor scanner; future Code Connect
build-time features will plug into the same `createCompiler()` instance.

The runtime shim is wired into the user's bundle by an explicit
`import '@figma/code-connect/register'` statement that the user adds to
their app entry (`src/main.tsx`, `pages/_app.tsx`, `app/layout.tsx`,
etc.). The bundler adapters (Vite, Webpack, Next.js, esbuild) intercept
that specifier and route it to the GENERATED runtime shim populated with
the project's descriptors. Each adapter exposes an `enabled?: boolean`
option that defaults to "enabled in dev mode, disabled in production"
using the bundler's native dev/prod signal (Vite's `command`, Webpack's
`compiler.options.mode`, Next/esbuild/prepare's `process.env.NODE_ENV`).
Pass an explicit boolean to override. When the adapter resolves to
disabled it becomes a complete no-op and the same import resolves to an
empty placeholder via normal Node resolution — so production bundles
ship zero runtime code by default.

> ⚠️ This module is **internal**. It is not exposed as a `@figma/code-connect/*`
> subpath. Consumers should import one of the bundler adapters instead:
>
> - `@figma/code-connect/vite`
> - `@figma/code-connect/webpack` — also works with Rspack as-is, since
>   Rspack's `Compiler` is structurally identical to webpack's for every
>   surface we touch (`beforeCompile`/`afterCompile`/`watchRun` hooks,
>   `resolve.alias`, `compilation.fileDependencies.add`). Rspack users
>   should import from `@figma/code-connect/webpack`.
> - `@figma/code-connect/esbuild`
> - `@figma/code-connect/nextjs`
> - `@figma/code-connect/prepare` — headless prepare helper for any other
>   bundler (Parcel, Rollup, Snowpack, Bun, custom scripts).
>
> The runtime fallback (`@figma/code-connect/register`) is an intentionally
> empty module — it lets the import statement resolve when no adapter is
> wired up, but installs no `window.figmaCodeConnect` so misconfiguration
> surfaces loudly the first time something tries to read it.

---

## What it does

Every `.figma.{ts,tsx,js,jsx}` template file in a user's project declares
prop metadata about a component, e.g.:

```ts
// url=https://figma.com/design/abc?node-id=1:1
import figma from "figma";

const variant = figma.selectedInstance.getEnum("Variant", {
  Primary: "primary",
  Danger: "danger",
});
const disabled = figma.selectedInstance.getBoolean("Disabled");

export default figma.code`<Button variant={${variant}} disabled={${disabled}} />`;
```

This compiler turns each template file into a `ComponentDescriptor`. Each
prop is a flat `PropDescriptor` discriminated on `type`:

```ts
{
  componentName: 'Button',
  // Resolved source path of the React component itself (NOT the .figma.ts
  // template). The runtime shim looks up descriptors by this value, matched
  // against the bundler-supplied `_debugSource.fileName` for a component.
  // Resolved at parse time from (in priority order):
  // a // source= directive, a matching imports[] entry, or sibling probe.
  filePath: '/abs/path/to/Button.tsx',
  props: [
    {
      // `name` is the JSX attribute (recovered from the `figma.code`
      // template); `label` is the figma-side property name (the argument
      // to `getEnum('Variant', …)`).
      name: 'variant',
      label: 'Variant',
      type: 'enum',
      options: [
        { value: 'primary', label: 'Primary' },
        { value: 'danger',  label: 'Danger'  },
      ],
    },
    {
      name: 'disabled',
      label: 'Disabled',
      type: 'boolean',
    },
  ],
}
```

…and serializes the full set into a JS module that, when imported in the
browser bundle, installs `window.figmaCodeConnect.getComponentDescriptor`
for the host environment to call.

Template-file discovery is done directly inside `compiler.ts#build`
by composing three exports from `cli/src/connect/project.ts`:
`parseOrDetermineConfig` (loads `figma.config.json`),
`resolveTemplateGlobs` (resolves the include/exclude with the
templates-only defaults layered in), and `discoverFilesByGlob`
(runs the actual glob against the project root). The compile pipeline
owns zero discovery defaults — both the default glob arrays and the
config-file loader live in connect. If the project has a
`figma.config.json` (the same one `figma connect publish` / `parse`
consume), the user's `codeConnect.include` / `codeConnect.exclude` are
honored automatically — adapter users don't need to duplicate that
configuration in their bundler plugin. When no config is present the
templates-only defaults baked into connect's `resolveTemplateGlobs`
apply: `.figma.ts`, `.figma.js`, `.figma.template.ts`,
`.figma.template.js`, `.figma.batch.json` for include;
`node_modules/**` for exclude. Users who want JSX template files
(`.figma.tsx` / `.figma.jsx`) or who want to skip build-cache
directories (`dist/`, `.next/`, etc.) opt in via
`figma.config.json#codeConnect.include` / `.exclude` — there is no
adapter-side override knob on purpose, so the bundler pipeline and
`figma connect publish` agree on the file set without two sources of
truth to keep in sync.

The same `isTemplateFilePath` predicate connect exposes for its own
purposes is what the compiler calls from `updateFile` to decide whether
a changed file should trigger a re-parse — so the no-I/O HMR fast path
and the on-disk full discovery always agree on what counts as a
template file. The compiler caches the resolved globs returned by
`resolveTemplateGlobs` on the first `build()` so the predicate doesn't
have to re-read the config on every file save.

## Scope

In scope (v1):

- `.figma.{ts,tsx,js,jsx}` template files (modern) and
  `.figma.template.{ts,tsx,js,jsx}` (the explicit-extension variant). A
  file is considered a candidate template purely by its extension matching
  one of the include globs resolved by `resolveTemplateGlobs` in
  `cli/src/connect/project.ts`. There is no separate recognition step —
  every candidate that does not contain a `figma.connect(` call is run
  through the full pipeline, and the VM sandbox is responsible for
  handling non-template files gracefully (they simply produce zero
  descriptors).
- Multiple feature passes share a single `createCompiler()` instance.
  Today only the code-component descriptor scanner runs; planned
  follow-ups (e.g. design-token scanning) will append to the same
  pipeline rather than spawn a peer factory.
- The optional metadata directives `// url=…`, `// component=…`, and
  `// source=…` are extracted by `extractMetadata` (defined inline in
  `parse_template_file_source.ts`) when present and surfaced on the
  `ParseResult` for the panel's use, but they are NOT a gating
  condition on whether a file is parsed.
- The five `figma.selectedInstance.getX` capture methods: `getString`,
  `getBoolean`, `getEnum`, `getInstanceSwap`, `getSlot`. The legacy V1
  `figma.properties.{string,boolean,enum,instance,slot}` API is also
  supported and routed through the same capture pipeline.
- The tagged-template language aliases ` figma.code\``,  `figma.tsx\``,
`figma.html\``, `figma.swift\``, `figma.kotlin\``are all accepted as
the default export.`extract_jsx_info` extracts the root JSX tag + JSX
  attribute → capture binding from any of them; non-JSX languages will
  produce no attribute bindings and the parser falls back to figma-side
  prop names.

Explicitly out of scope (v1):

- Legacy `figma.connect()` Code Connect files. These are detected and emit a
  one-line migration warning; the compiler produces zero descriptors for them.
- Snippet rendering of `figma.code\`…\`` to actual code strings.
- Enumerating multiple branches of a conditional template.

## Architecture

The compiler uses **runtime evaluation in a sandboxed `node:vm` context**, not
static AST analysis. The pipeline is pure: `(source: string, opts) →
{ descriptors, warnings, metadata }`. No file system reads.

```
              ┌────────────┐
source ──►    │ legacy-skip│── source.includes('figma.connect(') ?
              └─────┬──────┘     yes → bail with migrate-warning
                    │            no  → continue
              ┌─────▼──────┐
              │  metadata  │── url= / component= / source= directives
              │ (inline in │   (extractMetadata, in
              │ parse_*.ts)│    parse_template_file_source.ts)
              └─────┬──────┘
              ┌─────▼──────┐
              │ transpile  │── ts.transpileModule → CJS, JSX preserved
              └─────┬──────┘
              ┌─────▼──────┐
              │ figma_code │── recording in-process `figma` global
              │ _connect   │   (capture tokens, jsx-runtime stub)
              └─────┬──────┘
              ┌─────▼──────┐
              │ execute_   │── vm.runInContext, 300ms budget, hardened
              │ template   │   sandbox; require shim resolves only
              └─────┬──────┘   `figma` and `react/jsx-runtime`
              ┌─────▼──────┐
              │ recover_   │── walk figma.code strings/values to map
              │ joins      │   each capture token to a JSX attr name
              └─────┬──────┘
              ┌─────▼──────┐
              │ name_      │── component= → JSX root → file basename
              │ inference  │
              └─────┬──────┘
              ┌─────▼──────┐
              │ resolve_   │── // source= → imports[] match → sibling probe
              │ component_ │   (sets descriptor.filePath to the React
              │ source     │    component's source path, NOT the template)
              └─────┬──────┘
                    ▼
            ComponentDescriptor
```

### Why runtime evaluation?

A `.figma.{ts,js}` template is real, executable JavaScript. Static AST analysis
would have to reimplement every possible TS expression shape (generics,
`satisfies`, spreads, computed keys, helpers, etc.). Running the template in
a controlled VM lets the JS engine handle all of that for us. The trade-offs:

- **Pros:** robust to arbitrary TS syntax; future-proof against template-file
  feature growth.
- **Cons:** requires a sandbox boundary. We use `node:vm` with a hardened
  context (no `process`/`fs`/`fetch`/`setTimeout`, V8 codegen disabled,
  null-prototyped host injections, sandbox-realm error boundary), a 300ms
  timeout, and a `require` shim that resolves only `'figma'` and
  `'react/jsx-runtime'`. See `template_files/execute_template.ts` for the
  full layered defense; the file's header documents each layer plus
  measured performance numbers.
- **Trade-off accepted:** captures inside unreached conditional branches are
  silently missing from the descriptor. We don't statically pre-scan for
  call sites — branch-sensitive prop coverage is a v2 concern.

## Module map

```
cli/src/compile/
├── index.ts                ← re-exports for adapters (just createCompiler + its types)
├── types.ts                ← Compiler / PropDescriptor / ComponentDescriptor / CodeConnectManifest
├── compiler.ts             ← createCompiler({...}) — the one entry point adapters use. Owns discovery: calls parseOrDetermineConfig + resolveTemplateGlobs + discoverFilesByGlob from cli/src/connect/project.ts on first build(), caches the resolved globs for HMR. The default glob arrays (inline literals inside resolveTemplateGlobs) and the no-I/O HMR predicate (isTemplateFilePath) all live in cli/src/connect/project.ts. Path normalization (normalizePath / normalizeRelativePath / normalizeResolvePath) lives in cli/src/common/path.ts.
├── build.ts                ← read + parse pass driven by createCompiler().build(); takes a pre-discovered file list, returns warnings + the disappear-cleanup-tracked set
├── transpile.ts            ← ts.transpileModule → CJS (forces .tsx so JSX in enum mappings survives)
├── runtime.ts              ← generateManifest / generateRuntimeShim / emitRuntimeModule + the IIFE template
├── register.ts             ← empty fallback module backing the public `/register` subpath when no bundler adapter is wired
└── template_files/         ← code-component-descriptor feature: scans .figma.{ts,tsx,js,jsx}
    ├── parse_template_file_source.ts ← orchestrator (pure: string → ParseResult); legacy-skip + // url=/component=/source= directive extraction live inline
    ├── component_descriptor_store.ts ← ComponentDescriptorStore — in-memory store + snapshot
    ├── figma_code_connect.ts ← recording `figma` global + jsx-runtime stub
    ├── execute_template.ts ← vm.runInContext wrapper (hardened sandbox)
    ├── extract_jsx_info.ts ← root tag + JSX-attr → token map
    ├── component_name_inference.ts   ← directive → JSX root → basename
    └── resolve_component_source.ts   ← // source= → imports[] match → sibling probe
```

## Output contract

Both output modes produce byte-identical JS source. Each adapter holds one
`ComponentDescriptorStore` and decides whether to:

- **Virtual-module mode** (Vite): respond to a resolution of
  `virtual:@figma/code-connect/register` with `codeConnectCompiler.generateRuntimeShim()`.
- **Emitted-file mode** (Webpack, Next.js, esbuild, headless `prepare`): call
  `codeConnectCompiler.emitRuntimeModule()` to write the shim to
  `<root>/node_modules/.cache/figma-code-connect/runtime.js` and install a
  path alias mapping `@figma/code-connect/register` to that file. The
  `.cache/` segment is load-bearing — Webpack 5's default
  `snapshot.managedPaths` regex explicitly excludes `node_modules/.cache/`
  (the regex contains `(?!\.cache|\.pnpm)`), so the emitted runtime gets
  content+mtime snapshots instead of immutable package-version snapshots.
  Without that carve-out a `.figma.ts` change wouldn't invalidate the
  cached runtime module on rebuild. See `resolveRuntimeFilePath` in
  `runtime.ts` for the full reasoning and alternatives considered.

The emitted source has two halves:

```js
// 1. The data — the CodeConnectManifest object. `componentDescriptors`
//    is a flat ComponentDescriptor[]; each entry's `filePath` is the
//    React component's project-relative POSIX source path (NOT the
//    .figma.ts template path). Sorted by (componentName, filePath) for
//    stable serialization.
// 2. The shim — installs window.figmaCodeConnect.getComponentDescriptor
//    with a three-tier lookup:
//      1. exact match on (componentName, filePath)
//      2. path-boundary suffix match (absorbs Vite vs Webpack vs manifest path drift)
//      3. name-only match
```

### How descriptors are looked up

The host environment extracts `{ componentName, filePath }` (typically
from React's `_debugSource`) and asks the runtime shim for a descriptor.
To keep that contract working across bundlers and project layouts, the
compiler does two things:

1. **Resolves the React component's source path at parse time** — see
   `template_files/resolve_component_source.ts`. The result lands on
   `ComponentDescriptor.filePath` (project-relative POSIX after
   `snapshot(root)`). Resolution priority:

   | Tier                      | Source                                                                                                                   | Behaviour                                                                                                                                                         |
   | ------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | 1. `// source=` directive | `// source=./Button.tsx` magic comment in the template, parsed by `extractMetadata` (in `parse_template_file_source.ts`) | **Authoritative**. Filesystem-shaped values (relative or absolute) are probed against `.tsx → .jsx → .ts → .js`. `http(s)://` values are skipped (metadata-only). |
   | 2. `imports[]` match      | Default-import entries on the canonical `{ example, imports, ... }` export                                               | First entry whose default name equals `componentName`. Bare specifiers (`@scope/x`) and named/namespace/side-effect imports are skipped.                          |
   | 3. Sibling probe          | `<dir>/<basename>.{tsx,jsx,ts,js}` next to the template                                                                  | TS-first extension order. Covers the canonical layout the docs recommend without requiring an `imports[]` array.                                                  |
   | 4. No-resolve             | —                                                                                                                        | `descriptor.filePath` is left `undefined`; the runtime shim's name-only fallback still works.                                                                     |

2. **Forgives bundler path drift on the lookup side** — the shim's
   suffix-match tier means a manifest entry with `filePath: 'src/Button.tsx'`
   resolves both Vite-style needles (`/src/Button.tsx`) and Webpack-style
   ones (`/abs/proj/src/Button.tsx`). Suffix matches are anchored to the
   `/` path-segment boundary so `rc/Button.tsx` won't falsely match
   `/abs/src/Button.tsx`.

The shim is SSR-safe (`typeof window === 'undefined'` short-circuit). It
installs `window.figmaCodeConnect = { getComponentDescriptor }` only — the
descriptor map lives in a closure and is not reachable from outside. Every
bundler we ship for dedupes the runtime module, so the shim runs exactly
once per app. If multiple independent bundles each load the runtime (e.g.
Module Federation, micro-frontends), the last one to load wins.

## Adapter authoring rules

1. **Zero bundler imports.** Every adapter defines a minimal local interface
   that the bundler's real `Plugin` shape is structurally compatible with.
2. **Zero new runtime dependencies.** The compiler uses only existing repo
   dependencies (`typescript`, `glob`, `minimatch`) and Node builtins
   (`node:vm`, `node:fs`, `node:crypto`, `node:path`). Bundlers may appear in
   `devDependencies` for test-only type compatibility checks.
3. **One compiler per adapter.** Call `createCompiler({...})` once at
   plugin construction and store it on a local named
   `codeConnectCompiler` (the conventional name disambiguates against
   each bundler's own `compiler` parameter). Reach for `setRoot`,
   `build`, `getDiscoveredFiles`, `generateManifest`,
   `generateRuntimeShim`, `getRuntimeAlias`, `getRuntimeFilePath`,
   `updateFile`, and `emitRuntimeModule` — that is the full surface.
   Do not import `ComponentDescriptorStore`,
   `parseComponentDescriptorsFromSource`, `isTemplateFilePath`, or
   `resolveRuntimeFilePath` directly. Do not stash build state (file
   lists, descriptor maps, fingerprints) on the adapter — query the
   compiler instead.
4. **Don't track lifecycle state in the adapter.** The compiler owns the
   "initialized" lifecycle: `generateRuntimeShim()` serves a valid empty
   no-op shim pre-`build`, and `updateFile()` reports
   `{ type: 'no-config' }` pre-`build` (the compiler hasn't loaded
   `figma.config.json` yet, so it can't classify the path). Adapters
   call these methods without first checking "has buildStart run yet?".
   The `updateFile` result also discriminates non-template files
   (`type: 'unknown-file'`) so the adapter does not have to gate on a
   separate predicate.

### Minimal adapter skeleton

```ts
import { createCompiler } from "../compile";

// Template-file include / exclude globs come from
// `figma.config.json#codeConnect` (same as `figma connect publish`).
// There are no adapter-side override knobs on purpose.
const codeConnectCompiler = createCompiler({
  root: opts.root,
  timeoutMs,
  outFile, // emit-mode adapters only
});

// virtual-module mode (Vite)
await codeConnectCompiler.build();
const source = codeConnectCompiler.generateRuntimeShim();

// emitted-file mode (Webpack, Next.js, esbuild, prepare)
// `getRuntimeAlias()` returns `{ '@figma/code-connect/register': <abs path> }`
// — spread it directly into your bundler's `resolve.alias`.
bundlerConfig.resolve.alias = {
  ...bundlerConfig.resolve.alias,
  ...codeConnectCompiler.getRuntimeAlias(),
};
await codeConnectCompiler.build();
await codeConnectCompiler.emitRuntimeModule(); // writes to the same path the alias points to

// watch-integration (Webpack `afterCompile` → fileDependencies)
for (const file of codeConnectCompiler.getDiscoveredFiles()) {
  compilation.fileDependencies.add(file);
}

// per-file HMR (Vite). `updateFile` returns a tagged result:
//   - { type: 'no-config' }     → called before first build(); no-op
//                                   (config + resolved globs aren't
//                                   loaded yet, so the path can't be
//                                   classified)
//   - { type: 'unknown-file' }  → path does not match template globs
//   - { type: 'template-file', changed: boolean } → re-parsed; emit an
//                                                   HMR invalidation
//                                                   only when changed.
const result = await codeConnectCompiler.updateFile(ctx.file);
if (result.type === "template-file" && result.changed) {
  // invalidate the virtual module — the runtime re-fetches and the new
  // IIFE replaces window.figmaCodeConnect with the updated map.
}
```

### Wiring the runtime into the user's bundle

The user adds **one import** to their app entry:

```ts
import "@figma/code-connect/register";
```

That specifier resolves to one of two things, depending on whether an
adapter is active:

- **Adapter active** (`enabled: true`, the default) — the adapter
  intercepts the specifier (via virtual module for Vite, `resolve.alias`
  for Webpack/Next.js/esbuild, or a wire-it-yourself alias for
  `prepareCodeConnect`) and serves the runtime shim populated with
  every component descriptor the parser found. The runtime IIFE
  installs `window.figmaCodeConnect.getComponentDescriptor` as a
  side effect.

- **Adapter inactive** (`enabled: false`, or no adapter installed) —
  the specifier resolves through normal Node resolution to the empty
  `dist/compile/register.js` placeholder shipped in the package. That
  module is a single `export {}` — production bundlers tree-shake it
  to zero bytes.

| Adapter | Wire-up mechanism (when `enabled: true`)                                                                                                                                                                                                          |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vite    | Virtual module via `resolveId` + `load`; served payload includes `import.meta.hot.accept()` so template edits hot-replace in place.                                                                                                               |
| Webpack | `compiler.options.resolve.alias['@figma/code-connect/register'] = runtimePath`; runtime is emitted to `node_modules/.cache/figma-code-connect/runtime.js` in `beforeCompile`. The `.cache/` segment is load-bearing for HMR (see `runtime.ts`).   |
| Next.js | `config.resolve.alias` for the webpack pipeline + `experimental.turbo.resolveAlias` for Turbopack; runtime is emitted fire-and-forget at config time, also under `node_modules/.cache/figma-code-connect/`.                                       |
| esbuild | `build.initialOptions.alias['@figma/code-connect/register'] = runtimePath`; runtime is emitted in `onStart` to `node_modules/.cache/figma-code-connect/runtime.js`.                                                                               |
| prepare | Returns the alias map for the caller to wire into their bundler's resolver; runtime is emitted by `prepareCodeConnect()` to `node_modules/.cache/figma-code-connect/runtime.js`.                                                                  |

Every adapter exposes an `enabled?: boolean` option:

- `true` — force the adapter on (e.g. ship the runtime in production).
- `false` — force the adapter off; the import resolves to the empty placeholder.
- `undefined` — **default**. The adapter auto-detects dev vs prod using its
  native build signal:

  | Adapter | Default-on signal                                                                       |
  | ------- | --------------------------------------------------------------------------------------- |
  | Vite    | `config.command !== 'build'` (resolved during `configResolved`)                         |
  | Webpack | `compiler.options.mode !== 'production'` (resolved during `apply()`)                    |
  | Next.js | `process.env.NODE_ENV !== 'production'` (Next sets this from `next dev` / `next build`) |
  | esbuild | `process.env.NODE_ENV !== 'production'` (esbuild has no built-in mode signal)           |
  | prepare | `process.env.NODE_ENV !== 'production'` (headless — no bundler context)                 |

So in the common case the user can leave `enabled` unset and the
runtime is automatically present in dev and absent in production:

```ts
// vite.config.ts — no enabled needed; defaults to command !== 'build'
export default defineConfig({ plugins: [figmaCodeConnect()] });

// next.config.js — no enabled needed; defaults to NODE_ENV !== 'production'
module.exports = withCodeConnect(nextConfig);
```

When the adapter resolves to disabled it is a complete no-op: no parser
run, no emit, no alias. The `import '@figma/code-connect/register'` the
user already added to their entry resolves to the empty placeholder.

## Tests

See `cli/src/compile/__test__/` for the full coverage matrix — per-pipeline-
stage test files under `__test__/template_files/`, the `Compiler` lifecycle
suite (`compiler.test.ts`), a snapshot-based real-fixtures suite
(`real_fixtures.test.ts`), a dual-output-mode invariant suite
(`output_modes.test.ts`), jsdom-backed runtime-shim tests
(`runtime_shim.test.ts`), and a `figma_runtime_parity.test.ts` that
exercises the compiler against canonical fixtures verifying the data
shape stays stable across runtimes. Adapter-specific behavior is covered
under each adapter's own `__test__/` directory (currently only
`src/vite/__test__/`).
