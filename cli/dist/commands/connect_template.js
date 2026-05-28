"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.addCodeConnectCommandsToProgram = addCodeConnectCommandsToProgram;
const fs_1 = __importDefault(require("fs"));
const upload_1 = require("../connect/upload");
const validation_1 = require("../connect/validation");
const project_1 = require("../connect/project");
const logging_1 = require("../common/logging");
const delete_docs_1 = require("../connect/delete_docs");
const helpers_1 = require("../connect/helpers");
const raw_templates_1 = require("../connect/raw_templates");
const batch_templates_1 = require("../connect/batch_templates");
const filter_project_info_1 = require("./filter_project_info");
const create_template_1 = require("../connect/create_template");
function getAccessTokenOrExit(cmd) {
    const token = cmd.token;
    if (!token) {
        (0, logging_1.exitWithError)(cmd.useOAuth
            ? `Couldn't find a Figma OAuth token. Please re-authenticate.`
            : `Couldn't find a Figma access token. Please set the FIGMA_ACCESS_TOKEN environment variable`);
    }
    return token;
}
function setupHandler(cmd) {
    if (cmd.verbose) {
        logging_1.logger.setLogLevel(logging_1.LogLevel.Debug);
    }
}
function getDir(cmd) {
    return cmd.dir ?? process.cwd();
}
/**
 * Returns Code Connect objects from template files (.figma.ts / .figma.js)
 * only. Native parser paths (react, html, executable) are intentionally
 * omitted — this entry point is for parserless/template-file workflows.
 */
