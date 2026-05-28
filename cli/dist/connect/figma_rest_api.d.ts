export declare function getApiUrl(figmaNode: string, apiUrlOverride?: string): string;
export declare function getHeaders(token: string, useOAuth?: boolean): Record<string, string>;
export declare namespace FigmaRestApi {
    enum ComponentPropertyType {
        Boolean = "BOOLEAN",
        InstanceSwap = "INSTANCE_SWAP",
        Text = "TEXT",
        Variant = "VARIANT"
    }
    interface ComponentPropertyDefinition {
        defaultValue: boolean | string;
        type: ComponentPropertyType;
        /**
         * All possible values for this property. Only exists on VARIANT properties
         */
        variantOptions?: string[];
        /**
         * Only exists on INSTANCE_SWAP  properties
         */
        preferredValues?: {
            type: string;
            key: string;
        }[];
    }
    interface Node {
        type: 'COMPONENT' | 'COMPONENT_SET' | 'OTHER' | 'CANVAS';
        name: string;
        id: string;
        children: Node[];
    }
    interface NodeWithPageInfo extends Node {
        pageId: string;
        pageName: string;
    }
    interface Component extends NodeWithPageInfo {
        type: 'COMPONENT' | 'COMPONENT_SET';
        componentPropertyDefinitions: Record<string, ComponentPropertyDefinition>;
    }
}
export declare function getDocument(url: string, accessToken: string): Promise<FigmaRestApi.Node>;
