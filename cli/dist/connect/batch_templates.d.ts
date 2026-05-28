import { CodeConnectJSON } from './figma_connect';
import { CodeConnectConfig } from './project';
/**
 * Parses a `.figma.batch.json` file and produces CodeConnectJSON objects.
 *
 * For each component entry, delegates to `parseRawFile` with batch overrides
 * that prepend `window['__FIGMA_BATCH'] = <data>` to the template. The figma
 * runtime exposes this as `figma.batch`.
 */
export declare function parseBatchFile(filePath: string, label: string | undefined, config?: CodeConnectConfig, dir?: string): CodeConnectJSON[];
