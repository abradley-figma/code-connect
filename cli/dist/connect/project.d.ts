import ts from 'typescript';
import { SyntaxHighlightLanguage } from './label_language_mapping';
export declare const DEFAULT_INCLUDE_GLOBS_BY_PARSER: {
    react: string[];
    html: string[];
    swift: string[];
    compose: string[];
    custom: undefined;
    __unit_test__: string[];
};
export declare const DEFAULT_LABEL_PER_PARSER: Partial<Record<CodeConnectParser, string>>;
export type CodeConnectExecutableParser = 'swift' | 'compose' | 'custom' | '__unit_test__';
export type CodeConnectParser = 'react' | 'html' | CodeConnectExecutableParser;
export type BaseCodeConnectConfig = {
    /**
     * Specify glob patterns for files (relative to the project root) to be
     * included when looking for source files. If not specified, all files
     * (except any specified in `exclude`) will be included.
     */
    include?: string[];
    /**
     * Specify glob patterns for files (relative to the project root) to be
     * excluded when looking for source files. If not specified, only
     * `node_modules` will be excluded.
     */
    exclude?: string[];
    /**
     * Optional object of substitutions applied to document URLs (in the format {
     * fromString, toString }) for testing (e.g. remapping a production URL to a
     * staging URL). Not publicly documented.
     */
    documentUrlSubstitutions?: Record<string, string>;
    /**
     * The parser name, if using an internal parser.
     */
    parser?: CodeConnectParser;
    /**
     * Label to use for the uploaded code examples
     */
    label?: string;
    /**
     * Language to use for syntax highlighting in the uploaded code examples.
     * If not specified, language is inferred from the label or parser type.
     */
    language?: SyntaxHighlightLanguage;
    /**
     * The URL of the Figma file to use during the interactive setup wizard for connecting code components to Figma components.
     */
    interactiveSetupFigmaFileUrl?: string;
    /**
     * Custom Figma API URL to use instead of https://api.figma.com/v1
     */
    apiUrl?: string;
    /**
     * The default branch name for your repository. Code Connect uses this when generating source code
     * links in Figma. If not specified, Code Connect will attempt to determine this automatically.
     */
    defaultBranch?: string;
};
export type CodeConnectExecutableParserConfig = BaseCodeConnectConfig & {
    parser: CodeConnectExecutableParser;
};
export type CodeConnectCustomExecutableParserConfig = BaseCodeConnectConfig & {
    parser: 'custom';
    parserCommand: string;
};
/**
 * React specific configuration
 */
export type CodeConnectReactConfig = BaseCodeConnectConfig & {
    parser: 'react';
    /**
     * Maps imports from their path on disk to the specified path.
     * This will rewrite the imports in generated code examples, so it works with
     * relative imports such as `import { Button } from "./"`.
     *
     * Example: { "src/components/*": "@ui/components" }
     * Would rewrite imports for components located in `src/components` to `@ui/components` in
     * generated code examples.
     * `import { Button } from "./"` -> `import { Button } from "@ui/components/Button"`
     */
    importPaths?: Record<string, string>;
    /**
     * For import resolution - this is a temporary solution to support projects that use
     * pnpm workspaces, as the compiler doesn't seem to be able to resolve imports when
     * the package in node_modules is a symlink. Need to look into this more and find a
     * better solution.
     */
    paths?: Record<string, string[]>;
    /**
     * Storybook specific configuration
     */
    storybook?: {
        /**
         * The URL of the Storybook instance for the project
         */
        url: string;
    };
};
export type CodeConnectHtmlConfig = BaseCodeConnectConfig & {};
export type CodeConnectParserlessConfig = BaseCodeConnectConfig & {
    parser: undefined;
};
export type CodeConnectConfig = CodeConnectReactConfig | CodeConnectExecutableParserConfig | CodeConnectCustomExecutableParserConfig | CodeConnectHtmlConfig | BaseCodeConnectConfig | CodeConnectParserlessConfig;
interface FigmaConfig {
    codeConnect?: CodeConnectConfig;
}
export declare function determineConfigFromProject(dir: string, exitOnError?: boolean, isTemplatesOnlyCLI?: boolean): FigmaConfig | undefined;
export declare function determineLabelFromProject(dir: string): string | undefined;
export declare function getGitRemoteURL(repoPath: string): string;
/**
 * Uses `git rev-parse` to find absolute path to the root of the git repository
 */
