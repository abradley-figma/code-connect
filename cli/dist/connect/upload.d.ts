import { CodeConnectJSON } from '../connect/figma_connect';
interface Args {
    accessToken: string;
    useOAuth?: boolean;
    docs: CodeConnectJSON[];
    batchSize?: number;
    verbose: boolean;
    apiUrl?: string;
    force?: boolean;
}
/**
 * Creates a map from fileKey-nodeId to original docs for easy lookup
 */
export declare function createDocsMap(docs: CodeConnectJSON[], verbose: boolean): Map<string, CodeConnectJSON[]>;
export declare function upload({ accessToken, useOAuth, docs, batchSize, verbose, apiUrl: apiUrlOverride, force, }: Args): Promise<void>;
export {};
