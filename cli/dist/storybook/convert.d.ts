import { ReactProjectInfo } from '../connect/project';
import { CodeConnectJSON } from '../connect/figma_connect';
interface ConvertStorybookFilesArgs {
    /**
     * Optionally override the glob used to find stories. This is currently not
     * exposed in the config, but is used by the tests
     */
    storiesGlob?: string;
    /**
     * Information about the project
     */
    projectInfo: ReactProjectInfo;
    /**
     * Whether this conversion is for the migrate command. When true, template
     * helper function definitions are omitted from the template (they will be
     * replaced by server-side helpers during migration).
     */
    isForMigration?: boolean;
}
/**
 * Converts all Storyboook files in a directory into Code Connect objects. If a file
 * cannot be converted (e.g. unsupported syntax), it is ignored and an error is
 * logged.
 *
 * @param args
 * @returns An array of Code Connect objects
 */
export declare function convertStorybookFiles({ projectInfo, storiesGlob, isForMigration, }: ConvertStorybookFilesArgs): Promise<CodeConnectJSON[]>;
export {};
