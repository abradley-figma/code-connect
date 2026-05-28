/**
 * All shared type declarations for the compiler core. Three concentric
 * layers, each addressed by a different consumer:
 *
 *  1. **Public adapter API** — `CreateCompilerOptions`, `CodeConnectCompiler`,
 *     `CodeConnectBuildResult`, `CodeConnectUpdateFileResult`. These are
 *     re-exported from `./index.ts` and form the contract every bundler
 *     adapter codes against.
 *
 *  2. **Public on-the-wire types** — `PropDescriptor` (a discriminated union
 *     across `string` / `number` / `boolean` / `enum` / `reference` /
 *     `slot` / `color` / `image` / `easing` / `vector`),
 *     `ComponentDescriptor`, `ComponentDescriptors`, `CodeConnectManifest`.
 *     These describe the JSON the runtime shim ships to the browser.
 *
 *  3. **Browser-side global** — `FigmaCodeConnectApi` plus a `declare global`
 *     block that augments `Window` with `figmaCodeConnect`. The runtime
 *     shim (in `runtime.ts`) installs an implementation that satisfies
 *     this interface; the host environment reads it.
 *
 * Code Connect template files produce a subset of `PropDescriptor`
 * (`string`, `boolean`, `enum`, `reference`, `slot`). The other shapes
 * are reserved for forward compatibility — see each interface below for
 * notes on which fields the template parser does and doesn't populate.
 */
/**
 * Options accepted by `createCompiler()`. Every field is optional — the
 * defaults are tuned for "I just want the compiler to work in the
 * common case":
 *
 *  - `root` falls back to `process.cwd()`. Adapters that learn the
 *    real root later (Vite, in `configResolved`) pass `undefined` here
 *    and call `setRoot()` before the first `build()`.
 *  - Template-file include / exclude globs are NOT exposed here on
 *    purpose. The single source of truth is the project's
 *    `figma.config.json#codeConnect.include` / `.exclude` (the same
 *    config `figma connect publish` reads); when absent, the
 *    templates-only defaults baked into
 *    `cli/src/connect/project.ts#resolveTemplateGlobs` apply
 *    (`**\/*.figma.{ts,js}`, `**\/*.figma.template.{ts,js}`,
 *    `**\/*.figma.batch.json` for include; `node_modules/**` for
 *    exclude). Adapter users who need to widen the set add
 *    `figma.config.json` rather than passing globs to each adapter.
 *  - `timeoutMs` defaults to 300ms — high enough for any reasonable
 *    template (the heavy fixture in the test suite parses in ~0.8ms),
 *    low enough to keep a runaway template from blocking a watch
 *    rebuild.
 *  - `outFile` is the only field that adapters wire up differently:
 *    emit-mode adapters (Webpack, Next.js, esbuild, headless prepare)
 *    pass it through to control where the runtime shim is written;
 *    virtual-module adapters (Vite) ignore it because the shim is
 *    served from memory.
 */
