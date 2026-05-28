/**
 * Slim Code Connect entry point template-files-only support.
 */
import * as commander from 'commander';
export type BaseCommand = commander.Command & {
    token: string;
    useOAuth: boolean;
    verbose: boolean;
    outFile: string;
    outDir: string;
    config: string;
    dryRun: boolean;
    dir: string;
    file: string;
    jsonFile: string;
    skipUpdateCheck: boolean;
    exitOnUnreadableFiles: boolean;
    apiUrl?: string;
    includeProps?: boolean;
};
interface ProgramOptions {
    /** Override how the auth token is retrieved. Return undefined to fall back to FIGMA_ACCESS_TOKEN. */
    getToken?: () => string | undefined;
}
/**
 * Registers Code Connect commands on a commander program, restricted to
 * template-file workflows only. Intended for use by CLIs that support
 * Code Connect during a migration period but do not need native parsers.
 *
 * Note: does NOT use addBaseCommand internally because that function registers
 * both `-o --outFile` and `-o --outDir` with the same `-o` short flag.
 * commander@12+ (used by litmus-cli) throws a conflict error on duplicate flags.
 */
export declare function addCodeConnectCommandsToProgram(program: commander.Command, programOptions?: ProgramOptions): void;
export {};