export declare function getGitRepoAbsolutePath(filePath: string): string;
/**
 * Find the default branch name for the git repository
 */
export declare function getGitRepoDefaultBranchName(repoPath: string, configDefaultBranch?: string): string;
/**
 * Finds the URL of a remote file
 * @param filePath absolute file path on disk
 * @param repoURL remote URL, can be a GitHub, GitLab, Bitbucket, etc. URL.
 * @returns
 */
export declare function getRemoteFileUrl(filePath: string, repoURL?: string, defaultBranch?: string): string;
export declare function getStorybookUrl(filePath: string, storybookUrl: string): string;
export type ProjectInfo<ConfigT = CodeConnectConfig> = {
    /**
     * Absolute path of the project directory
     */
    absPath: string;
    /**
     * An array of all tsx files in the project
     */
    files: string[];
    /**
     * The git remote URL of the project
     */
    remoteUrl: string;
    /**
     * The parsed Code Connect config file
     */
    config: ConfigT;
};
export type ReactProjectInfo = ProjectInfo<CodeConnectReactConfig> & {
    /**
     * TS program containing all tsx files in the project
     */
    tsProgram: ts.Program;
};
export declare function getDefaultConfigPath(dir: string): string;
export declare function getEnvPath(dir: string): string;
export declare function parseOrDetermineConfig(dir: string, configPath: string, isTemplatesOnlyCLI?: boolean): Promise<{
    config: CodeConnectConfig;
    hasConfigFile: boolean;
}>;
/**
 * Check if a .env file exists in the provided directory and if it contains a FIGMA_ACCESS_TOKEN.
 */
export declare function checkForEnvAndToken(dir: string): Promise<{
    hasEnvFile: boolean;
    envHasFigmaToken: boolean;
}>;
/**
 * Resolve the effective template-file include/exclude globs for a Code
 * Connect config. `include` is taken from `config.include` when set,
 * otherwise from the parser-specific default (or the templates-only
 * defaults when `isTemplatesOnlyCLI` is `true`). `exclude` always
 * layers the parser/templates-only defaults underneath any
 * `config.exclude` the user supplied.
 *
 * Pure function — no I/O, no logging. Extracted from
 * `getProjectInfoFromConfig` so `cli/src/compile` (the bundler-adapter
 * compile pipeline) can reuse the exact same glob-resolution rules
 * without re-running `getProjectInfoFromConfig`'s git spawn + validation.
 *
 * Returns `include: undefined` when no parser is configured and no
 * include globs are given — callers are responsible for the error
 * behavior in that case (the CLI exits; the compile pipeline doesn't
 * hit it because it always runs in templates-only mode).
 */
