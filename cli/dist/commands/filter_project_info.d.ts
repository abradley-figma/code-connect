import { ProjectInfo } from '../connect/project';
/**
 * If --file is specified, filter projectInfo.files to only include that file.
 * Exits with an error if the file doesn't exist or isn't in the project's file list.
 */
export declare function filterProjectInfoByFile(projectInfo: ProjectInfo, file: string | undefined): ProjectInfo;