async function getCodeConnectObjects(cmd, projectInfo, silent = false) {
    const rawTemplateFiles = projectInfo.files.filter((f) => {
        const isPotentialRawTemplate = f.endsWith('.figma.js') ||
            f.endsWith('.figma.template.js') ||
            f.endsWith('.figma.ts') ||
            f.endsWith('.figma.template.ts');
        if (!isPotentialRawTemplate)
            return false;
        try {
            return (0, raw_templates_1.isRawTemplate)(fs_1.default.readFileSync(f, 'utf-8'));
        }
        catch {
            return false;
        }
    });
    let codeConnectObjects = [];
    if (rawTemplateFiles.length > 0) {
        const resolvedLabel = cmd.label || projectInfo.config.label;
        const rawTemplateDocs = [];
        for (const file of rawTemplateFiles) {
            try {
                const doc = (0, raw_templates_1.parseRawFile)(file, resolvedLabel, projectInfo.config, projectInfo.absPath);
                doc._codeConnectFilePath = file;
                if (!silent || cmd.verbose) {
                    logging_1.logger.info((0, logging_1.success)(file));
                }
                rawTemplateDocs.push(doc);
            }
            catch (e) {
                if (!silent || cmd.verbose) {
                    logging_1.logger.error(`❌ ${file}`);
                    if (cmd.verbose) {
                        console.trace(e);
                    }
                    else {
                        logging_1.logger.error(e instanceof Error ? e.message : String(e));
                    }
                }
                if (cmd.exitOnUnreadableFiles) {
                    logging_1.logger.info('Exiting due to unreadable files');
                    process.exit(1);
                }
            }
        }
        codeConnectObjects = codeConnectObjects.concat(rawTemplateDocs);
    }
    // Process batch files (.figma.batch.json)
    const batchFiles = projectInfo.files.filter((f) => f.endsWith('.figma.batch.json'));
    if (batchFiles.length > 0) {
        const resolvedLabel = cmd.label || projectInfo.config.label;
        for (const file of batchFiles) {
            try {
                const docs = (0, batch_templates_1.parseBatchFile)(file, resolvedLabel, projectInfo.config, projectInfo.absPath);
                docs.forEach((doc) => {
                    doc._codeConnectFilePath = file;
                });
                codeConnectObjects = codeConnectObjects.concat(docs);
                if (!silent || cmd.verbose) {
                    logging_1.logger.info((0, logging_1.success)(`${file} (${docs.length} components)`));
                }
            }
            catch (e) {
                logging_1.logger.error(`${file}: ${e}`);
                if (cmd.exitOnUnreadableFiles) {
                    process.exit(1);
                }
            }
        }
    }
    if (cmd.label || projectInfo.config.label) {
        logging_1.logger.info(`Using label "${cmd.label || projectInfo.config.label}"`);
        codeConnectObjects.forEach((doc) => {
            doc.label = cmd.label || projectInfo.config.label || doc.label;
        });
    }
    if (projectInfo.config.language) {
        logging_1.logger.info(`Using language "${projectInfo.config.language}"`);
        codeConnectObjects.forEach((doc) => {
            doc.language = projectInfo.config.language || doc.language;
        });
    }
    return codeConnectObjects;
}
async function handlePublish(cmd) {
    setupHandler(cmd);
    let dir = getDir(cmd);
    const projectInfo = (0, filter_project_info_1.filterProjectInfoByFile)(await (0, project_1.getProjectInfo)(dir, cmd.config, true), cmd.file);
    const codeConnectObjects = await getCodeConnectObjects(cmd, projectInfo);
    if (codeConnectObjects.length === 0) {
        logging_1.logger.warn(`No Code Connect files found in ${dir} - Make sure you have configured \`include\` and \`exclude\` in your figma.config.json file correctly, or that you are running in a directory that contains Code Connect files.`);
        process.exit(0);
    }
    if (cmd.dryRun) {
        logging_1.logger.info(`Files that would be published:`);
        logging_1.logger.info(codeConnectObjects.map((o) => `- ${o.component} (${o.figmaNode})`).join('\n'));
    }
    const accessToken = getAccessTokenOrExit(cmd);
    if (cmd.skipValidation) {
        logging_1.logger.info('Validation skipped');
    }
    else {
        logging_1.logger.info('Validating Code Connect files...');
        const start = new Date().getTime();
        const valid = await (0, validation_1.validateDocs)(cmd, accessToken, codeConnectObjects, cmd.apiUrl || projectInfo.config.apiUrl, cmd.useOAuth);
        if (!valid) {
            (0, helpers_1.exitWithFeedbackMessage)(1);
        }
        else {
            const end = new Date().getTime();
            const time = end - start;
            logging_1.logger.info(`All Code Connect files are valid (${time}ms)`);
        }
    }
    if (cmd.dryRun) {
        logging_1.logger.info(`Dry run complete`);
        process.exit(0);
    }
    let batchSize;
    if (cmd.batchSize) {
        batchSize = parseInt(cmd.batchSize, 10);
        if (isNaN(batchSize)) {
            logging_1.logger.error('Error: failed to parse batch-size. batch-size passed must be a number');
            (0, helpers_1.exitWithFeedbackMessage)(1);
        }
    }
    (0, upload_1.upload)({
        accessToken,
        useOAuth: cmd.useOAuth,
        docs: codeConnectObjects,
        batchSize,
        verbose: cmd.verbose,
        apiUrl: cmd.apiUrl || projectInfo.config.apiUrl,
        force: cmd.force,
    });
}
async function handleUnpublish(cmd) {
    setupHandler(cmd);
    let dir = getDir(cmd);
    if (cmd.dryRun) {
        logging_1.logger.info(`Files that would be unpublished:`);
    }
    let nodesToDeleteRelevantInfo;
    const projectInfo = (0, filter_project_info_1.filterProjectInfoByFile)(await (0, project_1.getProjectInfo)(dir, cmd.config, true), cmd.file);
    if (cmd.node) {
        if (!cmd.label) {
            (0, logging_1.exitWithError)('Label is required when specifying a node');
        }
        nodesToDeleteRelevantInfo = [{ figmaNode: cmd.node, label: cmd.label }];
    }
    else {
        const codeConnectObjects = await getCodeConnectObjects(cmd, projectInfo);
        nodesToDeleteRelevantInfo = codeConnectObjects.map((doc) => ({
            figmaNode: doc.figmaNode,
            label: cmd.label || projectInfo.config.label || doc.label,
        }));
        if (cmd.label || projectInfo.config.label) {
            logging_1.logger.info(`Using label ${cmd.label || projectInfo.config.label}`);
        }
        if (cmd.dryRun) {
            logging_1.logger.info(`Dry run complete`);
            process.exit(0);
        }
    }
    const accessToken = getAccessTokenOrExit(cmd);
    (0, delete_docs_1.delete_docs)({
        accessToken,
        useOAuth: cmd.useOAuth,
        docs: nodesToDeleteRelevantInfo,
        apiUrl: cmd.apiUrl || projectInfo.config.apiUrl,
    });
}
async function handleParse(cmd) {
    setupHandler(cmd);
    const dir = cmd.dir ?? process.cwd();
    const projectInfo = (0, filter_project_info_1.filterProjectInfoByFile)(await (0, project_1.getProjectInfo)(dir, cmd.config, true), cmd.file);
    const codeConnectObjects = await getCodeConnectObjects(cmd, projectInfo);
    if (cmd.dryRun) {
        logging_1.logger.info(`Dry run complete`);
        process.exit(0);
    }
    if (cmd.outFile) {
        fs_1.default.writeFileSync(cmd.outFile, JSON.stringify(codeConnectObjects, null, 2));
        logging_1.logger.info(`Wrote Code Connect JSON to ${(0, logging_1.highlight)(cmd.outFile)}`);
    }
    else {
        console.log(JSON.stringify(codeConnectObjects, undefined, 2));
    }
}
async function handleCreate(nodeUrl, cmd) {
    setupHandler(cmd);
    const dir = getDir(cmd);
    const projectInfo = await (0, project_1.getProjectInfo)(dir, cmd.config, true);
    const accessToken = getAccessTokenOrExit(cmd);
    return (0, create_template_1.createCodeConnectFromUrl)({
        accessToken,
        figmaNodeUrl: nodeUrl.replace(/\\/g, ''),
        outFile: cmd.outFile,
        outDir: cmd.outDir,
        projectInfo,
        cmd,
    });
}
/**
 * Registers Code Connect commands on a commander program, restricted to
 * template-file workflows only. Intended for use by CLIs that support
 * Code Connect during a migration period but do not need native parsers.
 *
 * Note: does NOT use addBaseCommand internally because that function registers
 * both `-o --outFile` and `-o --outDir` with the same `-o` short flag.
 * commander@12+ (used by litmus-cli) throws a conflict error on duplicate flags.
 */
