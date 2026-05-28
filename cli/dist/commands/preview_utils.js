"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectNodesToPreview = collectNodesToPreview;
exports.filterTemplatesForNodes = filterTemplatesForNodes;
exports.getPrettierParserMap = getPrettierParserMap;
exports.isPrettierParseable = isPrettierParseable;
exports.formatSnippet = formatSnippet;
exports.displayResults = displayResults;
exports.handlePreview = handlePreview;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const prettier = __importStar(require("prettier"));
const connect_1 = require("./connect");
const logging_1 = require("../common/logging");
const validation_1 = require("../connect/validation");
const project_1 = require("../connect/project");
const figma_rest_api_1 = require("../connect/figma_rest_api");
const fetch_1 = require("../common/fetch");
/**
 * Collect nodes to preview from file arguments.
 * Matches by exact path first, then by basename.
 */
async function collectNodesToPreview(files, allCodeConnectObjects, dir, cmd) {
    const nodesToPreview = [];
    for (const filePath of files) {
        const resolvedPath = path_1.default.isAbsolute(filePath) ? filePath : path_1.default.resolve(dir, filePath);
        // Try exact path first
        if (fs_1.default.existsSync(resolvedPath) && fs_1.default.statSync(resolvedPath).isFile()) {
            const docs = allCodeConnectObjects.filter((d) => path_1.default.resolve(d._codeConnectFilePath || '') === resolvedPath);
            if (docs.length > 0) {
                if (docs.length === 1) {
                    logging_1.logger.info(`Found: ${filePath}`);
                }
                else {
                    logging_1.logger.info(`Found ${docs.length} component definition(s) in ${filePath}`);
                }
                for (const doc of docs) {
                    const parsed = (0, validation_1.parseFigmaNode)(cmd.verbose, doc, true);
                    if (parsed) {
                        nodesToPreview.push({
                            fileKey: parsed.fileKey,
                            nodeId: parsed.nodeId,
                            url: doc.figmaNode,
                            filePath: path_1.default.relative(dir, doc._codeConnectFilePath || ''),
                        });
                    }
                    else {
                        logging_1.logger.error(`Failed to parse figmaNode from file: ${filePath}`);
                    }
                }
            }
            else {
                logging_1.logger.error(`Not a valid Code Connect file: ${filePath}`);
            }
            continue;
        }
        // Fall back to basename matching
        const fileName = path_1.default.basename(filePath);
        if (cmd.verbose) {
            logging_1.logger.debug(`Searching for files matching: ${fileName}`);
            logging_1.logger.debug(`Total Code Connect objects: ${allCodeConnectObjects.length}`);
        }
        const matches = allCodeConnectObjects.filter((d) => path_1.default.basename(d._codeConnectFilePath || '') === fileName);
        if (matches.length === 0) {
            logging_1.logger.error(`No files found matching: ${filePath}`);
            continue;
        }
        if (matches.length === 1) {
            logging_1.logger.info(`Found: ${matches[0]._codeConnectFilePath}`);
        }
        else {
            const uniqueFiles = new Set(matches.map((d) => d._codeConnectFilePath));
            if (uniqueFiles.size === 1) {
                logging_1.logger.info(`Found ${matches.length} component definition(s) in ${path_1.default.relative(dir, Array.from(uniqueFiles)[0] || '')}`);
            }
            else {
                logging_1.logger.info(`Found ${matches.length} component definition(s) in ${uniqueFiles.size} files:`);
                for (const fp of uniqueFiles) {
                    const count = matches.filter((d) => d._codeConnectFilePath === fp).length;
                    logging_1.logger.info(`  - ${path_1.default.relative(dir, fp || '')} (${count} definition${count > 1 ? 's' : ''})`);
                }
            }
        }
        for (const doc of matches) {
            const parsed = (0, validation_1.parseFigmaNode)(cmd.verbose, doc, true);
            if (parsed) {
                nodesToPreview.push({
                    fileKey: parsed.fileKey,
                    nodeId: parsed.nodeId,
                    url: doc.figmaNode,
                    filePath: path_1.default.relative(dir, doc._codeConnectFilePath || ''),
                });
            }
        }
    }
    return nodesToPreview;
}
/**
 * Filter templates to only those matching the requested node IDs.
 */
