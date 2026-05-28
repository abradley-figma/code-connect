"use strict";
/**
 * Orchestrator: pure-string-in, pure-data-out.
 *
 * Pipeline:
 *   legacy-skip -> metadata -> transpile -> figma_code_connect ->
 *     execute_template -> extract_jsx_info -> component_name_inference -> build descriptors.
 *
 * The first step is a cheap `source.includes('figma.connect(')` substring
 * check: if it matches, the file is treated as a legacy Code Connect file
 * and skipped with a migrate-warning. Everything else is run through the
 * full template pipeline regardless of whether a `// url=` directive is
 * present — the recognize pre-filter was removed in favor of unconditional
 * execution, since the VM sandbox handles non-template files gracefully
 * (they just produce zero descriptors).
 *
 * `parseComponentDescriptorsFromSource` is the pure in-memory entry
 * point — no fs reads. The convenience wrapper
 * `parseComponentDescriptorsFromFile` reads the source from disk and
 * returns `undefined` on a read failure (so the caller can treat that
 * as a delete event).
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseComponentDescriptorsFromSource = parseComponentDescriptorsFromSource;
exports.parseComponentDescriptorsFromFile = parseComponentDescriptorsFromFile;
exports.extractMetadata = extractMetadata;
const transpile_1 = require("../transpile");
const figma_code_connect_1 = require("./figma_code_connect");
const execute_template_1 = require("./execute_template");
const extract_jsx_info_1 = require("./extract_jsx_info");
const component_name_inference_1 = require("./component_name_inference");
const resolve_component_source_1 = require("./resolve_component_source");
const promises_1 = require("node:fs/promises");
const nodePath = __importStar(require("node:path"));
/**
 * Pure-string-in, pure-data-out template parser.
 *
 * @param source     Raw template source code.
 * @param filePath   Absolute or relative path the source was read from.
 *                   Used as the descriptor's `filePath` field and as a
 *                   diagnostic prefix in warnings; also drives the
 *                   basename-based component-name fallback when no
 *                   `// component=` directive or recoverable JSX root is
 *                   present. Optional — defaults to `'template.figma.ts'`.
 * @param timeoutMs  Per-template execution budget for `vm.runInContext`.
 *                   Optional — defaults to 300ms.
 * @param root       Absolute path to the project root. Forwarded to
 *                   `resolveComponentSourcePath` so `// source=` directives
 *                   that look project-rooted (`src/foo.tsx`,
 *                   `/src/foo.tsx`) resolve correctly even when the
 *                   template lives in a subdirectory. Optional — when
 *                   omitted, defaults to `path.dirname(filePath)`, which
 *                   degenerates the project-root fallback into a redundant
 *                   template-relative retry (i.e. a no-op for callers that
 *                   don't have a real project root, e.g. ad-hoc tests).
 *                   The compiler always passes an explicit root.
 */
