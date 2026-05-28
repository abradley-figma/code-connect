"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.RENDER_PROP_MARKER = exports.FIGMA_VALUE_MARKER = exports.FIGMA_CODE_MARKER = exports.JSX_STUB_MARKER = void 0;
exports.readRenderPropMarker = readRenderPropMarker;
exports.readTokenMeta = readTokenMeta;
exports.isFigmaCodeResult = isFigmaCodeResult;
exports.buildMockFigma = buildMockFigma;
/** Marker on objects returned by the mock's jsx-runtime stub so enum-option parsing can detect them. */
exports.JSX_STUB_MARKER = Symbol.for('@figma/code-connect/jsx-stub');
/** Marker on objects returned by `figma.code`/`tsx`/`html`/etc. so `extract_jsx_info` can detect them. */
exports.FIGMA_CODE_MARKER = Symbol.for('@figma/code-connect/figma-code');
/** Marker on objects returned by `figma.value`. */
exports.FIGMA_VALUE_MARKER = Symbol.for('@figma/code-connect/figma-value');
/**
 * Marker on objects returned by `figma.helpers.react.renderProp(attrName, prop)`.
 * The helper exists in the real runtime to render a JSX attribute conditionally
 * (e.g. omit it when the prop is the default), and its inputs include both the
 * JSX attribute name AND the capture token. We preserve both at compile time
 * in a marker object so `extract_jsx_info` can bind `attrName → captureSymbol`
 * even though the placeholder lands in tag-content position rather than
 * `attr={…}` position.
 */
exports.RENDER_PROP_MARKER = Symbol.for('@figma/code-connect/render-prop');
/** Detect a `RenderPropMarker` (own-property check, mirrors `readTokenMeta`). */
function readRenderPropMarker(value) {
    if (value && typeof value === 'object' && value[exports.RENDER_PROP_MARKER] === true) {
        return value;
    }
    return undefined;
}
const TOKEN_META = new WeakMap();
/** Read the underlying TokenMeta from a token. Used by `extract_jsx_info` via symbol identity. */
function readTokenMeta(value) {
    // Token proxies are wrappers around a function target so `typeof` reports
    // `'function'` even though they behave like objects — handle both shapes.
    if (value && (typeof value === 'object' || typeof value === 'function')) {
        return TOKEN_META.get(value);
    }
    return undefined;
}
function isFigmaCodeResult(v) {
    return !!v && typeof v === 'object' && v[exports.FIGMA_CODE_MARKER] === true;
}
/**
 * Parse a runtime enum-mapping object into our flat `EnumOption[]` shape.
 * Coerces primitives to strings; skips non-coercible values with a "skipped"
 * label so the orchestrator can warn.
 */
function parseEnumOptions(mapping) {
    if (mapping === null || typeof mapping !== 'object') {
        return {
            options: [],
            skippedOptionLabels: [],
            droppedReason: 'mapping is not an object',
        };
    }
    const entries = Object.entries(mapping);
    if (entries.length === 0) {
        return {
            options: [],
            skippedOptionLabels: [],
            droppedReason: 'mapping is empty',
        };
    }
    const options = [];
    const skipped = [];
    for (const [label, raw] of entries) {
        const result = coerceEnumValue(raw);
        if (result === undefined) {
            skipped.push(label);
            continue;
        }
        options.push({ value: result, label });
    }
    return { options, skippedOptionLabels: skipped };
}
/**
 * Coerce a single enum-mapping value to a string the panel can render.
 *
 * `undefined` / `null` collapse to an empty string so authors who write
 * `{ Disabled: undefined }` to mean "no override" still get a usable
 * option. Primitives stringify directly. Anything non-primitive
 * (functions, capture tokens, JSX stubs, helper wrappers, figma.code
 * results, plain objects) returns `undefined` so the orchestrator
 * surfaces the option in `skippedOptionLabels` — the panel can't
 * render those shapes.
 */