function filterTemplatesForNodes(nodeIds, allTemplates) {
    return allTemplates.filter((template) => {
        if (!template.figmaNode)
            return false;
        const nodeIdMatch = template.figmaNode.match(/node-id=([^&\s]+)/);
        if (!nodeIdMatch?.[1])
            return false;
        const templateNodeId = nodeIdMatch[1].replace(/-/g, ':');
        return nodeIds.includes(templateNodeId);
    });
}
/**
 * Aliases for Code Connect labels that don't directly match a Prettier language name.
 */
const CC_LABEL_ALIASES = {
    react: 'typescript',
    code: 'typescript',
};
/**
 * Map from Code Connect language labels to Prettier parser names,
 * built lazily from Prettier's getSupportInfo() on first access.
 * Lazy to avoid triggering plugin loading at module import time.
 */
let _prettierParserMap = null;
function getPrettierParserMap() {
    if (_prettierParserMap)
        return _prettierParserMap;
    const info = prettier.getSupportInfo();
    _prettierParserMap = {};
    for (const lang of info.languages) {
        if (lang.parsers?.[0]) {
            _prettierParserMap[lang.name.toLowerCase()] = lang.parsers[0];
        }
    }
    for (const [alias, target] of Object.entries(CC_LABEL_ALIASES)) {
        if (_prettierParserMap[target]) {
            _prettierParserMap[alias] = _prettierParserMap[target];
        }
    }
    return _prettierParserMap;
}
/**
 * Check if a snippet can be parsed by Prettier.
 * Returns true for languages without a Prettier parser (nothing to validate).
 */