function parseComponentDescriptorsFromSource(source, filePath = 'template.figma.ts', timeoutMs = 300, root = nodePath.dirname(filePath)) {
    // Short-circuit: legacy `figma.connect()` files are not in scope. Emit a
    // migrate warning so users at least know we saw the file and skipped it.
    if (isLegacyConnectFile(source)) {
        return {
            descriptors: [],
            warnings: [
                `${filePath}: detected legacy figma.connect() Code Connect file — ` +
                    `the component-props plugin only supports template files ` +
                    `(.figma.{ts,tsx,js,jsx}). Migrate this file to a template file ` +
                    `(see https://developers.figma.com/docs/code-connect/template-files/) ` +
                    `to enable prop-panel data.`,
            ],
            isLegacyConnectFile: true,
        };
    }
    const warnings = [];
    const metadata = extractMetadata(source);
    // `transpile.ts` and `execute_template.ts` use `fileName` to stay
    // faithful to ts.transpileModule({ fileName }) / vm.Script({ filename }).
    const { js, diagnostics } = (0, transpile_1.transpileSource)(source, filePath);
    for (const d of diagnostics)
        warnings.push(`transpile: ${d}`);
    const { figma, jsxRuntime, captures } = (0, figma_code_connect_1.buildMockFigma)();
    const exec = (0, execute_template_1.executeTemplate)({
        js,
        filePath,
        figma,
        jsxRuntime,
        timeoutMs,
    });
    if (exec.timedOut) {
        warnings.push(`${filePath}: template execution exceeded ${timeoutMs}ms ` +
            `budget — produced ${captures.length} captures so far. ` +
            `Check for runaway loops or unintended async work in the template.`);
    }
    else if (exec.threw) {
        warnings.push(`${filePath}: template threw during execution: ${exec.threw}`);
    }
    if (exec.unknownImports.length > 0) {
        warnings.push(`${filePath}: template imported unsupported modules: ${[
            ...new Set(exec.unknownImports),
        ].join(', ')}. Only 'figma' and 'react/jsx-runtime' are resolvable.`);
    }
    // Collect enum-option warnings emitted during recording.
    for (const c of captures) {
        if (c.kind !== 'enum')
            continue;
        if (c.droppedReason) {
            warnings.push(`${filePath}: getEnum('${c.figmaPropName}') has no usable options ` +
                `(${c.droppedReason}). The panel will render an empty enum.`);
        }
        if (c.skippedOptionLabels.length > 0) {
            warnings.push(`${filePath}: getEnum('${c.figmaPropName}') dropped ${c.skippedOptionLabels.length} ` +
                `non-primitive option(s): ${c.skippedOptionLabels.join(', ')}. ` +
                `Only primitive enum values (string/number/boolean) are surfaced.`);
        }
    }
    // Extract root tag + per-attribute capture-symbol mapping from the
    // evaluated `figma.code` template. The root tag feeds `inferComponentName`;
    // the attribute mapping lets us set `PropDescriptor.name` to the JSX
    // attribute name (e.g. `size`) instead of the figma-side prop name
    // (e.g. `Size`) when the two differ.
    let rootTag;
    let rootIsComponent = false;
    const attrToToken = new Map();
    if (exec.figmaCode) {
        const jsx = (0, extract_jsx_info_1.extractJsxInfo)(exec.figmaCode);
        rootTag = jsx.rootTag;
        rootIsComponent = jsx.rootIsComponent;
        for (const [k, v] of jsx.attrToToken)
            attrToToken.set(k, v);
    }
    else if (!exec.threw && !exec.timedOut) {
        warnings.push(`${filePath}: template's default export is not the result of figma.code\`...\`. ` +
            `Root tag and JSX-attr names cannot be inferred — name will fall back to the figma-side prop name.`);
    }
    const componentName = (0, component_name_inference_1.inferComponentName)({
        componentDirective: metadata.componentDirective,
        rootTag,
        rootIsComponent,
        filePath,
    });
    if (!componentName) {
        warnings.push(`${filePath}: could not infer component name from directive, root JSX tag, ` +
            `or file basename. Skipping descriptor for this file.`);
        return {
            descriptors: [],
            warnings,
            metadata: {
                url: metadata.url,
                component: metadata.componentDirective,
                source: metadata.sourceDirective,
            },
        };
    }
    // Build prop descriptors. Each capture becomes one prop. The visible
    // `name` is the JSX attribute (when recovered) or the figma-side prop
    // name (when the capture wasn't bound to a `attr={…}` placeholder, e.g.
    // slots in children position or values laundered through helpers like
    // `figma.helpers.react.renderProp`).
    //
    // Dedup rule: ONE descriptor per figma-side prop name. A single Figma
    // property maps to one row in the panel — emitting two descriptors for
    // the same `figmaPropName` would produce duplicate rows.
    // First-write-wins on the figma-side name, regardless of kind:
    //   - same name + same kind → silent dedup (template called `getX('Foo')`
    //     twice; harmless, take the first).
    //   - same name + different kind → almost certainly an author bug (e.g.
    //     `getString('Foo')` and `getBoolean('Foo')`); take the first and
    //     surface a warning so the conflict is visible.
    // The capture-emit order below is also load-bearing: panels that don't
    // set `sortPosition` (the template API can't, per `types.ts`) fall back
    // to source order, and the order we push into `props[]` IS that source
    // order. See `cli/src/compile/__test__/template_files/capture_order.test.ts`.
    const seenFigmaProps = new Map();
    // Inverse of `attrToToken` (`symbol → attrName`). When the same capture
    // is bound to multiple JSX attributes — e.g. Tabs templates that thread
    // `defaultValue` through both `<Tabs defaultValue={…}>` and
    // `<TabsContent value={…}>` — the FIRST attribute wins. That matches
    // `extractJsxInfo`'s own first-write-wins for `attrName → token`, and
    // for shared captures it picks the attribute on (or nearer to) the
    // root tag, which is what users expect on the props panel.
    const tokenToAttr = new Map();
    for (const [attr, sym] of attrToToken) {
        if (!tokenToAttr.has(sym))
            tokenToAttr.set(sym, attr);
    }
    const props = [];
    for (const c of captures) {
        const seenKind = seenFigmaProps.get(c.figmaPropName);
        if (seenKind !== undefined) {
            if (seenKind !== c.kind) {
                // The warning surfaces the PUBLIC descriptor `type` strings users
                // see on the panel (`'string'`, `'boolean'`, …) rather than the
                // internal `CaptureKind` (`'text'`, …), so the message lines up
                // with the vocabulary in `compile/types.ts`. We don't try to
                // recover the exact template API call (`getString` vs
                // `figma.properties.string`, V2 vs V1) because both route through
                // the same capture and the `figmaPropName` is enough for the
                // author to find both call sites.
                warnings.push(`${filePath}: figma-side prop name '${c.figmaPropName}' captured ` +
                    `with kind '${captureKindToDescriptorType(seenKind)}' AND ` +
                    `'${captureKindToDescriptorType(c.kind)}' — only the first is emitted. ` +
                    `Each Figma property maps to one descriptor; combining captures of ` +
                    `different kinds for the same name is almost certainly an author bug ` +
                    `(typo, copy-paste, or stale refactor). Pick one kind and remove the other.`);
            }
            continue;
        }
        seenFigmaProps.set(c.figmaPropName, c.kind);
        const attrName = tokenToAttr.get(c.token);
        const name = attrName ?? c.figmaPropName;
        const descriptor = buildPropDescriptor(c, name);
        if (!descriptor)
            continue;
        props.push(descriptor);
    }
    // The descriptor's `filePath` should be the React component's source file
    // (e.g. `src/Button.tsx`) — not the `.figma.ts` template path. The
    // runtime shim looks up by `{ componentName, ownerFilePath }` pulled
    // from `_debugSource`, which is the component source path.
    const componentSourcePath = (0, resolve_component_source_1.resolveComponentSourcePath)({
        templateFilePath: filePath,
        componentName,
        defaultExport: exec.defaultExport,
        sourceDirective: metadata.sourceDirective,
        root,
    });
    return {
        descriptors: [
            {
                componentName,
                filePath: componentSourcePath,
                props,
            },
        ],
        warnings,
        metadata: {
            url: metadata.url,
            component: metadata.componentDirective,
            source: metadata.sourceDirective,
        },
    };
}
/**
 * Convenience wrapper that reads `filePath` from disk and feeds the
 * source through `parseComponentDescriptorsFromSource`. Returns
 * `undefined` IFF the read itself fails — caller treats that as a
 * "the file disappeared between discovery and parse" delete event
 * (the build pipeline clears the file's descriptors via `replace([])`
 * and the HMR path likewise clears them).
 *
 * Any error AFTER a successful read (transpile diagnostics, runtime
 * exception, timeout) surfaces inside the returned `ParseResult.warnings`,
 * NOT as `undefined`. That distinction matters: parser problems are
 * "we saw the file but couldn't extract descriptors", while a missing
 * file is "the file is gone and its previous descriptors should be
 * removed".
 */
