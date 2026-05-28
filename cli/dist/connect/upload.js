"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDocsMap = createDocsMap;
exports.upload = upload;
const logging_1 = require("../common/logging");
const figma_rest_api_1 = require("./figma_rest_api");
const helpers_1 = require("./helpers");
const validation_1 = require("./validation");
const fetch_1 = require("../common/fetch");
const COMPONENT_BROWSER_CONFLICT_REASON = 'Code Connect UI mapping already exists';
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000];
async function postWithRetry(apiUrl, batch, accessToken, useOAuth = false) {
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
        try {
            return await fetch_1.request.post(apiUrl, batch, { headers: (0, figma_rest_api_1.getHeaders)(accessToken, useOAuth) });
        }
        catch (err) {
            if ((0, fetch_1.isFetchError)(err) && (err.response.status === 429 || err.response.status >= 500)) {
                if (attempt === RETRY_DELAYS_MS.length) {
                    throw err;
                }
                const retryAfterSec = err.response.headers.get('Retry-After');
                const delayMs = retryAfterSec
                    ? parseInt(retryAfterSec, 10) * 1_000
                    : RETRY_DELAYS_MS[attempt];
                logging_1.logger.warn(`Received ${err.response.status}, retrying in ${delayMs / 1000}s (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length})...`);
                await new Promise((resolve) => setTimeout(resolve, delayMs));
            }
            else {
                throw err;
            }
        }
    }
    throw new Error('Unreachable');
}
/**
 * Returns a string representation of the code connect JSON
 * @param doc - The code connect JSON
 * @returns A string representation of the code connect JSON
 */
function codeConnectStr(doc) {
    return `${(0, logging_1.highlight)(doc.component ?? '')}${doc.variant ? `(${Object.entries(doc.variant).map(([key, value]) => `${key}=${value}`)})` : ''} ${(0, logging_1.underline)(doc.figmaNode)}`;
}
/**
 * Extracts the fileKey and nodeId from the Figma node URL and returns a key in the format of fileKey-nodeId
 * @param figmaNode - The Figma node URL
 * @returns The key in the format of fileKey-nodeId
 */
function getKeyFromFigmaNode(figmaNode) {
    const url = new URL(figmaNode);
    // Extract fileKey from path (after /file/ or /design/)
    const pathMatch = url.pathname.match(/\/(file|design)\/([A-Za-z0-9]+)/);
    const fileKey = pathMatch ? pathMatch[2] : '';
    // Extract nodeId from query parameter and convert format (1-24 -> 1:24)
    const nodeIdParam = url.searchParams.get('node-id') || '';
    const nodeId = nodeIdParam.replace(/-/g, ':');
    return `${fileKey}-${nodeId}`;
}
/**
 * Creates a map from fileKey-nodeId to original docs for easy lookup
 */
