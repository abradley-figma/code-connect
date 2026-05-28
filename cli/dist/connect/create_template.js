"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeComponentName = normalizeComponentName;
exports.createCodeConnectFromUrl = createCodeConnectFromUrl;
exports.createTemplateCodeConnect = createTemplateCodeConnect;
const lodash_1 = require("lodash");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const create_common_1 = require("./create_common");
const helpers_1 = require("./helpers");
const figma_rest_api_1 = require("./figma_rest_api");
const logging_1 = require("../common/logging");
const fetch_1 = require("../common/fetch");
function normalizeComponentName(name) {
    // Convert the string to PascalCase and ensure first character is not a digit
    return name
        .replace(/[^a-zA-Z0-9]/g, ' ')
        .split(' ')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join('')
        .replace(/^[0-9]/, '_$&');
}
async function createCodeConnectFromUrl({ accessToken, figmaNodeUrl, outFile, outDir, projectInfo, cmd, }) {
    try {
        const fileKey = (0, helpers_1.parseFileKey)(figmaNodeUrl);
        const nodeIds = (0, helpers_1.parseNodeIds)([figmaNodeUrl]);
        const apiUrl = (0, figma_rest_api_1.getApiUrl)(figmaNodeUrl ?? '', cmd.apiUrl || projectInfo.config.apiUrl) +
            `/code_connect/${fileKey}/cli_data?ids=${nodeIds.join(',')}`;
        if (nodeIds.length === 0) {
            (0, logging_1.exitWithError)(`Invalid figma node URL: the provided url "${figmaNodeUrl}" does not contain a node-id`);
        }
        else if (nodeIds.length > 1) {
            (0, logging_1.exitWithError)(`Invalid figma node URL: the provided url "${figmaNodeUrl}" contains more than one node-id`);
        }
        logging_1.logger.info('Fetching component information from Figma...');
        const response = process.env.CODE_CONNECT_MOCK_CREATE_API_RESPONSE
            ? {
                response: { status: 200 },
                data: JSON.parse(fs_1.default.readFileSync(process.env.CODE_CONNECT_MOCK_CREATE_API_RESPONSE, 'utf-8')),
            }
            : await fetch_1.request.get(apiUrl, {
                headers: (0, figma_rest_api_1.getHeaders)(accessToken),
            });
        if (response.response.status === 200) {
            logging_1.logger.info('Parsing response');
            const component = (0, helpers_1.findComponentsInDocument)(response.data.document, nodeIds)[0];
            if (component === undefined) {
                (0, logging_1.exitWithError)('Could not find a component in the provided URL');
            }
            const normalizedName = normalizeComponentName(component.name);
            const componentPayload = {
                figmaNodeUrl,
                id: component.id,
                name: component.name,
                normalizedName,
                type: component.type,
                componentPropertyDefinitions: component.componentPropertyDefinitions,
            };
            logging_1.logger.info('Generating Code Connect files...');
            const filename = createTemplateCodeConnect({
                component: componentPayload,
                normalizedName,
                destinationDir: outDir ?? process.env.INIT_CWD ?? process.cwd(),
                destinationFile: outFile,
            });
            logging_1.logger.info('Code Connect file generated successfully:');
            logging_1.logger.info(`${filename}`);
        }
        else {
            logging_1.logger.error(`Failed to get node information from Figma with status: ${response.response.status}`);
            logging_1.logger.debug('Failed to get node information from Figma with Body:', response.data);
        }
    }
    catch (err) {
        if ((0, fetch_1.isFetchError)(err)) {
            if (err.response) {
                logging_1.logger.error(`Failed to get node data from Figma (${err.response.status}): ${err.response.status} ${err.data?.err ?? err.data?.message}`);
            }
            else {
                logging_1.logger.error(`Failed to get node data from Figma: ${err.message}`);
            }
            logging_1.logger.debug(JSON.stringify(err.data));
        }
        else {
            logging_1.logger.error(`Failed to create: ${err}`);
        }
        (0, helpers_1.exitWithFeedbackMessage)(1);
    }
}
function normalizePropName(name) {
    return name.replace(/#[0-9:]*/g, '');
}
function normalizePropValue(name) {
    return name.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
}
function generateCodePropName(name) {
    return (0, lodash_1.camelCase)(name.replace(/#[0-9:]+$/g, '').replace(/[^a-zA-Z0-9\s]/g, ''));
}
function isBooleanKind(propValue) {
    const normalized = propValue.toLowerCase();
    return (normalized === 'true' ||
        normalized === 'false' ||
        normalized === 'yes' ||
        normalized === 'no' ||
        normalized === 'on' ||
        normalized === 'off');
}
function isValidIdentifier(name) {
    return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);
}
function generatePropDeclaration(propName, propDef) {
    const codePropName = generateCodePropName(propName);
    const figmaPropName = normalizePropName(propName);
    if (propDef.type === 'BOOLEAN') {
        return `const ${codePropName} = figma.selectedInstance.getBoolean("${figmaPropName}")`;
    }
    if (propDef.type === 'TEXT') {
        return `const ${codePropName} = figma.selectedInstance.getString("${figmaPropName}")`;
    }
    if (propDef.type === 'VARIANT') {
        const isBooleanVariant = propDef.variantOptions?.length === 2 && propDef.variantOptions.every(isBooleanKind);
        if (isBooleanVariant) {
            return `const ${codePropName} = figma.selectedInstance.getBoolean("${figmaPropName}")`;
        }
        else {
            const options = (propDef.variantOptions || [])
                .map((v) => {
                const key = isValidIdentifier(v) ? v : `"${v}"`;
                return `  ${key}: "${normalizePropValue(v)}"`;
            })
                .join(',\n');
            return `const ${codePropName} = figma.selectedInstance.getEnum("${figmaPropName}", {\n${options},\n})`;
        }
    }
    return null;
}
function generateTemplateBody(component) {
    const defs = component.componentPropertyDefinitions || {};
    const declarations = [];
    for (const [propName, propDef] of Object.entries(defs)) {
        const decl = generatePropDeclaration(propName, propDef);
        if (decl) {
            declarations.push(decl);
        }
    }
    return {
        declarations: declarations.join('\n'),
    };
}
function createTemplateCodeConnect(args) {
    const { component, normalizedName, destinationDir, destinationFile } = args;
    const filePath = (0, create_common_1.getOutFileName)({
        outFile: destinationFile,
        outDir: destinationDir,
        sourceFilename: normalizedName,
        extension: 'ts',
    });
    const { declarations } = generateTemplateBody(component);
    const codeConnect = [
        `// url=${component.figmaNodeUrl}`,
        `import figma from "figma"`,
        '',
        `/**`,
        ` * NEXT STEPS:`,
        ` * - Replace the \`example\` with the actual code snippet you want to show`,
        ` *   (e.g. figma.code\`<Button label="\${propertyValue}" />\`)`,
        ` * - Update the \`imports\` array with any lines of code that should be displayed`,
        ` *   at the top (e.g. imports: ['import { Button } from "./Button"'])`,
        ` */`,
        '',
        declarations || null,
        declarations ? '' : null,
        `export default {`,
        `  example: figma.code\`\`,`,
        `  imports: [],`,
        `  id: "${normalizedName}",`,
        `  metadata: {`,
        `    nestable: true,`,
        `  },`,
        `}`,
        '',
    ]
        .filter((line) => line !== null)
        .join('\n');
    if (fs_1.default.existsSync(filePath)) {
        (0, logging_1.exitWithError)(`File ${filePath} already exists, skipping creation`);
    }
    fs_1.default.mkdirSync(path_1.default.dirname(filePath), { recursive: true });
    fs_1.default.writeFileSync(filePath, codeConnect);
    return filePath;
}
