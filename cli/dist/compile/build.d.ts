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
import { type ComponentDescriptorStore } from './template_files/component_descriptor_store';
export interface BuildInputs {
    /** Absolute, POSIX-normalized project root the templates were
     *  discovered relative to. Forwarded to
     *  `parseComponentDescriptorsFromFile` so the parse pass can
     *  resolve any relative paths the template itself emits. */
    root: string;
    /** Sorted, deduped, absolute, POSIX-normalized template paths to
     *  read + parse. Already filtered by the caller's include / exclude
     *  globs via `discoverFilesByGlob` — this module trusts the list
     *  without re-filtering. */
    nextDiscoveredFiles: string[];
    /** Files we discovered on the previous build — used to compute the
     *  set of files that disappeared since last time so we can clear
     *  their descriptors. Empty `Set` on the very first build. */
    previousDiscoveredFiles: Set<string>;
    /** In-memory descriptor store that this build mutates in place. */
    componentDescriptors: ComponentDescriptorStore;
    /** Per-template execution timeout (ms) handed down to
     *  `executeTemplate` via `parseComponentDescriptorsFromFile`. */
    timeoutMs: number;
}
export interface BuildOutputs {
    /** Sorted absolute paths of template files that exist on disk RIGHT
     *  NOW. Caller assigns this to its `discoveredTemplateFiles` set so
     *  the next build can compute the disappear-set against it. */
    discoveredTemplateFiles: Set<string>;
    /** Warnings collected from discover + read + parse. The compiler
     *  factory bubbles these out as `CodeConnectBuildResult.warnings`. */
    warnings: string[];
}
export declare function build({ root, nextDiscoveredFiles, previousDiscoveredFiles, componentDescriptors, timeoutMs }: BuildInputs): Promise<BuildOutputs>;