function addCodeConnectCommandsToProgram(program, programOptions = {}) {
    function addBase(parent, name, description) {
        return parent
            .command(name)
            .description(description)
            .usage('[options]')
            .option('-r --dir <dir>', 'directory to parse')
            .option('-f --file <file>', 'path to a single Code Connect file to process')
            .option('--outFile <file>', 'specify a file to output generated Code Connect')
            .option('--outDir <dir>', 'specify a directory to output generated Code Connect')
            .option('-c --config <path>', 'path to a figma config file')
            .option('--exit-on-unreadable-files', 'exit if any Code Connect files cannot be parsed. We recommend using this option for CI/CD.')
            .option('--dry-run', 'tests publishing without actually publishing')
            .addHelpText('before', 'For feedback or bugs, please raise an issue: https://github.com/figma/code-connect/issues');
    }
    function wrapHandler(handler) {
        return (options, cmd) => {
            const globalOpts = cmd.optsWithGlobals();
            // Attempt to get a token from the provided getter (e.g. OAuth store).
            // If it returns undefined or throws (e.g. no OAuth token stored in CI),
            // fall back to FIGMA_ACCESS_TOKEN and use PAT headers.
            let oauthToken;
            try {
                oauthToken = programOptions.getToken?.();
            }
            catch {
                // getToken threw (e.g. no OAuth token stored); fall back to PAT below
            }
            const token = oauthToken ?? process.env.FIGMA_ACCESS_TOKEN;
            const useOAuth = oauthToken !== undefined;
            return handler({
                ...options,
                token,
                useOAuth,
                verbose: globalOpts.logLevel === 'debug',
                apiUrl: globalOpts.apiBaseUrl,
            }).catch((err) => {
                // Commander v12 catches rejected action promises internally and exits 0.
                // Commander v11 left them as unhandled rejections, and Node.js 15+ would
                // exit 1 for those — so exit code 1 on handler errors was previously
                // accidental. This catch makes it explicit and version-independent.
                logging_1.logger.error(err.message);
                process.exitCode = 1;
            });
        };
    }
    const connectCommand = program
        .command('connect')
        .description('Code Connect commands')
        .addHelpText('before', 'For feedback or bugs, please raise an issue: https://github.com/figma/code-connect/issues');
    connectCommand.action(() => connectCommand.help());
    addBase(connectCommand, 'publish', 'Run Code Connect locally to find any files that have figma connections and publish them to Figma. ' +
        'By default this looks for a config file named "figma.config.json", and uses the `include` and `exclude` fields to determine which files to parse. ' +
        'If no config file is found, this parses the current directory. An optional `--dir` flag can be used to specify a directory to parse.')
        .option('--skip-validation', 'skip validation of Code Connect docs')
        .option('-l --label <label>', 'label to apply to the published files')
        .option('-b --batch-size <batch_size>', 'optional batch size (in number of documents) to use when uploading. Use this if you hit "request too large" errors. See README for more information.')
        .option('--force', 'overwrite existing UI-created Code Connect mappings if they conflict with the files being published')
        .action(wrapHandler(handlePublish));
    addBase(connectCommand, 'unpublish', 'Run to find any files that have figma connections and unpublish them from Figma. ' +
        'By default this looks for a config file named "figma.config.json", and uses the `include` and `exclude` fields to determine which files to parse. ' +
        'If no config file is found, this parses the current directory. An optional `--dir` flag can be used to specify a directory to parse. ' +
        'Alternatively, use `--node` and `--label` to unpublish a specific component.')
        .option('--node <link_to_node>', 'specify the node to unpublish. This will unpublish for the specified label.')
        .option('-l --label <label>', 'label to unpublish for')
        .action(wrapHandler(handleUnpublish));
    addBase(connectCommand, 'parse', 'Run Code Connect locally to find any files that have figma connections, then converts them to JSON and outputs to stdout.')
        .option('-l --label <label>', 'label to apply to the parsed files')
        .action(wrapHandler(handleParse));
    addBase(connectCommand, 'create', 'Generate a Code Connect file with boilerplate in the current directory for a Figma node URL')
        .argument('<figma-node-url>', 'Figma node URL to create the Code Connect file from')
        .action((nodeUrl, options, cmd) => wrapHandler((mergedCmd) => handleCreate(nodeUrl, mergedCmd))(options, cmd));
}