function coerceEnumValue(raw) {
    if (raw === undefined || raw === null)
        return '';
    switch (typeof raw) {
        case 'string':
            return raw;
        case 'number':
        case 'boolean':
        case 'bigint':
            return String(raw);
        default:
            // Functions, objects, capture tokens, jsx stubs, figma.code results, etc.
            // — none of these can be sensibly rendered as a panel value.
            return undefined;
    }
}
/**
 * Produce a fresh capture token. Returns:
 *  - `token` — the Symbol used as the capture's identity in `extract_jsx_info`
 *    (looked up via symbol identity through the proxy's `TOKEN_META` entry).
 *  - `proxy` — the value the template author actually sees and interpolates
 *    into `figma.code\`<X attr={${...}}/>\``. Both refer to the same
 *    capture; the proxy is the surface, the symbol is the identity.
 *
 * The proxy is a Proxy around a function target so a template can both
 * use it as a value (`<X attr={${token}} />`) and call it
 * (`token.executeTemplate()`) without crashing — the latter happens
 * inside chained inert helpers. See the inline comments for the
 * specific traps and why each one is set the way it is.
 */
function makeToken(meta) {
    const symbol = Symbol(`figma:${meta.kind}:${meta.figmaPropName}`);
    // The proxy is what the template author sees. It needs to:
    //  - be uniquely identifiable later (via TOKEN_META lookup),
    //  - stringify to something readable if the template concatenates it,
    //  - tolerate arbitrary property accesses by returning further proxies
    //    so chains like `instance.getInstanceSwap('Icon')?.executeTemplate()`
    //    don't throw during execution.
    // The `getPrototypeOf` trap returns null so a template can't walk
    // through the proxy's host-realm function target to reach host
    // `Function.prototype.constructor` and synthesize code in the host
    // realm. Without the trap, `Object.getPrototypeOf(token).constructor`
    // is a real escape (host Function returned regardless of the V8
    // codegen disable on the sandbox context).
    const proxy = new Proxy(function tokenProxy() { }, {
        get(_target, prop) {
            if (prop === Symbol.toPrimitive)
                return () => `__FIGMA_${meta.kind.toUpperCase()}_${meta.figmaPropName}__`;
            if (prop === 'toString')
                return () => `__FIGMA_${meta.kind.toUpperCase()}_${meta.figmaPropName}__`;
            if (prop === Symbol.iterator)
                return undefined;
            if (prop === 'then')
                return undefined; // don't accidentally look thenable to await/promise chains
            if (prop === 'constructor')
                return undefined;
            // Any other access returns a benign passthrough proxy so chained calls
            // like `.executeTemplate().example` don't throw mid-execution.
            return chainStub;
        },
        getPrototypeOf() {
            return null;
        },
        apply() {
            return chainStub;
        },
        has() {
            return true;
        },
    });
    TOKEN_META.set(proxy, { symbol, kind: meta.kind, figmaPropName: meta.figmaPropName });
    return { token: symbol, proxy };
}
/**
 * Inert passthrough used inside the token proxy so arbitrary chains
 * don't throw. Same null-prototype + `constructor: undefined` defenses
 * as `makeToken` so a deep chain like `token.foo.bar.constructor`
 * can't reach the host Function constructor.
 */
