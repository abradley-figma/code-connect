/**
 * Recording mock of the `figma` global passed to template files during VM
 * execution. Mirrors the public `figma` template-file API surface but
 * records `getX` calls instead of rendering them.
 *
 * Each `getX` call returns a tagged token (an opaque object identifiable by
 * symbol) so the template can interpolate it into `figma.code` template
 * literals; the `extract_jsx_info` step later maps each token back to a
 * capture via symbol identity.
 *
 * Pure — no I/O, no globals. The factory returns a fresh mock + capture sink
 * on every call so multiple template runs don't leak state.
 */
export type CaptureKind = 'text' | 'boolean' | 'enum' | 'reference' | 'slot';
export interface EnumOption {
    value: string;
    label: string;
}
export type CaptureRecord = {
    token: symbol;
    kind: 'text';
    figmaPropName: string;
} | {
    token: symbol;
    kind: 'boolean';
    figmaPropName: string;
} | {
    token: symbol;
    kind: 'enum';
    figmaPropName: string;
    options: EnumOption[];
    droppedReason?: string;
    skippedOptionLabels: string[];
} | {
    token: symbol;
    kind: 'reference';
    figmaPropName: string;
} | {
    token: symbol;
    kind: 'slot';
    figmaPropName: string;
};
export interface FigmaCodeConnectBuild {
    figma: unknown;
    jsxRuntime: unknown;
    captures: CaptureRecord[];
}
/** Marker on objects returned by the mock's jsx-runtime stub so enum-option parsing can detect them. */
export declare const JSX_STUB_MARKER: unique symbol;
/** Marker on objects returned by `figma.code`/`tsx`/`html`/etc. so `extract_jsx_info` can detect them. */
export declare const FIGMA_CODE_MARKER: unique symbol;
/** Marker on objects returned by `figma.value`. */
export declare const FIGMA_VALUE_MARKER: unique symbol;
/**
 * Marker on objects returned by `figma.helpers.react.renderProp(attrName, prop)`.
 * The helper exists in the real runtime to render a JSX attribute conditionally
 * (e.g. omit it when the prop is the default), and its inputs include both the
 * JSX attribute name AND the capture token. We preserve both at compile time
 * in a marker object so `extract_jsx_info` can bind `attrName → captureSymbol`
 * even though the placeholder lands in tag-content position rather than
 * `attr={…}` position.
 */
export declare const RENDER_PROP_MARKER: unique symbol;
/** Marker payload returned by the mock's `renderProp` stub. */
export interface RenderPropMarker {
    [RENDER_PROP_MARKER]: true;
    /** The JSX attribute name passed as the first argument. */
    attrName: string;
    /** The capture-token proxy passed as the second argument (may be a non-capture). */
    prop: unknown;
}
/** Detect a `RenderPropMarker` (own-property check, mirrors `readTokenMeta`). */
export declare function readRenderPropMarker(value: unknown): RenderPropMarker | undefined;
/** Per-token data carried alongside the symbol so we can map String(token) back to figmaPropName when needed. */
export interface TokenMeta {
    symbol: symbol;
    kind: CaptureKind;
    figmaPropName: string;
}
/** Read the underlying TokenMeta from a token. Used by `extract_jsx_info` via symbol identity. */
export declare function readTokenMeta(value: unknown): TokenMeta | undefined;
export interface FigmaCodeResult {
    [FIGMA_CODE_MARKER]: true;
    strings: readonly string[];
    values: unknown[];
}
export declare function isFigmaCodeResult(v: unknown): v is FigmaCodeResult;
/**
 * Factory: build a fresh recording mock + capture sink + jsx-runtime
 * stub. Each call returns independent objects — the function is pure
 * (no closed-over state, no globals, no I/O), so multiple template
 * runs don't leak captures across each other and tests can run in
 * parallel safely.
 *
 * The returned `figma` object covers:
 *  - the V2 capture API (`figma.selectedInstance.getString`,
 *    `getBoolean`, `getEnum`, `getInstanceSwap`, `getSlot`),
 *  - the V1 properties API (`figma.properties.{string,boolean,…}`)
 *    routed through the same recording surface,
 *  - all five language-tag aliases of `figma.code` (`code`, `tsx`,
 *    `html`, `swift`, `kotlin`) sharing one capture-recording
 *    implementation,
 *  - inert stubs for the runtime APIs we don't model
 *    (`findInstance`, `executeTemplate`, `helpers.react.*`, etc.) so
 *    templates that exercise those features execute without throwing
 *    even though we don't surface their output.
 *
 * The `jsxRuntime` stub stands in for `react/jsx-runtime` — `jsx` /
 * `jsxs` / `jsxDEV` all return marked stubs so enum-option parsing
 * can detect and skip them.
 */
export declare function buildMockFigma(): FigmaCodeConnectBuild;
