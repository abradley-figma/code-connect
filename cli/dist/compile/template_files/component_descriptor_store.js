"use strict";
/**
 * Shared in-memory descriptor store. Bundler adapters create one
 * `ComponentDescriptorStore` and add/remove entries as templates are
 * discovered or change on disk. Serialization happens once at output time.
 *
 * Output is stable across runs: insertion order does not affect the
 * serialized result because `snapshot()` walks file keys in sorted order.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ComponentDescriptorStore = void 0;
const path_1 = require("../../common/path");
class ComponentDescriptorStore {
    constructor() {
        /** filePath -> descriptors that file produced. The file path is the
         *  ABSOLUTE template path (`.figma.ts`), not the React component
         *  source path — which is stored INSIDE each `ComponentDescriptor`'s
         *  `filePath` field. Intentionally private: callers go through
         *  `replace` / `delete` / `snapshot` so the "empty list ≡ no entry"
         *  invariant holds. */
        this.byFile = new Map();
    }
    /**
     * Unconditional set. Useful for tests that want to seed the store
     * without going through the parser. Production code should prefer
     * `replace`, which handles the "delete on empty descriptor list"
     * invariant and reports whether anything changed.
     */
    set(filePath, descriptors) {
        this.byFile.set(filePath, descriptors);
    }
    /**
     * Replace the descriptors for a single file. Empty lists are coerced
     * to a delete so `has(filePath)` stays a reliable "this file
     * contributed something" predicate (used by `compiler.updateFile`
     * to keep `discoveredTemplateFiles` in sync).
     *
     * Returns true if the file's descriptor list materially changed —
     * adapters use this to skip emitting an HMR invalidation when
     * nothing moved (saving a roundtrip per "save with no real change").
     */
    replace(filePath, descriptors) {
        const previous = this.byFile.get(filePath);
        const next = descriptors.length === 0 ? undefined : descriptors;
        if (descriptorsEqual(previous, next))
            return false;
        if (next === undefined) {
            this.byFile.delete(filePath);
        }
        else {
            this.byFile.set(filePath, next);
        }
        return true;
    }
    /** Drop the entry for `filePath` from the store. No-op if the
     *  template never produced descriptors. Used by `build()` to clean
     *  up files that disappeared between rebuilds. */
    delete(filePath) {
        this.byFile.delete(filePath);
    }
    /** True iff `filePath` has at least one descriptor in the store.
     *  Combined with `replace`'s "empty list deletes the entry" rule,
     *  this is the single source of truth for "is this template
     *  producing data right now". */
    has(filePath) {
        return this.byFile.has(filePath);
    }
    /** Number of template files currently producing descriptors.
     *  Mirrors `Map.prototype.size`; provided as a method (not a
     *  getter) for symmetry with the rest of the public API. */
    size() {
        return this.byFile.size;
    }
    /**
     * Return the flat `ComponentDescriptors` array shipped to the browser.
     *
     * Each descriptor's `filePath` is the React component's source path
     * (resolved at parse time) — NOT the `.figma.ts` template path. The
     * `byFile` map is keyed by the template path internally because that's
     * what the parser drives in; we don't surface those template paths
     * here. Source paths are rewritten to a project-relative POSIX string
     * so the runtime shim's string-equality check survives Windows-built
     * manifests. When the parser couldn't resolve a source path,
     * `filePath` stays `undefined` and only the runtime shim's name-only
     * fallback can match.
     *
     * Output is sorted by `(componentName, filePath ?? '')` so the
     * serialised JSON is stable across runs and insertion orders.
     */
    snapshot(root) {
        const out = [];
        for (const descriptors of this.byFile.values()) {
            for (const d of descriptors) {
                const relSourceFilePath = d.filePath
                    ? (0, path_1.normalizeRelativePath)(root, d.filePath)
                    : undefined;
                out.push({
                    ...d,
                    filePath: relSourceFilePath,
                });
            }
        }
        // Stable order across insertion / rebuilds. componentName first so
        // bundlers that diff manifest output get a clean changelog when a
        // single component moves files.
        out.sort((a, b) => {
            if (a.componentName !== b.componentName) {
                return a.componentName < b.componentName ? -1 : 1;
            }
            const fa = a.filePath ?? '';
            const fb = b.filePath ?? '';
            if (fa === fb)
                return 0;
            return fa < fb ? -1 : 1;
        });
        return out;
    }
}
exports.ComponentDescriptorStore = ComponentDescriptorStore;
/**
 * Deep equality between two descriptor lists. Identity-equal short-circuits;
 * presence-mismatch (one undefined, the other not) and length mismatch
 * are O(1) early outs; the fall-through is a `JSON.stringify` comparison.
 *
 * `JSON.stringify` is sufficient here because `ComponentDescriptor` is a
 * pure-data shape (no functions, no symbols, no Maps — see `types.ts`)
 * and the parser emits keys in the same order on every run, so
 * stringified outputs of equal descriptors are byte-equal. The
 * stringify cost is dominated by the parse cost upstream, so the
 * shortcut isn't worth optimizing further until profiling shows
 * otherwise.
 */
function descriptorsEqual(a, b) {
    if (a === b)
        return true;
    if (!a || !b)
        return false;
    if (a.length !== b.length)
        return false;
    return JSON.stringify(a) === JSON.stringify(b);
}
