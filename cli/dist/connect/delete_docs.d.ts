interface NodesToDeleteInfo {
    figmaNode: string;
    label: string;
}
interface Args {
    accessToken: string;
    useOAuth?: boolean;
    docs: NodesToDeleteInfo[];
    apiUrl?: string;
}
export declare function delete_docs({ accessToken, useOAuth, docs, apiUrl: apiUrlOverride, }: Args): Promise<void>;
export {};
