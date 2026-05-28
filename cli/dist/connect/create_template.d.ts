import { type FigmaConnectionComponent } from './parser_executable_types';
import { ProjectInfo } from './project';
import { BaseCommand } from '../commands/connect_template';
interface GenerateDocsArgs {
    accessToken: string;
    figmaNodeUrl: string;
    outFile: string;
    outDir: string;
    projectInfo: ProjectInfo;
    cmd: BaseCommand;
}
export declare function normalizeComponentName(name: string): string;
export declare function createCodeConnectFromUrl({ accessToken, figmaNodeUrl, outFile, outDir, projectInfo, cmd, }: GenerateDocsArgs): Promise<void>;
interface CreateTemplateArgs {
    component: FigmaConnectionComponent;
    normalizedName: string;
    destinationDir: string;
    destinationFile: string | undefined;
}
export declare function createTemplateCodeConnect(args: CreateTemplateArgs): string;
export {};
