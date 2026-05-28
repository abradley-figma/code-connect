export type EmbeddingsResponse = {
    status: number;
    error: boolean;
    meta: {
        embeddings: number[][];
    };
};
export declare function fetchEmbeddings({ uniqueMatchableNames, accessToken, figmaUrl, apiUrlOverride, }: {
    uniqueMatchableNames: string[];
    accessToken: string;
    figmaUrl: string;
    apiUrlOverride?: string;
}): Promise<EmbeddingsResponse>;