export interface CreateCompilerOptions {
    /** Project root. Optional at create time — adapters that learn it later
     *  (Vite, in `configResolved`) call `setRoot()` before `build()`. */
    root?: string;
    /** Per-template execution timeout (ms). Default 300. */
    timeoutMs?: number;
    /** Absolute path to write the runtime module to. Defaults to
     *  `<root>/node_modules/.cache/figma-code-connect/runtime.js` — the
     *  `node_modules/.cache/` prefix is intentional: it's the standard
     *  tool-cache location every major bundler is engineered to treat as
     *  mutable (Webpack 5's default `snapshot.managedPaths` regex
     *  excludes `.cache/` so files under it get content+mtime snapshots
     *  instead of immutable package-version snapshots). See
     *  `resolveRuntimeFilePath` in `runtime.ts` for the full
     *  why-not-alternatives writeup. Only consulted by emit-mode
     *  adapters (Webpack, Next.js, esbuild, headless prepare) —
     *  virtual-module adapters (Vite) ignore it. */
    outFile?: string;
    /** Whether to log debug logs. Default false. */
    debugLogs?: boolean;
}
export interface CodeConnectBuildResult {
    /** Number of template files discovered on disk during this rebuild. */
    templateFileCount: number;
    /** Warnings raised during discover + read + parse. */
    warnings: string[];
}
export interface CodeConnectCompiler {
    /** Update the root directory used for discover + alias resolution.
     *  Safe to call at any point; the next `build()` uses the new root.
     *
     *  Invalidates the cached `figma.config.json` + resolved include /
     *  exclude globs from any prior `build()` — the next `build()`
     *  re-runs config resolution against the new root, so two roots
     *  with different `figma.config.json` shapes pick up the right
     *  globs each. Until the next `build()` resolves, `updateFile()`
     *  reports `{ type: 'no-config' }`. */
    setRoot(root: string): void;
    /** Get the root directory used for discover + alias resolution. */
    getRoot(): string;
    /** Full-rebuild: discover every template file under the root, parse each,
     *  and replace the internal map. Idempotent. */
    build(): Promise<CodeConnectBuildResult>;
    /** Sorted, absolute paths of every template file the most recent `build()`
     *  discovered on disk. Empty before the first `build()` resolves.*/
    getDiscoveredFiles(): string[];
    /** Re-parse a single template file in place. Reads the source from disk
     *  (a read failure is treated as a delete — the file's descriptors are
     *  cleared), parses it, and calls `map.replace`. The returned
     *  discriminated union tells the adapter whether to emit an HMR
     *  invalidation:
     *    - `{ type: 'no-config' }` — pre-`build`; the compiler hasn't
     *      loaded `figma.config.json` yet so it can't classify the
     *      path. No-op; the upcoming full discover will pick the file
     *      up regardless, and there's no virtual-module consumer to
     *      invalidate yet.
     *    - `{ type: 'unknown-file' }` — path does not match the
     *      resolved include / exclude globs from the most recent
     *      `build()`. No-op.
     *    - `{ type: 'template-file', changed }` — re-parsed. `changed`
     *      is true iff the file's descriptor list actually changed —
     *      adapters should only emit an HMR invalidation when true. */
    updateFile(filePath: string): Promise<CodeConnectUpdateFileResult>;
    /** Generate the manifest for the runtime module. Synchronous — the
     *  underlying work is an in-memory snapshot of the descriptor map. */
    generateManifest(): Promise<CodeConnectManifest>;
    /** Browser-bundled JS source for the runtime module
     *  (data payload + `globalThis.figmaCodeConnect.getComponentDescriptor` shim).
     *  Synchronous — manifest + template substitution, no I/O. */
    generateRuntimeShim(): Promise<string>;
    /** Emitted-file output mode. Writes `generateRuntimeShim()` to the absolute
     *  path resolved from `<root>/node_modules/.cache/figma-code-connect/runtime.js`
     *  (or `opts.outFile` if set). Idempotent — skips the write if the on-disk
     *  bytes already match. Async so the bundler's event loop never blocks
     *  on disk I/O. */
    emitRuntimeModule(): Promise<void>;
    /** Copy-pasteable `{ specifier: absolutePath }` snippet for any module-alias
     *  config — the same shape Vite/Webpack/Rollup/Parcel/esbuild aliases all
     *  accept. The returned record always contains exactly one entry:
     *
     *      { '@figma/code-connect/register': '<absolute path>' }
     *
     *  …where the value is the same file `emitRuntimeModule()` writes to.
     *  Adapters spread this into their bundler's resolve.alias so consumer
     *  code that imports `@figma/code-connect/register` (e.g. the runtime
     *  shim's auto-load) resolves to the freshly emitted bundle.
     *
     *  A fresh object is returned on each call — safe to mutate or spread. */
    getRuntimeAlias(): Record<string, string>;
    /** Absolute path of the file users should alias `@figma/code-connect/register` to. */
    getRuntimeFilePath(): string;
    /** Canonical import specifier the runtime module is published under
     *  (`'@figma/code-connect/register'`). Centralized here so adapters don't
     *  hard-code the string in their auto-inject and alias snippets. */
    getRuntimeModuleId(): string;
}
export interface CodeConnectUpdateFileResult {
    /** Type of the updated file. */
    type: 'template-file' | 'unknown-file' | 'no-config';
    /** True if the file changed. */
    changed?: boolean;
}
/** Common fields on every descriptor. */
export interface BasePropDescriptor {
    /**
     * The React prop / JSX attribute name. Used as the leaf in the `path`
     * written back through `setProps` (`<Comp name={value}>`).
     *
     * For Code Connect templates: the JSX attribute name recovered from
     * `figma.code` (e.g. `"size"` for `<Button size={getString('Size')} />`).
     * Falls back to the figma-side prop name for captures that aren't
     * bound to a `attr={…}` placeholder — slots in children position,
     * values laundered through `figma.helpers.react.renderProp`,
     * spread / ternary attribute values, etc.
     */
    name: string;
    /**
     * Human-friendly display string for the panel.
     *
     * For Code Connect templates: the figma-side property name (the
     * argument passed to `instance.getX('…')`, e.g. `"Label"`,
     * `"👥 Variant"`). Free-form — may contain spaces, emoji, etc.
     * Always set by the parser.
     */
    label?: string;
    /**
     * Long-form description.
     *
     * Not produced by the `.figma.ts` template parser today (no template API
     * for it).
     */
    description?: string;
    /**
     * Optional sort key. Lower sorts higher in the panel. All-or-nothing across
     * a component; when omitted everywhere, descriptors fall back to source
     * order.
     *
     * Not produced by the `.figma.ts` template parser today (no template API
     * for it). For template-sourced descriptors the fallback closes the gap on
     * its own: "source order" IS the order in which `getX()` calls execute, and
     * the parser preserves capture order in `ComponentDescriptor.props[]`, so
     * panels that render in array order are correctly ordered without needing
     * an explicit `sortPosition`.
     */
    sortPosition?: string;
}
export interface StringPropDescriptor extends BasePropDescriptor {
    type: 'string';
    /**
     * Initial value the panel pre-populates. Not produced by the `.figma.ts`
     * template parser today (no template API for it).
     */
    defaultValue?: string;
    /**
     * Refines panel control:
     *  - `'input'` → standard text input
     *  - `'textarea'` → multiline expanding input
     *
     * Not settable from `.figma.ts` templates (`getString(name)` takes a
     * single argument). From a template-sourced row, panels should default
     * to `'input'`.
     *
     * Note: enum-as-string is modelled as `type: 'enum'` rather than
     * `type: 'string', control: 'select'`, since `getEnum` is first-class in
     * the template API and the option list is structurally distinct.
     */
    control?: 'input' | 'textarea';
    /**
     * Optional unit label rendered next to the input. Not produced by the
     * `.figma.ts` template parser today.
     */
    unit?: string;
}
/**
 * Not produced by the `.figma.ts` template parser today — the template API
 * has no `getNumber()` capture (numeric Figma props surface as strings via
 * `getString`). From a template-sourced row, panels should treat numeric
 * editing as the runtime fallback (free-form text input parsed back to a
 * number); none of the refinements below (`control`, `min/max/step`,
 * `unit`, `defaultValue`) will ever be set from a template alone.
 */