function createDocsMap(docs, verbose) {
    const docsMap = new Map();
    for (const doc of docs) {
        const parsedData = (0, validation_1.parseFigmaNode)(verbose, doc);
        if (!parsedData) {
            continue;
        }
        const mapKey = `${parsedData.fileKey}-${parsedData.nodeId}`;
        if (!docsMap.has(mapKey)) {
            docsMap.set(mapKey, []);
        }
        docsMap.get(mapKey)?.push(doc);
    }
    return docsMap;
}
async function upload({ accessToken, useOAuth = false, docs, batchSize, verbose, apiUrl: apiUrlOverride, force, }) {
    const apiUrl = (0, figma_rest_api_1.getApiUrl)(docs?.[0]?.figmaNode ?? '', apiUrlOverride) +
        '/code_connect' +
        (force ? '?force=true' : '');
    // Strip internal fields before uploading to Figma
    const cleanedDocs = docs.map((doc) => {
        const { _codeConnectFilePath, ...cleanDoc } = doc;
        return cleanDoc;
    });
    try {
        logging_1.logger.info(`Uploading to Figma...`);
        // Create a map from fileKey-nodeId to original docs for detailed output
        const docsMap = createDocsMap(cleanedDocs, verbose);
        let allUploadedNodes = new Set();
        let allFailedNodes = new Map(); // key -> failure reason
        if (batchSize) {
            if (typeof batchSize !== 'number') {
                logging_1.logger.error('Batch size must be a number');
                (0, helpers_1.exitWithFeedbackMessage)(1);
            }
            // batch together based on fileKey + nodeId as all variants etc of the same node should be uploaded together
            // Otherwise, the server will overwrite the previous upload
            const groupedDocs = cleanedDocs.reduce((acc, doc) => {
                const parsedData = (0, validation_1.parseFigmaNode)(verbose, doc);
                if (!parsedData) {
                    (0, helpers_1.exitWithFeedbackMessage)(1);
                }
                const { fileKey, nodeId } = parsedData;
                const accKey = fileKey + ',' + nodeId;
                if (!acc[accKey]) {
                    acc[accKey] = [];
                }
                acc[accKey].push(doc);
                return acc;
            }, {});
            const batchedDocs = [];
            const nodeKeys = Object.keys(groupedDocs);
            for (let i = 0; i < nodeKeys.length; i += batchSize) {
                const batch = [];
                for (let j = i; j < i + batchSize && j < nodeKeys.length; j++) {
                    const nodeKey = nodeKeys[j];
                    batch.push(...groupedDocs[nodeKey]);
                }
                batchedDocs.push(batch);
            }
            let currentBatch = 1;
            const noOfBatches = batchedDocs.length;
            for (const batch of batchedDocs) {
                process.stderr.write('\x1b[2K\x1b[0G');
                process.stderr.write(`Uploading batch ${currentBatch}/${noOfBatches}`);
                var size = Buffer.byteLength(JSON.stringify(batch)) / (1024 * 1024);
                // Server has a limit of 5mb
                if (size > 5) {
                    logging_1.logger.error(`Failed to upload to Figma: The request is too large (${size.toFixed(2)}mb).`);
                    logging_1.logger.error('Please try reducing the size of uploads by splitting them into smaller requests by running again and decreasing the --batch-size parameter.');
                    (0, helpers_1.exitWithFeedbackMessage)(1);
                }
                logging_1.logger.debug(`Uploading ${size.toFixed(2)}mb to Figma`);
                const response = await postWithRetry(apiUrl, batch, accessToken, useOAuth);
                const data = response.data;
                if (data.meta?.published_nodes) {
                    data.meta.published_nodes.forEach((node) => allUploadedNodes.add(getKeyFromFigmaNode(node.figmaNode)));
                }
                if (data.meta?.failed_nodes) {
                    data.meta.failed_nodes.forEach((node) => allFailedNodes.set(getKeyFromFigmaNode(node.figmaNode), node.reason));
                }
                currentBatch++;
            }
            process.stderr.write(`\n`);
        }
        else {
            var size = Buffer.byteLength(JSON.stringify(cleanedDocs)) / (1024 * 1024);
            // Server has a limit of 5mb
            if (size > 5) {
                logging_1.logger.error(`Failed to upload to Figma: The request is too large (${size.toFixed(2)}mb).`);
                logging_1.logger.error('Please try reducing the size of uploads by splitting them into smaller requests by running again with the --batch-size parameter. You can do also this by running on different subdirectories using the --dir flag or by iteratively adjusting the includes field in the configuration.');
                (0, helpers_1.exitWithFeedbackMessage)(1);
            }
            logging_1.logger.debug(`Uploading ${size.toFixed(2)}mb to Figma`);
            logging_1.logger.info(`Uploading to ${apiUrl}`);
            const response = await postWithRetry(apiUrl, cleanedDocs, accessToken, useOAuth);
            const data = response.data;
            if (data.meta?.published_nodes) {
                data.meta.published_nodes.forEach((node) => allUploadedNodes.add(getKeyFromFigmaNode(node.figmaNode)));
            }
            if (data.meta?.failed_nodes) {
                data.meta.failed_nodes.forEach((node) => allFailedNodes.set(getKeyFromFigmaNode(node.figmaNode), node.reason));
            }
        }
        // Separate successful and failed uploads
        const successfulDocsByLabel = {};
        const failedDocsByLabel = {};
        for (const [mapKey, nodeDocs] of docsMap.entries()) {
            for (const doc of nodeDocs) {
                const label = doc.label;
                const docKey = getKeyFromFigmaNode(doc.figmaNode);
                const isUploaded = allUploadedNodes.has(docKey);
                const failureReason = allFailedNodes.get(docKey);
                if (isUploaded) {
                    if (!successfulDocsByLabel[label]) {
                        successfulDocsByLabel[label] = [];
                    }
                    successfulDocsByLabel[label].push(doc);
                }
                else if (failureReason) {
                    if (!failedDocsByLabel[label]) {
                        failedDocsByLabel[label] = [];
                    }
                    failedDocsByLabel[label].push({ doc, reason: failureReason });
                }
            }
        }
        for (const [label, docs] of Object.entries(successfulDocsByLabel)) {
            logging_1.logger.info(`Successfully uploaded to Figma, for ${label}:\n${docs.map((doc) => `-> ${codeConnectStr(doc)}`).join('\n')}`);
        }
        if (Object.keys(failedDocsByLabel).length > 0) {
            let hasComponentBrowserConflicts = false;
            for (const [label, failedItems] of Object.entries(failedDocsByLabel)) {
                const conflicts = failedItems.filter((item) => item.reason.includes(COMPONENT_BROWSER_CONFLICT_REASON));
                const otherFailures = failedItems.filter((item) => !item.reason.includes(COMPONENT_BROWSER_CONFLICT_REASON));
                if (conflicts.length > 0) {
                    hasComponentBrowserConflicts = true;
                    logging_1.logger.warn((0, logging_1.warn)(`Warning: ${conflicts.length} node(s) already have UI-created Code Connect mappings in Figma for label "${label}":\n${conflicts.map((item) => `-> ${codeConnectStr(item.doc)}`).join('\n')}`));
                }
                if (otherFailures.length > 0) {
                    logging_1.logger.error(`Failed to upload to Figma, for ${label}:\n${otherFailures.map((item) => `-> ${codeConnectStr(item.doc)} (${item.reason})`).join('\n')}`);
                }
            }
            if (hasComponentBrowserConflicts && !force) {
                logging_1.logger.warn((0, logging_1.warn)(`Re-run with --force to overwrite the existing UI-created mappings with your Code Connect files.`));
            }
        }
    }
    catch (err) {
        if ((0, fetch_1.isFetchError)(err)) {
            if (err.response) {
                logging_1.logger.error(`Failed to upload to Figma (${err.response.status}): ${err.response.status} ${err.data?.message}`);
            }
            else {
                logging_1.logger.error(`Failed to upload to Figma: ${err.message}`);
            }
            logging_1.logger.debug(JSON.stringify(err?.data));
        }
        else {
            logging_1.logger.error(`Failed to upload to Figma: ${err}`);
        }
        (0, helpers_1.exitWithFeedbackMessage)(1);
    }
}
