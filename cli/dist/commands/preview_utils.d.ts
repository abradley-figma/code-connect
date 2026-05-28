import { BaseCommand } from './connect';
import { CodeConnectJSON } from '../connect/figma_connect';
export interface NodeToPreview {
    fileKey: string;
    nodeId: string;
    url: string;
    filePath: string;
}
export interface PreviewResult {
    url: string;
    nodeId: string;
    filePath: string;
    success: boolean;
    snippet?: string;
    language?: string;
    component?: string;
    error?: string;
}
/**
 * Collect nodes to preview from file arguments.
 * Matches by exact path first, then by basename.
 */
export declare function collectNodesToPreview(files: string[], allCodeConnectObjects: CodeConnectJSON[], dir: string, cmd: BaseCommand): Promise<NodeToPreview[]>;
/**
 * Filter templates to only those matching the requested node IDs.
 */
export declare function filterTemplatesForNodes(nodeIds: string[], allTemplates: CodeConnectJSON[]): CodeConnectJSON[];
export declare function getPrettierParserMap(): Record<string, string>;
/**
 * Check if a snippet can be parsed by Prettier.
 * Returns true for languages without a Prettier parser (nothing to validate).
 */
export declare function isPrettierParseable(snippet: string, language?: string): Promise<boolean>;
/**
 * Format snippet with Prettier.
 * Returns the snippet unmodified for languages Prettier doesn't support.
 */
export declare function formatSnippet(snippet: string, language?: string): Promise<string>;
/**
 * Display results with terminal colors
 */
export declare function displayResults(results: PreviewResult[]): void;
/**
 * Handle the preview command
 */
export declare function handlePreview(files: string[], cmd: BaseCommand & {
    output?: string;
}): Promise<void>;