export interface NumberPropDescriptor extends BasePropDescriptor {
    type: 'number';
    defaultValue?: number;
    /**
     * Refines panel control:
     *  - `'input'` → scrubbable number input
     *  - `'slider'` → slider with `min` / `max` / `step`
     *
     * Defaults to `'input'` when omitted.
     */
    control?: 'input' | 'slider';
    /** Slider/input bounds. All three required for `control: 'slider'`. */
    min?: number;
    max?: number;
    step?: number;
    /** Optional unit label rendered next to the input (e.g. `'px'`, `'ms'`). */
    unit?: string;
}
export interface BooleanPropDescriptor extends BasePropDescriptor {
    type: 'boolean';
    /**
     * Initial value the panel pre-populates. Not produced by the `.figma.ts`
     * template parser today (no template API for it).
     */
    defaultValue?: boolean;
}
/**
 * Constrained value list. For Code Connect templates, populated from
 * `getEnum(name, mapping)` — `value` is the mapped output consumed by code,
 * `label` is the figma-side option key.
 */
export interface EnumPropDescriptor extends BasePropDescriptor {
    type: 'enum';
    /**
     * Allowed values + display labels. Order matters — the panel renders
     * options in array order. Each option's `value` is what `setProps` writes;
     * `label` is what the panel displays in the dropdown row.
     */
    options: Array<{
        value: string | number | boolean;
        label: string;
    }>;
    /**
     * Initial value the panel pre-populates. Not produced by the `.figma.ts`
     * template parser today (no template API for it). From a template-sourced
     * row, panels can fall back to the first entry of `options[]`, whose
     * order reflects the `getEnum(name, mapping)` mapping-object key order.
     */
    defaultValue?: string | number | boolean;
}
/**
 * Instance-swap reference. The `'reference'` tag matches the parser's
 * internal `CaptureKind`.
 */
