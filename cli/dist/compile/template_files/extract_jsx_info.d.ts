/**
 * Extracts the JSX shape from an evaluated `figma.code` tagged-template
 * result.
 *
 * `figma.code\`<Button size={${size}} />\`` returns a `FigmaCodeResult`
 * (`{ strings, values }`) — the raw inputs to the tagged-template tag, NOT
 * a parsed JSX tree. We never see the actual JSX nodes, only their textual
 * fragments interleaved with capture-token placeholders. This function
 * reconstructs two pieces of structural information from those fragments:
 *
 *  1. `rootTag` — the first `<Tag` opening pattern in the source. Used by
 *     `inferComponentName` as a fallback when no `// component=` directive
 *     is present.
 *  2. `attrToToken` — for each `${value}` whose value is a recognized
 *     capture token (per `readTokenMeta`), which JSX attribute on the root
 *     element does that placeholder live inside. The parser uses this to
 *     set `PropDescriptor.name` to the JSX attribute name (e.g. `size`)
 *     instead of the figma-side prop name (e.g. `Size`) when the two
 *     differ.
 *
 * Strategy: walk over (strings[i], values[i]) pairs; for each token-valued
 * placeholder, inspect the literal chunk that immediately precedes it
 * (`strings[i]`) and decide whether the placeholder lives in attribute
 * position (the chunk ends with `attrName={`) or somewhere else (children
 * position, ternary, spread). Bind only the simple `attr={…}` shape; other
 * shapes fall through to `unboundTokens` and the parser falls back to the
 * figma-side prop name for `PropDescriptor.name`.
 */
import type { FigmaCodeResult } from './figma_code_connect';
export interface JsxInfo {
    /** The first JSX opening tag in the template, e.g. `Button` or `div`. */
    rootTag: string | undefined;
    /** Whether the root tag we recovered is a component (uppercase first letter). */
    rootIsComponent: boolean;
    /** Map: JSX attribute name → symbol of the capture token bound to that attribute. */
    attrToToken: Map<string, symbol>;
    /** Capture tokens that appeared in the template but couldn't be tied to a JSX attribute. */
    unboundTokens: symbol[];
}
export declare function extractJsxInfo(code: FigmaCodeResult): JsxInfo;
