"use strict";
/**
 * Read + parse pass used by `createCompiler().build()`.
 *
 * Discovery itself lives one level up in `compiler.ts#build` (which
 * composes `parseOrDetermineConfig` + `resolveTemplateGlobs` +
 * `discoverFilesByGlob` from `cli/src/connect/project.ts`). This module
 * is the downstream pure step: given the already-discovered file list
 * and the in-memory descriptor store, mutate the store to reflect what
 * exists on disk right now and report any warnings collected along the
 * way. Extracted from `compiler.ts` so the orchestration is testable on
 * its own and the compiler factory stays focused on lifecycle +
 * serialization.
 *
 * Two concerns, in order:
 *
 *  1. **Cleanup-on-disappear.** Any file in the previous build's
 *     discovered set that is NOT in the new set is deleted from the
 *     descriptor store. The cleanup is driven by the caller's
 *     `previousDiscoveredFiles` (rather than asking the store to
 *     enumerate its keys) because the store doesn't expose its key
 *     set, and doesn't need to.
 *
 *  2. **Read + parse.** Files are processed in fixed-size chunks of
 *     `READ_CONCURRENCY` parallel reads. Each chunk's reads run
 *     concurrently via `Promise.all`; the chunks themselves run
 *     sequentially. The chunk size bounds open file descriptors so
 *     icon-library-scale projects (thousands of templates) don't
 *     exhaust the per-process FD limit. Parsing itself is fully
 *     synchronous (`ts.transpileModule` + `vm.runInContext`), so
 *     there's nothing to parallelize within a parse — we just let
 *     each chunk's parses run inline as the reads resolve.
 *
 * Read failures inside `parseComponentDescriptorsFromFile` return
 * `undefined`, which we surface as a warning AND clear that file's
 * descriptors via `replace([])` — the same delete semantics as the
 * cleanup pass above, so a file that vanishes between `read()` and
 * `parse()` ends up removed regardless of which step noticed.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.build = build;
const parse_template_file_source_1 = require("./template_files/parse_template_file_source");
/**
 * Maximum number of `parseComponentDescriptorsFromFile` calls in flight at
 * once. Sized to comfortably stay under the typical `ulimit -n` soft cap
 * (1024 on Linux/macOS, less on Windows) while still saturating I/O on
 * an SSD.
 */
const READ_CONCURRENCY = 32;
async function build({ root, nextDiscoveredFiles, previousDiscoveredFiles, componentDescriptors, timeoutMs }) {
    const warnings = [];
    const newDiscovered = new Set(nextDiscoveredFiles);
    // Drop descriptors for files we saw last build but didn't see this
    // time. We iterate our own previously-tracked set so the cleanup is
    // self-contained — `ComponentDescriptorStore` doesn't expose a public
    // list of keys, and doesn't need to.
    for (const previous of previousDiscoveredFiles) {
        if (!newDiscovered.has(previous))
            componentDescriptors.delete(previous);
    }
    // Read + parse each chunk concurrently. `parseComponentDescriptorsFromFile`
    // handles its own read-error path (returns `undefined`), so a missing
    // file just becomes a "no descriptors" clear of that entry. The chunk
    // boundary bounds open file descriptors.
    for (let i = 0; i < nextDiscoveredFiles.length; i += READ_CONCURRENCY) {
        const chunk = nextDiscoveredFiles.slice(i, i + READ_CONCURRENCY);
        const chunkResults = await Promise.all(chunk.map(async (filePath) => ({
            filePath,
            result: await (0, parse_template_file_source_1.parseComponentDescriptorsFromFile)(filePath, timeoutMs, root),
        })));
        for (const { filePath, result } of chunkResults) {
            if (result === undefined) {
                warnings.push(`${filePath}: read failed`);
                componentDescriptors.replace(filePath, []);
                continue;
            }
            if (result.warnings?.length) {
                for (const w of result.warnings)
                    warnings.push(w);
            }
            componentDescriptors.replace(filePath, result.descriptors);
        }
    }
    return {
        discoveredTemplateFiles: newDiscovered,
        warnings,
    };
}