async function parseComponentDescriptorsFromFile(filePath, timeoutMs, root) {
    let source;
    try {
        source = await (0, promises_1.readFile)(filePath, 'utf8');
    }
    catch {
        return undefined;
    }
    return parseComponentDescriptorsFromSource(source, filePath, timeoutMs, root);
}
/**
 * Map a single recorded capture to a fully-populated `PropDescriptor`.
 *
 *  - `name`  — the JSX attribute name recovered from `figma.code` (the
 *    React prop the template renders into) when available, falling back
 *    to `c.figmaPropName` for captures that aren't bound to a JSX
 *    attribute placeholder (slots in children position, values run
 *    through `figma.helpers.react.renderProp`, etc.).
 *  - `label` — the figma-side property name (the argument passed to
 *    `instance.getX('…')`). Free-form; can contain spaces/emoji.
 *
 * Capture kind → descriptor type mapping:
 *  - `text`      → `string`
 *  - `boolean`   → `boolean`
 *  - `enum`      → `enum` (with parsed options)
 *  - `reference` → `reference`  (instance-swap; matches `defineProperties`)
 *  - `slot`      → `slot`
 */
function buildPropDescriptor(c, name) {
    const base = {
        name,
        label: c.figmaPropName,
    };
    switch (c.kind) {
        case 'text':
            return { ...base, type: 'string' };
        case 'boolean':
            return { ...base, type: 'boolean' };
        case 'enum':
            return { ...base, type: 'enum', options: c.options };
        case 'reference':
            return { ...base, type: 'reference' };
        case 'slot':
            return { ...base, type: 'slot' };
        default:
            return undefined;
    }
}
/**
 * Map an internal `CaptureKind` to the public `PropDescriptor['type']`
 * string. Only `'text'` diverges — text captures surface as the descriptor
 * type `'string'`. Used by the conflict-warning path so messages line up
 * with the descriptor vocabulary users see in `compile/types.ts`.
 */
