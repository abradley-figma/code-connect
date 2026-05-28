import { FigmaConnectLink } from './api';
import { Intrinsic } from './intrinsics';
import { SyntaxHighlightLanguage } from './label_language_mapping';
export type BaseCodeConnectObject = {
    figmaNode: string;
    component?: string;
    variant?: Record<string, any>;
    template: string;
    templateData: {
        props?: Record<string, Intrinsic>;
        imports?: string[];
        nestable?: boolean;
        isParserless?: boolean;
    };
    language: SyntaxHighlightLanguage;
    label: string;
    links?: FigmaConnectLink[];
    source?: string;
    sourceLocation?: {
        line: number;
    };
};
export type CodeConnectJSON = BaseCodeConnectObject & {
    metadata: {
        cliVersion: string;
    };
    _codeConnectFilePath?: string;
};