export declare function resolveTemplateGlobs(config: CodeConnectConfig, isTemplatesOnlyCLI?: boolean): {
    include: string[] | undefined;
    exclude: string[];
};
/**
 * Run a glob against the project root and return template file paths.
 *
 * **Return shape:** sorted, deduplicated, absolute, POSIX-normalized.
 * The four guarantees are the public contract every consumer relies on:
 *
 *  - **Sorted** — deterministic across runs and platforms; the compile
 *    pipeline feeds the result straight into a `Set` to track
 *    discovered files, and downstream `getDiscoveredFiles()` returns
 *    the same sorted order callers expect.
 *  - **Deduplicated** — overlapping include globs (e.g.
 *    `['**\/*.figma.ts', '**\/*.figma.{ts,js}']`) won't double-count a
 *    file.
 *  - **Absolute** — paths can be read or `replace`d into descriptor
 *    stores without resolving against any per-caller cwd.
 *  - **POSIX-normalized** — backslashes from a Windows `glob` walk are
 *    rewritten to forward slashes so equality checks against descriptor
 *    store keys / runtime alias values / manifest entries survive
 *    multi-platform builds (every other path in the pipeline is also
 *    POSIX-normalized via `cli/src/common/path.ts`).
 *
 * Emits a warning when the match count crosses 10000 entries so users
 * with overly-broad globs find out before they hit upload limits.
 *
 * Extracted from `getProjectInfoFromConfig` so the compile pipeline can
 * reuse the exact same glob invocation (same path mapping, same options,
 * same warning threshold) without running the surrounding git spawn or
 * validation.
 *
 * Uses `glob`'s async API rather than `globSync` so the directory walk
 * doesn't block Node's event loop. Matters most for compile's bundler
 * adapters (Vite / Webpack / Next.js), where icon-library-scale
 * projects with thousands of templates would otherwise stall the dev
 * server's file watchers, HMR pings, and concurrent tasks behind the
 * full walk. The async API is at parity with `globSync` on options
 * shape and traversal — same `readdir` code path underneath.
 */
export declare function discoverFilesByGlob(root: string, include: string[], exclude: string[]): Promise<string[]>;
/**
 * Gets information about a project from config.
 *
 * @param dir Directory containing the project
 * @param config Code Connect config
 * @returns Object containing information about the project
 */
export declare function getProjectInfoFromConfig(dir: string, config: CodeConnectConfig, isTemplatesOnlyCLI?: boolean): Promise<ProjectInfo>;
/**
 * Predicate used by file-watch / HMR hooks to decide whether a changed
 * file is one Code Connect cares about. Mirrors the include/exclude
 * semantics of `discoverFilesByGlob` without performing any I/O — so
 * a bundler can fire it on every file save without a disk read.
 *
 * `relPath` MUST be a POSIX-shaped project-relative path (run through
 * `normalizeRelativePath` first); absolute paths and paths that escape
 * the project root (`..`) always return `false`.
 *
 * Exported so the compile pipeline (`cli/src/compile`) can share the
 * exact predicate `discoverFilesByGlob` would have matched, keeping
 * full-rebuild discovery and per-file HMR updates in agreement.
 */
export declare function isTemplateFilePath(relPath: string, include: string[], exclude: string[]): boolean;
/**
 * Gets information about a project from a directory.
 *
 * @param dir Directory containing the project
 * @param configPath Optional path to Code Connect config file
 * @returns Object containing information about the project
 */
export declare function getProjectInfo(dir: string, configPath: string, isTemplatesOnlyCLI?: boolean): Promise<ProjectInfo>;
export declare function getReactProjectInfo(projectInfo: ProjectInfo<CodeConnectReactConfig>): ReactProjectInfo;
export declare function getTsProgram(projectInfo: ProjectInfo<CodeConnectConfig>): ts.Program;
/**
 * Change an imported path for a component like `./button` to e.g `@ui/button`, based on the config file.
 * Note that `filePath` here is the path to the source file on disk, not the module specifier.
 *
 * @param filePath
 * @param config
 * @returns
 */
export declare function mapImportPath(filePath: string, config: CodeConnectReactConfig): string | null;
/**
 * Transform an import specifier (the path in the import statement) using importPaths config.
 * This works directly on the module specifier from the source code, preserving the user's intent.
 *
 * E.g., '@/AlertTitle' with config { "@/*": "@acme/package/*" } → '@acme/package/AlertTitle'
 *
 * @param specifier The original import specifier from the source file (e.g., '@/AlertTitle', './Button')
 * @param config The Code Connect config containing importPaths
 * @returns The transformed import path, or null if no mapping matched
 */
export declare function mapImportSpecifier(specifier: string, config: CodeConnectReactConfig): string | null;
export {};
