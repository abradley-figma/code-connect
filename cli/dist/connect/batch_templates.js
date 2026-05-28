"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseBatchFile = parseBatchFile;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const raw_templates_1 = require("./raw_templates");
/**
 * Resolves and validates the template file path referenced by a batch group.
 * Returns the absolute path or throws a descriptive error.
 */
function validateBatchTemplatePath(templateFile, batchDir, batchFilePath) {
    const templatePath = path_1.default.resolve(batchDir, templateFile);
    if (!fs_1.default.existsSync(templatePath)) {
        throw new Error(`Template file not found: ${templatePath} (referenced from ${batchFilePath})`);
    }
    if (!templatePath.endsWith('.figma.batch.ts') && !templatePath.endsWith('.figma.batch.js')) {
        throw new Error(`Template file must have a .figma.batch.ts or .figma.batch.js extension: ${templatePath}`);
    }
    return templatePath;
}
/**
 * Parses a `.figma.batch.json` file and produces CodeConnectJSON objects.
 *
 * For each component entry, delegates to `parseRawFile` with batch overrides
 * that prepend `window['__FIGMA_BATCH'] = <data>` to the template. The figma
 * runtime exposes this as `figma.batch`.
 */
function parseBatchFile(filePath, label, config, dir) {
    const raw = fs_1.default.readFileSync(filePath, 'utf-8');
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch (e) {
        throw new Error(`Failed to parse JSON in ${filePath}: ${e}`);
    }
    // Support both single group (object) and multiple groups (array)
    const groups = Array.isArray(parsed) ? parsed : [parsed];
    const results = [];
    const batchDir = path_1.default.dirname(filePath);
    for (const group of groups) {
        if (!group.templateFile) {
            throw new Error(`Missing required field "templateFile" in ${filePath}`);
        }
        if (!Array.isArray(group.components) || group.components.length === 0) {
            throw new Error(`"components" must be a non-empty array in ${filePath}`);
        }
        const templatePath = validateBatchTemplatePath(group.templateFile, batchDir, filePath);
        for (let i = 0; i < group.components.length; i++) {
            const entry = group.components[i];
            if (!entry.url) {
                const entryName = entry.name || entry.component || `index ${i}`;
                throw new Error(`Missing required field "url" in entry "${entryName}" in ${filePath}`);
            }
            const doc = (0, raw_templates_1.parseRawFile)(templatePath, label, config, dir, {
                url: entry.url,
                source: entry.source,
                component: entry.component,
                batchData: entry,
                batchFilePath: filePath,
            });
            results.push(doc);
        }
    }
    return results;
}