async function isPrettierParseable(snippet, language) {
    const lang = language?.toLowerCase();
    const parser = lang ? getPrettierParserMap()[lang] : 'typescript';
    if (!parser) {
        return true;
    }
    try {
        await prettier.format(snippet, { parser });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Format snippet with Prettier.
 * Returns the snippet unmodified for languages Prettier doesn't support.
 */
async function formatSnippet(snippet, language) {
    const lang = language?.toLowerCase();
    const parser = lang ? getPrettierParserMap()[lang] : 'typescript';
    if (!parser) {
        return snippet;
    }
    try {
        let formatted = await prettier.format(snippet, {
            parser,
            semi: false,
            singleQuote: true,
            printWidth: 80,
            tabWidth: 2,
        });
        formatted = formatted.replace(/^;\s*/, '');
        return formatted;
    }
    catch {
        logging_1.logger.info(`Autoformatting couldn't be applied: language not supported or code is malformed`);
        return snippet;
    }
}
/**
 * Display results with terminal colors
 */
function displayResults(results) {
    console.log('');
    const successCount = results.filter((r) => r.success).length;
    const errorCount = results.filter((r) => !r.success).length;
    const purple = '\x1b[38;5;93m';
    const red = '\x1b[38;5;196m';
    const gray = '\x1b[38;5;243m';
    const reset = '\x1b[0m';
    const bold = '\x1b[1m';
    for (const result of results) {
        if (result.success && result.snippet) {
            const componentInfo = result.component ? ` ${gray}→ ${result.component}${reset}` : '';
            console.log(`${purple}●${reset} ${bold}${result.filePath}${reset}${componentInfo}`);
            console.log(`  ${gray}${result.url}${reset}`);
            console.log('');
            const indentedSnippet = result.snippet
                .trim()
                .split('\n')
                .map((line) => '  ' + line)
                .join('\n');
            console.log(indentedSnippet);
            console.log('');
        }
        else {
            const componentInfo = result.component ? ` ${gray}(${result.component})${reset}` : '';
            console.log(`${red}✕${reset} ${bold}${result.filePath}${reset}${componentInfo}`);
            console.log(`  ${gray}${result.url}${reset}`);
            console.log(`  ${red}Error:${reset} ${result.error}`);
            console.log('');
        }
    }
    console.log(`${bold}Summary:${reset} ${purple}${successCount} succeeded${reset}, ${errorCount > 0 ? `${red}${errorCount} failed${reset}` : `${gray}${errorCount} failed${reset}`}`);
}
// The server caps inbound request bodies at 5MB. The figmaDocs payload
// (one Code Connect template per requested component) dominates the body size,
// so for projects with many components we split into smaller chunks and send
// them in parallel rather than risking a 413.
const PREVIEW_CHUNK_SIZE = 50;
// Bound the number of chunks in flight at once. Without this cap, large
// libraries (~1k+ components) trigger N parallel preview requests, which
// overwhelms upstream token validation and causes spurious 403 "Invalid
// token" responses for the chunks that queue up too long.
const PREVIEW_MAX_CONCURRENCY = 5;
function chunkArray(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
    }
    return chunks;
}
async function runInWaves(items, fn, maxConcurrency) {
    const out = [];
    for (let i = 0; i < items.length; i += maxConcurrency) {
        const wave = items.slice(i, i + maxConcurrency);
        const settled = await Promise.all(wave.map(fn));
        out.push(...settled);
    }
    return out;
}
function sendPreviewChunk({ chunkNodeIds, requiredTemplates, baseApiUrl, fileKey, accessToken, }) {
    const chunkTemplates = filterTemplatesForNodes(chunkNodeIds, requiredTemplates);
    return fetch_1.request
        .post(`${baseApiUrl}/code_connect/preview_snippets?file_key=${fileKey}`, { nodeIds: chunkNodeIds, figmaDocs: { all: chunkTemplates } }, { headers: (0, figma_rest_api_1.getHeaders)(accessToken) })
        .then((response) => ({ chunkNodeIds, response, error: null }))
        .catch((err) => ({ chunkNodeIds, response: null, error: err }));
}
function chunkOutcomeToResults(outcome, nodes, fileKey) {
    const { chunkNodeIds, response, error } = outcome;
    const results = [];
    if (error) {
        const errorMsg = (0, fetch_1.isFetchError)(error)
            ? error.data?.message || error.response.statusText
            : String(error);
        // 503 means the server-side killswitch is on — surface the server's
        // message directly without the per-file/per-node noise so the user
        // sees a single clear line during an incident.
        if ((0, fetch_1.isFetchError)(error) && error.response.status === 503) {
            (0, logging_1.exitWithError)(errorMsg);
        }
        else {
            logging_1.logger.error(`Failed to preview components in file ${fileKey}: ${errorMsg}`);
            for (const nodeId of chunkNodeIds) {
                for (const node of nodes.filter((n) => n.nodeId === nodeId)) {
                    results.push({
                        url: node.url,
                        nodeId: node.nodeId,
                        filePath: node.filePath,
                        success: false,
                        error: errorMsg,
                    });
                }
            }
        }
        return results;
    }
    if (response.response.status === 200 && response.data.meta?.results) {
        // Track match index per nodeId so duplicate node IDs get the correct file attribution.
        // The server returns results in the same order as the templates we sent. Each chunk's
        // nodeIds are disjoint (we dedupe before chunking), so per-chunk indexing is correct.
        const nodeMatchIndex = {};
        for (const result of response.data.meta.results) {
            const idx = nodeMatchIndex[result.nodeId] ?? 0;
            const matchingNodes = nodes.filter((n) => n.nodeId === result.nodeId);
            const node = matchingNodes[idx] || matchingNodes[0];
            nodeMatchIndex[result.nodeId] = idx + 1;
            results.push({
                url: node?.url || result.nodeUrl,
                nodeId: result.nodeId,
                filePath: node?.filePath || '',
                success: !result.error && !!result.snippet,
                snippet: result.snippet,
                language: result.language,
                component: result.component,
                error: result.error || (!result.snippet ? 'No snippet returned by server' : undefined),
            });
        }
        return results;
    }
    for (const nodeId of chunkNodeIds) {
        for (const node of nodes.filter((n) => n.nodeId === nodeId)) {
            results.push({
                url: node.url,
                nodeId: node.nodeId,
                filePath: node.filePath,
                success: false,
                error: `API request failed with status ${response.response.status}`,
            });
        }
    }
    return results;
}
async function previewFile({ fileKey, nodes, baseApiUrl, accessToken, dir, allCodeConnectObjects, }) {
    const allNodeIds = nodes.map((n) => n.nodeId);
    // Deduplicate — multiple figma.connect() calls may share the same nodeId;
    // the individual templates are sent in figmaDocs and the server iterates per-template.
    const nodeIds = [...new Set(allNodeIds)];
    // Only send templates from the requested files — other files' templates
    // for the same nodeId exist on the server and shouldn't be rendered individually.
    const requestedFilePaths = new Set(nodes.map((n) => path_1.default.resolve(dir, n.filePath)));
    const requiredTemplates = filterTemplatesForNodes(allNodeIds, allCodeConnectObjects).filter((t) => requestedFilePaths.has(path_1.default.resolve(t._codeConnectFilePath || '')));
    const chunks = chunkArray(nodeIds, PREVIEW_CHUNK_SIZE);
    const outcomes = await runInWaves(chunks, (chunkNodeIds) => sendPreviewChunk({ chunkNodeIds, requiredTemplates, baseApiUrl, fileKey, accessToken }), PREVIEW_MAX_CONCURRENCY);
    return outcomes.flatMap((outcome) => chunkOutcomeToResults(outcome, nodes, fileKey));
}
/**
 * Handle the preview command
 */
async function handlePreview(files, cmd) {
    (0, connect_1.setupHandler)(cmd);
    const dir = cmd.dir ?? process.cwd();
    const projectInfo = await (0, project_1.getProjectInfo)(dir, cmd.config);
    const accessToken = (0, connect_1.getAccessTokenOrExit)(cmd);
    const outputFormat = cmd.output || 'table';
    const allCodeConnectObjects = await (0, connect_1.getCodeConnectObjects)(cmd, projectInfo, true);
    let nodesToCheck;
    if (files && files.length > 0) {
        nodesToCheck = await collectNodesToPreview(files, allCodeConnectObjects, dir, cmd);
    }
    else {
        logging_1.logger.info('Previewing all local Code Connect files...');
        nodesToCheck = [];
        for (const doc of allCodeConnectObjects) {
            const parsed = (0, validation_1.parseFigmaNode)(cmd.verbose, doc, true);
            if (parsed) {
                nodesToCheck.push({
                    fileKey: parsed.fileKey,
                    nodeId: parsed.nodeId,
                    url: doc.figmaNode,
                    filePath: path_1.default.relative(dir, doc._codeConnectFilePath || ''),
                });
            }
        }
    }
    if (nodesToCheck.length === 0) {
        (0, logging_1.exitWithError)('No valid Code Connect files found to preview');
    }
    logging_1.logger.info(`Previewing ${nodesToCheck.length} component(s)...`);
    // Group nodes by fileKey for batching
    const nodesByFileKey = {};
    for (const node of nodesToCheck) {
        if (!nodesByFileKey[node.fileKey]) {
            nodesByFileKey[node.fileKey] = [];
        }
        nodesByFileKey[node.fileKey].push(node);
    }
    const results = [];
    for (const [fileKey, nodes] of Object.entries(nodesByFileKey)) {
        const baseApiUrl = (0, figma_rest_api_1.getApiUrl)(nodes[0].url, cmd.apiUrl || projectInfo.config.apiUrl);
        const fileResults = await previewFile({
            fileKey,
            nodes,
            baseApiUrl,
            accessToken,
            dir,
            allCodeConnectObjects,
        });
        results.push(...fileResults);
    }
    // Validate snippet syntax
    for (const result of results) {
        if (result.success && result.snippet) {
            const prettierValid = await isPrettierParseable(result.snippet, result.language);
            if (!prettierValid) {
                // Prettier can parse this language but failed — mark as error
                result.success = false;
                result.error = 'Snippet has syntax errors and may not be valid code';
            }
        }
    }
    if (outputFormat === 'json') {
        console.log(JSON.stringify(results, null, 2));
    }
    else {
        const formattedResults = await Promise.all(results.map(async (result) => {
            if (result.success && result.snippet) {
                const formattedSnippet = await formatSnippet(result.snippet, result.language);
                return { ...result, snippet: formattedSnippet };
            }
            return result;
        }));
        displayResults(formattedResults);
    }
    if (results.every((r) => !r.success)) {
        process.exit(1);
    }
}
