import { CodeConnectJSON } from './figma_connect';
import { CodeConnectConfig } from './project';
/**
 * Returns true if the file content looks like a raw template file, i.e. its
 * leading comment block contains a `// url=`, `// component=`, or `// source=`
 * directive. Used to distinguish raw `.figma.ts` templates from React/HTML
 * Code Connect files that share the same extension.
 */
export declare function isRawTemplate(content: string): boolean;
export interface BatchOverrides {
    url: string;
    source?: string;
    component?: string;
    batchData: Record<string, any>;
    batchFilePath: string;
}
export declare function parseRawFile(filePath: string, label: string | undefined, config?: CodeConnectConfig, dir?: string, batchOverrides?: BatchOverrides): CodeConnectJSON;