const chainStub = new Proxy(function chainStubFn() { }, {
    get(_t, prop) {
        if (prop === Symbol.toPrimitive)
            return () => '';
        if (prop === 'toString')
            return () => '';
        if (prop === 'then')
            return undefined;
        if (prop === 'constructor')
            return undefined;
        if (prop === 'example')
            return Object.freeze([]);
        if (prop === 'metadata')
            return Object.create(null);
        return chainStub;
    },
    getPrototypeOf() {
        return null;
    },
    apply() {
        return chainStub;
    },
    has() {
        return true;
    },
});
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
function buildMockFigma() {
    const captures = [];
    function record(rec, proxy) {
        captures.push(rec);
        return proxy;
    }
    function coercePropName(name) {
        return typeof name === 'string' ? name : String(name);
    }
    const mockInstance = {
        getString(name) {
            const figmaPropName = coercePropName(name);
            const { token, proxy } = makeToken({ kind: 'text', figmaPropName });
            return record({ token, kind: 'text', figmaPropName }, proxy);
        },
        getBoolean(name, _mapping) {
            const figmaPropName = coercePropName(name);
            const { token, proxy } = makeToken({ kind: 'boolean', figmaPropName });
            return record({ token, kind: 'boolean', figmaPropName }, proxy);
        },
        getEnum(name, mapping) {
            const figmaPropName = coercePropName(name);
            const { token, proxy } = makeToken({ kind: 'enum', figmaPropName });
            const { options, skippedOptionLabels, droppedReason } = parseEnumOptions(mapping);
            return record({
                token,
                kind: 'enum',
                figmaPropName,
                options,
                skippedOptionLabels,
                droppedReason,
            }, proxy);
        },
        getInstanceSwap(name) {
            const figmaPropName = coercePropName(name);
            const { token, proxy } = makeToken({ kind: 'reference', figmaPropName });
            return record({ token, kind: 'reference', figmaPropName }, proxy);
        },
        getSlot(name) {
            const figmaPropName = coercePropName(name);
            const { token, proxy } = makeToken({ kind: 'slot', figmaPropName });
            return record({ token, kind: 'slot', figmaPropName }, proxy);
        },
        // Inert stubs - present so templates that exercise these features don't
        // crash mid-execution. The mocks return shapes that satisfy the typical
        // template-file usage patterns (chained `.executeTemplate().example`,
        // array `.map(...)`, etc.).
        getPropertyValue(_name) {
            return '';
        },
        hasCodeConnect() {
            return false;
        },
        codeConnectId() {
            return null;
        },
        findInstance(_layerName) {
            return mockInstance;
        },
        findText(_layerName) {
            const r = Object.create(null);
            r.type = 'TEXT';
            r.name = '';
            r.textContent = '';
            return r;
        },
        findConnectedInstance(_id) {
            return null;
        },
        findConnectedInstances(_selectorFn) {
            return [];
        },
        findLayers(_selectorFn) {
            return [];
        },
        executeTemplate() {
            const r = Object.create(null);
            r.example = [];
            r.metadata = Object.create(null);
            return r;
        },
    };
    // `figma.code` and the language-tag aliases all share one implementation
    // that captures the tagged-template structure for `extract_jsx_info` to walk
    // afterwards. The result object uses a null prototype so the template
    // can't reach host `Function.prototype.constructor` via
    // `figma.code\`x\`.constructor.constructor('return process')()`.
    function makeFigmaCode() {
        return (strings, ...values) => {
            const result = Object.create(null);
            result[exports.FIGMA_CODE_MARKER] = true;
            result.strings = strings;
            result.values = values;
            return result;
        };
    }
    const codeImpl = makeFigmaCode();
    // Legacy V1 properties API. Still part of the public template-file API
    // surface alongside the V2 `getX` methods on the instance handle. Real
    // templates and our migration tooling default to V2, but pre-2024
    // templates use V1 and we want them to keep producing prop descriptors.
    // Each method here records the same kind of capture as its V2 counterpart
    // so the orchestrator and `extract_jsx_info` logic don't need to know
    // which API the template used.
    const propertiesV1 = {
        string(name) {
            return mockInstance.getString(name);
        },
        boolean(name, options) {
            return mockInstance.getBoolean(name, options);
        },
        enum(name, options) {
            return mockInstance.getEnum(name, options);
        },
        instance(name) {
            // V1 `instance` maps to V2 `getInstanceSwap` (both inspect an instance-swap prop).
            return mockInstance.getInstanceSwap(name);
        },
        slot(name) {
            return mockInstance.getSlot(name);
        },
        // V1 `children(layerNames: string[])` is for rendering nested layers, not
        // for surfacing a panel prop. Return an inert empty array so templates
        // that use it don't crash; we don't emit a descriptor for it.
        children(_layerNames) {
            return [];
        },
    };
    mockInstance.__properties__ = propertiesV1;
    const figma = {
        selectedInstance: mockInstance,
        currentLayer: mockInstance,
        properties: propertiesV1,
        code: codeImpl,
        tsx: codeImpl,
        html: codeImpl,
        swift: codeImpl,
        kotlin: codeImpl,
        value(raw, preview) {
            const r = Object.create(null);
            r[exports.FIGMA_VALUE_MARKER] = true;
            r.type = 'value';
            r.value = raw;
            r.preview = preview;
            return r;
        },
        // Per-batch substitutions are looked up via property access. Return a
        // proxy that resolves any key to a placeholder string so batch templates
        // still execute. `getPrototypeOf` returns null so the template can't
        // walk to host `Object.prototype.constructor`.
        batch: new Proxy(Object.create(null), {
            get(_t, prop) {
                if (typeof prop === 'symbol')
                    return undefined;
                if (prop === 'constructor')
                    return undefined;
                return `__BATCH_${String(prop)}__`;
            },
            getPrototypeOf() {
                return null;
            },
        }),
        helpers: {
            react: {
                renderProp(name, prop) {
                    // Return a marker that carries BOTH the JSX attribute name and the
                    // raw capture-token proxy. `extract_jsx_info` reads the marker to
                    // bind `attrName → captureSymbol` even though the placeholder lands
                    // in tag-content position (between `<Tag` and `>`) rather than
                    // inside `attr={…}`. The marker is never stringified at compile
                    // time — `figma.code` is a tagged template, so values flow through
                    // `code.values[]` as raw object refs.
                    return {
                        [exports.RENDER_PROP_MARKER]: true,
                        attrName: String(name),
                        prop,
                    };
                },
                renderChildren(prop) {
                    return String(prop);
                },
                renderPropValue(prop) {
                    return String(prop);
                },
                stringifyObject(o) {
                    try {
                        return JSON.stringify(o);
                    }
                    catch {
                        return '{}';
                    }
                },
                jsxElement(v) {
                    return makeHelperWrapper('jsx-element', v);
                },
                function(v) {
                    return makeHelperWrapper('function', v);
                },
                identifier(v) {
                    return makeHelperWrapper('identifier', v);
                },
                object(v) {
                    return makeHelperWrapper('object', v);
                },
                templateString(v) {
                    return makeHelperWrapper('template-string', v);
                },
                reactComponent(v) {
                    return makeHelperWrapper('react-component', v);
                },
                array(v) {
                    return makeHelperWrapper('array', v);
                },
                isReactComponentArray() {
                    return false;
                },
            },
            swift: {
                renderChildren(c) {
                    return c;
                },
            },
            kotlin: {
                renderChildren(c) {
                    return c;
                },
            },
        },
    };
    // jsx-runtime stub. Templates rarely include JSX as enum option values, but
    // when they do, `ts.transpileModule` emits `react/jsx-runtime.jsx(...)`
    // calls — which our require shim resolves to this stub. The returned objects
    // carry JSX_STUB_MARKER so enum-option parsing in figma_code_connect can skip them.
    // Each return value is null-prototyped so it isn't a constructor-walk
    // escape vector — see `figma.code` for the same defense.
    const jsxRuntime = {
        jsx(tag, props) {
            return makeJsxStub(tag, props);
        },
        jsxs(tag, props) {
            return makeJsxStub(tag, props);
        },
        jsxDEV(tag, props) {
            return makeJsxStub(tag, props);
        },
        Fragment: Symbol.for('react.Fragment'),
    };
    return { figma, jsxRuntime, captures };
}
/**
 * Helper-wrapper / jsx-stub builders. Both produce null-prototype
 * objects so the template can't escape the sandbox via
 * `helperResult.constructor.constructor('…')`. The returned shapes
 * are unchanged from the previous object-literal versions; downstream
 * readers (`extract_jsx_info`, enum-option parsing) only check own
 * properties (`$type`, `$value`, marker symbols) which work the same
 * with a null prototype.
 */
function makeHelperWrapper(kind, value) {
    const r = Object.create(null);
    r.$type = kind;
    r.$value = value;
    return r;
}
function makeJsxStub(tag, props) {
    const r = Object.create(null);
    r[exports.JSX_STUB_MARKER] = true;
    r.tag = tag;
    r.props = props;
    return r;
}
