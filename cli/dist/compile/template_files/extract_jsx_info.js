"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractJsxInfo = extractJsxInfo;
const figma_code_connect_1 = require("./figma_code_connect");
/**
 * Match the first JSX opening tag in a string. Captures the tag name —
 * which is either an HTML primitive (`div`, `span`) or a component
 * (`Button`, `My.Sub`). The character class allows `.` so namespaced
 * tags like `Slot.Trigger` are recovered intact; `\b` anchors the end
 * to a word boundary, which keeps us from matching the trailing `<` of
 * the opening tag's `<>` shorthand or fragment syntax.
 *
 * This is intentionally permissive: anything that LOOKS like a JSX
 * opening tag matches. False positives are absorbed by the
 * downstream component-name validator (`IDENT_RE`) — only
 * uppercase-leading identifiers become components.
 */
const ROOT_TAG_RE = /<\s*([A-Za-z_$][\w.$-]*)\b/;
/**
 * Match a JSX attribute name immediately followed by `={` at the END
 * of a string. We run this against `strings[i]` — the literal chunk
 * that immediately precedes a `${value}` placeholder — to determine
 * whether that placeholder lives inside an attribute expression, and
 * if so which attribute. The `$` anchor ensures we only match when the
 * placeholder is the next token after `={`, NOT when `attrName={`
 * appears earlier in the chunk followed by other text.
 *
 * We deliberately require explicit `{` rather than also accepting bare
 * `attr=` — the bare form (`<Tag attr=${value}/>`) is not valid JSX
 * once the template literal is expanded (it would yield `attr=value`
 * with no quotes or braces), so genuine templates always use `attr={…}`.
 */
const ATTR_NAME_RE = /([A-Za-z_$][\w.$-]*)\s*=\s*\{$/;
function extractJsxInfo(code) {
    const strings = code.strings;
    const values = code.values;
    const out = {
        rootTag: undefined,
        rootIsComponent: false,
        attrToToken: new Map(),
        unboundTokens: [],
    };
    for (const s of strings) {
        const m = s.match(ROOT_TAG_RE);
        if (m) {
            out.rootTag = m[1];
            out.rootIsComponent = /^[A-Z]/.test(m[1]);
            break;
        }
    }
    // For each ${value}, classify the placeholder by either:
    //  (a) reading a `figma.helpers.react.renderProp(attrName, capture)` marker
    //      directly, since the helper carries the JSX attribute name as its
    //      first argument (the placeholder typically lives in tag-content
    //      position so `strings[i]` doesn't reveal it), OR
    //  (b) inspecting `strings[i]` (the chunk that immediately precedes the
    //      placeholder) for the simple `attrName={` shape.
    // Anything else — JSX spread, ternary, plain text content, slots in
    // children position — falls through to `unboundTokens` and the parser
    // uses the figma-side prop name as `name` for those captures.
    for (let i = 0; i < values.length; i++) {
        const v = values[i];
        const renderProp = (0, figma_code_connect_1.readRenderPropMarker)(v);
        if (renderProp) {
            const innerMeta = (0, figma_code_connect_1.readTokenMeta)(renderProp.prop);
            if (innerMeta) {
                // First-write-wins, matching the `attr={…}` branch below.
                if (!out.attrToToken.has(renderProp.attrName)) {
                    out.attrToToken.set(renderProp.attrName, innerMeta.symbol);
                }
            }
            // renderProp can also wrap non-capture values (string literals, etc.);
            // those legitimately have no token to bind, so we just skip them.
            continue;
        }
        const meta = (0, figma_code_connect_1.readTokenMeta)(v);
        if (!meta)
            continue;
        const before = strings[i] ?? '';
        const attrMatch = before.match(ATTR_NAME_RE);
        if (attrMatch) {
            if (!out.attrToToken.has(attrMatch[1])) {
                out.attrToToken.set(attrMatch[1], meta.symbol);
            }
        }
        else {
            out.unboundTokens.push(meta.symbol);
        }
    }
    return out;
}