export interface ReferencePropDescriptor extends BasePropDescriptor {
    type: 'reference';
    /**
     * Components the picker should preselect / filter to. Cannot be inferred
     * from a template today (no template API for it).
     */
    preferredValues?: Array<{
        componentName?: string;
        sourcePath?: string;
        /** Code Connect ID, when known. */
        codeConnectId?: string;
    }>;
}
export interface SlotPropDescriptor extends BasePropDescriptor {
    type: 'slot';
    /**
     * Slot configuration. Not produced by the `.figma.ts` template parser
     * today (no template API for it). From a template-sourced row, panels
     * should render an unconstrained slot drop zone with default behaviour.
     */
    slotConfig?: {
        minChildren?: number;
        maxChildren?: number;
        displayByDefault?: boolean;
        stretchChildOnInsert?: boolean;
        allowPreferredValuesOnly?: boolean;
    };
}
/**
 * Forward-compat: not produced by the parser today. Templates have no API
 * for color props.
 */
export interface ColorPropDescriptor extends BasePropDescriptor {
    type: 'color';
    /** Hex / rgba string. */
    defaultValue?: string;
}
/**
 * Forward-compat: not produced by the parser today. Templates have no API
 * for image props.
 */
export interface ImagePropDescriptor extends BasePropDescriptor {
    type: 'image';
    /** Image URL or asset id. */
    defaultValue?: string;
}
/**
 * Forward-compat: not produced by the parser today. Templates have no API
 * for easing props.
 */
export interface EasingPropDescriptor extends BasePropDescriptor {
    type: 'easing';
    /** Named easing (e.g. `'outCubic'`) or serialized easing config. */
    defaultValue?: string;
}
/**
 * Forward-compat: not produced by the parser today. Templates have no API
 * for vector props.
 */
export interface VectorPropDescriptor extends BasePropDescriptor {
    type: 'vector';
    defaultValue?: {
        x: number;
        y: number;
    };
}
/**
 * Discriminated union of editable prop "shapes". Variant tag lives on the
 * `type` field (see {@link PropDescriptorType} for the tag's value space).
 * Names are lowercased; `enum` is a first-class type because the Code
 * Connect template API has `getEnum` as a first-class call.
 *
 * Today the parser produces a subset (`string`, `boolean`, `enum`,
 * `reference`, `slot`). The other shapes are reserved for forward
 * compatibility.
 */
export type PropDescriptor = StringPropDescriptor | NumberPropDescriptor | BooleanPropDescriptor | EnumPropDescriptor | ReferencePropDescriptor | SlotPropDescriptor | ColorPropDescriptor | ImagePropDescriptor | EasingPropDescriptor | VectorPropDescriptor;
export interface ComponentDescriptor {
    componentName: string;
    /**
     * Path to the **React component's source file** (e.g. `src/Button.tsx`),
     * NOT the `.figma.ts` template that produced this descriptor. Resolved at
     * parse time from (in priority order) the template's `// source=` directive,
     * a matching `imports[]` entry on the canonical export, or a sibling-file
     * heuristic. `snapshot(root)` rewrites this to a project-relative POSIX
     * string so it composes with the runtime shim's lookup key
     * (`${componentName}:${filePath ?? ''}`).
     *
     * `undefined` when the parser couldn't resolve the source — the runtime
     * shim's name-only fallback still works in that case.
     */
    filePath?: string;
    props: PropDescriptor[];
}
export interface CodeConnectManifest {
    /**
     * Flat list of every component descriptor the compiler discovered, shipped
     * verbatim to the browser. The runtime shim walks this with three `find`
     * calls — exact-match → path-boundary suffix-match → name-only — so we
     * keep the on-the-wire shape simple. Sorted deterministically by
     * `(componentName, filePath)` at snapshot time so manifests are stable
     * across runs and machines.
     */
    componentDescriptors: ComponentDescriptor[];
}
/**
 * Browser-side global installed by the runtime module as a side-effect.
 * The host environment calls `window.figmaCodeConnect.getComponentDescriptor(...)`.
 */
export interface FigmaCodeConnectApi {
    getComponentDescriptor(opts: {
        componentName: string;
        filePath?: string;
    }): Promise<ComponentDescriptor | undefined>;
}
declare global {
    interface Window {
        figmaCodeConnect?: FigmaCodeConnectApi;
    }
}