function captureKindToDescriptorType(kind) {
    return kind === 'text' ? 'string' : kind;
}
function isLegacyConnectFile(source) {
    return source.includes('figma.connect(');
}
/**
 * Extracts the leading `// url=` / `// component=` / `// source=` magic
 * comments from a template source string. Port of `extractMetadataFields` from
 * `cli/src/connect/raw_templates.ts:70-103`. Pure — no fs.
 *
 * Stops at the first non-blank, non-comment line: directives must be in
 * the leading comment block, NOT scattered throughout the file. This
 * prevents false positives from `// url=` strings that appear in code
 * comments deeper in the file. Repeated directives are first-write-wins.
 */
const DIRECTIVE_RE = /^\/\/\s*(\w+)\s*=\s*(.+)$/;
const ALLOWED_DIRECTIVES = new Set(['url', 'component', 'source']);
function extractMetadata(source) {
    const out = {};
    for (const line of source.split('\n')) {
        const trimmed = line.trim();
        if (trimmed === '')
            continue;
        if (!trimmed.startsWith('//')) {
            // First non-comment, non-blank line — stop scanning.
            break;
        }
        const match = trimmed.match(DIRECTIVE_RE);
        if (!match)
            continue;
        const field = match[1].toLowerCase();
        const value = match[2].trim();
        if (!ALLOWED_DIRECTIVES.has(field))
            continue;
        if (field === 'url' && out.url === undefined)
            out.url = value;
        else if (field === 'component' && out.componentDirective === undefined) {
            out.componentDirective = value;
        }
        else if (field === 'source' && out.sourceDirective === undefined) {
            out.sourceDirective = value;
        }
    }
    return out;
}
