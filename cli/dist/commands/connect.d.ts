import * as commander from 'commander';
import { ProjectInfo } from '../connect/project';
import { CodeConnectJSON } from '../connect/figma_connect';
export type BaseCommand = commander.Command & {
    token: string;
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
export declare function addConnectCommandToProgram(program: commander.Command): void;
export declare function getAccessToken(cmd: BaseCommand): string;
export declare function getAccessTokenOrExit(cmd: BaseCommand): string;
export declare function getDir(cmd: BaseCommand): string;
export declare function setupHandler(cmd: BaseCommand): void;
export declare function getCodeConnectObjects(cmd: BaseCommand & {
    label?: string;
}, projectInfo: ProjectInfo, silent?: boolean, isForMigration?: boolean): Promise<CodeConnectJSON[]>;
