"use strict";
/**
 * Heuristically infers the codebase component name a template targets.
 * Lives in its own module because the rules differ from
 * `resolve_component_source` (which resolves a SOURCE PATH for a
 * known component name) and have a different precedence order.
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
exports.inferComponentName = inferComponentName;
const path = __importStar(require("node:path"));
/**
 * Match a valid PascalCase identifier — first character must be uppercase
 * A-Z (so React treats the JSX tag as a component, not a primitive),
 * remaining characters are JS identifier-safe. Used by both
 * `pickFromDirective` (validating `// component=` values) and
 * `basenameComponent` (validating the camelCased filename) so the
 * "looks like a React component name" rule is centralized.
 */
const IDENT_RE = /^[A-Z][A-Za-z0-9_$]*$/;
/**
 * Resolve the React component name a template describes. Walks three
 * tiers in priority order; first match wins:
 *
 *  1. **`// component=` directive** — bare identifier or
 *     `path#Identifier`. Validated with `IDENT_RE`. Authoritative
 *     when present and parseable; non-identifier values fall through
 *     to tier 2 rather than producing nothing.
 *
 *  2. **JSX root tag from `figma.code`** — the first uppercase tag in
 *     the recovered template, e.g. `<Button …>`. Only used when the
 *     tag is itself component-shaped (capital first letter, valid
 *     identifier); HTML primitives like `<div>` skip to tier 3.
 *
 *  3. **File basename** — `Button.figma.ts` → `Button`,
 *     `my-button.figma.ts` → `MyButton`. Best-effort camelCase from
 *     `-`/`_`/`.`/space-delimited basenames.
 *
 * Returns `undefined` when every tier fails — the orchestrator emits
 * a "could not infer component name" warning and skips the descriptor.
 */
function inferComponentName(args) {
    const fromDirective = pickFromDirective(args.componentDirective);
    if (fromDirective)
        return fromDirective;
    if (args.rootTag && args.rootIsComponent && IDENT_RE.test(args.rootTag)) {
        return args.rootTag;
    }
    if (args.filePath)
        return basenameComponent(args.filePath);
    return undefined;
}
function pickFromDirective(directive) {
    if (!directive)
        return undefined;
    // The directive can be a bare identifier ("Button"), a relative import path
    // ("./button#Button"), or just a file reference. We only care about
    // identifiers — for now, ignore anything else.
    const candidate = directive.split('#').pop() ?? directive;
    if (IDENT_RE.test(candidate))
        return candidate;
    return undefined;
}
function basenameComponent(filePath) {
    const base = path.basename(filePath);
    const stripped = base
        .replace(/\.figma\.template\.tsx?$/i, '')
        .replace(/\.figma\.template\.jsx?$/i, '')
        .replace(/\.figma\.tsx?$/i, '')
        .replace(/\.figma\.jsx?$/i, '');
    if (!stripped)
        return undefined;
    // Best-effort: turn "my-button" / "my_button" into "MyButton".
    const camel = stripped
        .split(/[-_.\s]/)
        .filter(Boolean)
        .map((s) => s[0]?.toUpperCase() + s.slice(1))
        .join('');
    return IDENT_RE.test(camel) ? camel : undefined;
}
