import { CodeConnectJSON } from '../connect/figma_connect';
export declare function getFilenameFromComponentName(componentName: string): string;
/** Migrates a doc's template (Swift helpers, server helpers, V2, id, imports, nestable) and returns the formatted string. */
export declare function prepareMigratedTemplate(doc: CodeConnectJSON, includeProps?: boolean, useTypeScript?: boolean): string;
export type WriteTemplateFileOptions = {
    localSourcePath?: string;
    filePathsCreated?: Set<string>;
    includeProps?: boolean;
    useTypeScript?: boolean;
};
export declare function writeTemplateFile(doc: CodeConnectJSON, outputDir: string | undefined, baseDir: string, { localSourcePath, filePathsCreated, includeProps, useTypeScript, }?: WriteTemplateFileOptions): {
    outputPath: string;
    skipped: boolean;
};
export declare function migrateTemplateToUseServerSideHelpers(template: string): string;
export declare function addId(template: string, id: string): string;
export declare function addImports(template: string, imports: string[] | undefined): string;
export declare function addNestableToMetadata(template: string, nestable: boolean): string;
/**
 * Migrates V1 templates to V2 API.
 *
 * This performs safe, incremental transformations. The following patterns
 * are intentionally NOT migrated as they're still supported in V2:
 *
 * - __props metadata building pattern - still valid JavaScript
 * - __renderWithFn__() - complex transformation, still supported
 *
 * These may be addressed in future migrations.
 */
export declare const migrateV1TemplateToV2: (template: string) => string;
/**
 * Removes the __props definition and props assignments. These are only used by icons
 * helpers and significantly bloat templates.
 */
export declare function removePropsDefinition(template: string): string;
/**
 * Removes the __props definition/assignments and removes __props from the default export
 */
export declare function removePropsDefinitionAndMetadata(template: string): string;
type CodeConnectObjectsForFigmaUrl = {
    main: CodeConnectJSON | null;
    variants: CodeConnectJSON[];
};
/**
 * For each figmaUrl in the given codeConnectObjects, return the main (non-variant)
 * codeConnectObject plus a list of any variants
 */
export declare const groupCodeConnectObjectsByFigmaUrl: (codeConnectObjects: CodeConnectJSON[]) => Record<string, CodeConnectObjectsForFigmaUrl>;
/** One parserless file per component: branch per variant, each with its own props and template object; export default template. */
export declare function writeVariantTemplateFile(group: CodeConnectObjectsForFigmaUrl, figmaUrl: string, outputDir: string | undefined, baseDir: string, { localSourcePath, filePathsCreated, useTypeScript, includeProps, }?: WriteTemplateFileOptions): {
    outputPath: string;
    skipped: boolean;
};
export {};
