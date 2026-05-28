/**
 * Heuristically infers the codebase component name a template targets.
 * Lives in its own module because the rules differ from
 * `resolve_component_source` (which resolves a SOURCE PATH for a
 * known component name) and have a different precedence order.
 */
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
export declare function inferComponentName(args: {
    componentDirective?: string;
    rootTag?: string;
    rootIsComponent?: boolean;
    filePath?: string;
}): string | undefined;
