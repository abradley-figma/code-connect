"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.addConnectCommandToProgram = addConnectCommandToProgram;
exports.getAccessToken = getAccessToken;
exports.getAccessTokenOrExit = getAccessTokenOrExit;
exports.getDir = getDir;
exports.setupHandler = setupHandler;
exports.getCodeConnectObjects = getCodeConnectObjects;
const fs_1 = __importDefault(require("fs"));
const preview_utils_1 = require("./preview_utils");
const upload_1 = require("../connect/upload");
const validation_1 = require("../connect/validation");
const create_1 = require("../connect/create");
const project_1 = require("../connect/project");
const logging_1 = require("../common/logging");
const convert_1 = require("../storybook/convert");
const delete_docs_1 = require("../connect/delete_docs");
const run_wizard_1 = require("../connect/wizard/run_wizard");
const parser_executables_1 = require("../connect/parser_executables");
const zod_validation_error_1 = require("zod-validation-error");
const parser_executable_types_1 = require("../connect/parser_executable_types");
const path_1 = __importDefault(require("path"));
const updates_1 = require("../common/updates");
const helpers_1 = require("../connect/helpers");
const filter_project_info_1 = require("./filter_project_info");
const parser_1 = require("../html/parser");
const parser_common_1 = require("../connect/parser_common");
const parser_2 = require("../react/parser");
const label_language_mapping_1 = require("../connect/label_language_mapping");
const migration_helpers_1 = require("../connect/migration_helpers");
const raw_templates_1 = require("../connect/raw_templates");
const batch_templates_1 = require("../connect/batch_templates");
const run_wizard_2 = require("../connect/wizard/run_wizard");
const project_2 = require("../connect/project");
function addBaseCommand(command, name, description) {
    return command
        .command(name)
        .description(description)
        .usage('[options]')
        .option('-r --dir <dir>', 'directory to parse')
        .option('-f --file <file>', 'path to a single Code Connect file to process')
        .option('-t --token <token>', 'figma access token')
        .option('-v --verbose', 'enable verbose logging for debugging')
        .option('-o --outFile <file>', 'specify a file to output generated Code Connect')
        .option('-o --outDir <dir>', 'specify a directory to output generated Code Connect')
        .option('-c --config <path>', 'path to a figma config file')
        .option('-a --api-url <url>', 'custom Figma API URL to use instead of https://api.figma.com/v1')
        .option('--skip-update-check', 'skips checking for an updated version of the Figma CLI')
        .option('--exit-on-unreadable-files', 'exit if any Code Connect files cannot be parsed. We recommend using this option for CI/CD.')
        .option('--dry-run', 'tests publishing without actually publishing')
        .addHelpText('before', 'For feedback or bugs, please raise an issue: https://github.com/figma/code-connect/issues');
}
function addConnectCommandToProgram(program) {
    // Main command, invoked with `figma connect`
    const connectCommand = addBaseCommand(program, 'connect', 'Figma Code Connect').action((0, updates_1.withUpdateCheck)(run_wizard_1.runWizard));
    // Sub-commands, invoked with e.g. `figma connect publish`
    addBaseCommand(connectCommand, 'publish', 'Run Code Connect locally to find any files that have figma connections and publish them to Figma. ' +
        'By default this looks for a config file named "figma.config.json", and uses the `include` and `exclude` fields to determine which files to parse. ' +
        'If no config file is found, this parses the current directory. An optional `--dir` flag can be used to specify a directory to parse.')
        .option('--skip-validation', 'skip validation of Code Connect docs')
        .option('-l --label <label>', 'label to apply to the published files')
        .option('-b --batch-size <batch_size>', 'optional batch size (in number of documents) to use when uploading. Use this if you hit "request too large" errors. See README for more information.')
        .option('--include-template-files', '(Deprecated) No longer needed - template files are included by default. Will be removed in a future version.')
        .option('--force', 'overwrite existing UI-created Code Connect mappings if they conflict with the files being published')
        .action((0, updates_1.withUpdateCheck)(handlePublish));
    addBaseCommand(connectCommand, 'unpublish', 'Run to find any files that have figma connections and unpublish them from Figma. ' +
        'By default this looks for a config file named "figma.config.json", and uses the `include` and `exclude` fields to determine which files to parse. ' +
        'If no config file is found, this parses the current directory. An optional `--dir` flag can be used to specify a directory to parse. ' +
        'Alternatively, use `--node` and `--label` to unpublish a specific component.')
        .option('--node <link_to_node>', 'specify the node to unpublish. This will unpublish for the specified label.')
        .option('-l --label <label>', 'label to unpublish for')
        .action((0, updates_1.withUpdateCheck)(handleUnpublish));
    addBaseCommand(connectCommand, 'parse', 'Run Code Connect locally to find any files that have figma connections, then converts them to JSON and outputs to stdout.')
        .option('-l --label <label>', 'label to apply to the parsed files')
        .option('--include-template-files', '(Deprecated) No longer needed - template files are included by default. Will be removed in a future version.')
        .action((0, updates_1.withUpdateCheck)(handleParse));
    addBaseCommand(connectCommand, 'create', 'Generate a Code Connect file with boilerplate in the current directory for a Figma node URL')
        .argument('<figma-node-url>', 'Figma node URL to create the Code Connect file from')
        .action((0, updates_1.withUpdateCheck)(handleCreate));
    addBaseCommand(connectCommand, 'migrate', 'Parse Code Connect files and migrate their templates into .figma.js files that can be published directly without parsing.')
        .argument('[pattern]', 'glob pattern to match files (optional, uses config if not provided)')
        .option('--include-props', 'preserve __props metadata blocks in migrated templates (removed by default). Use if your templates use the React .getProps() or .render() modifiers, or read executeTemplate().metadata.__props from the migrated components')
        .option('--javascript', 'output migrated templates as JavaScript (.figma.js) instead of TypeScript (.figma.ts)')
        .action((0, updates_1.withUpdateCheck)(handleMigrate));
    addBaseCommand(connectCommand, 'preview', 'Preview how Code Connect snippets will render in the Figma inspect panel')
        .argument('[files...]', 'Code Connect files to preview (e.g., Button.figma.tsx). Leave empty to preview all files.')
        .option('--output <format>', 'Output format: table (default) or json', 'table')
        .action((0, updates_1.withUpdateCheck)(preview_utils_1.handlePreview));
}
function getAccessToken(cmd) {
    return cmd.token ?? process.env.FIGMA_ACCESS_TOKEN;
}
function getAccessTokenOrExit(cmd) {
    const token = getAccessToken(cmd);
    if (!token) {
        (0, logging_1.exitWithError)(`Couldn't find a Figma access token. Please provide one with \`--token <access_token>\` or set the FIGMA_ACCESS_TOKEN environment variable`);
    }
    return token;
}
function getDir(cmd) {
    return cmd.dir ?? process.cwd();
}
function setupHandler(cmd) {
    if (cmd.verbose) {
        logging_1.logger.setLogLevel(logging_1.LogLevel.Debug);
    }
}
function transformDocFromParser(doc, remoteUrl, config) {
    let source = doc.source;
    if (source) {
        try {
            const url = new URL(source);
            if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                throw new Error('Invalid URL scheme');
            }
        }
        catch (e) {
            source = (0, project_1.getRemoteFileUrl)(source, remoteUrl, config.defaultBranch);
        }
    }
    // TODO This logic is duplicated in parser.ts parseDoc due to some type issues
    let figmaNode = doc.figmaNode;
    if (config.documentUrlSubstitutions) {
        figmaNode = (0, helpers_1.applyDocumentUrlSubstitutions)(figmaNode, config.documentUrlSubstitutions);
    }
    return {
        ...doc,
        source,
        figmaNode,
    };
}
async function getCodeConnectObjects(cmd, projectInfo, silent = false, isForMigration = false) {
    if (cmd.jsonFile) {
        try {
            const docsFromJson = JSON.parse(fs_1.default.readFileSync(cmd.jsonFile, 'utf8'));
            // Strip internal fields from JSON input
            return docsFromJson.map((doc) => {
                const { _codeConnectFilePath, ...cleanDoc } = doc;
                return cleanDoc;
            });
        }
        catch (e) {
            logging_1.logger.error('Failed to parse JSON file:', e);
        }
    }
    let codeConnectObjects = [];
    if (projectInfo.config.parser === 'react') {
        codeConnectObjects = await getReactCodeConnectObjects(projectInfo, cmd, silent, isForMigration);
    }
    else if (projectInfo.config.parser === 'html') {
        codeConnectObjects = await getCodeConnectObjectsFromParseFn({
            parseFn: parser_1.parseHtmlDoc,
            fileExtension: 'ts',
            projectInfo,
            cmd,
            silent,
            isForMigration,
        });
    }
    else if (projectInfo.config.parser) {
        const payload = {
            mode: 'PARSE',
            paths: projectInfo.files,
            config: { ...projectInfo.config, skipTemplateHelpers: isForMigration },
            verbose: cmd.verbose,
        };
        try {
            const stdout = await (0, parser_executables_1.callParser)(
            // We use `as` because the React parser makes the types difficult
            // TODO remove once React is an executable parser
            projectInfo.config, payload, projectInfo.absPath);
            const parsed = parser_executable_types_1.ParseResponsePayload.parse(stdout);
            const { hasErrors } = (0, parser_executables_1.handleMessages)(parsed.messages);
            if (hasErrors) {
                (0, logging_1.exitWithError)('Errors encountered calling parser, exiting');
            }
            codeConnectObjects = parsed.docs.map((doc) => ({
                ...transformDocFromParser(doc, projectInfo.remoteUrl, projectInfo.config),
                metadata: {
                    cliVersion: require('../../package.json').version,
                },
            }));
        }
        catch (e) {
            if (cmd.verbose) {
                console.trace(e);
                // Don't say to enable verbose if the user has already enabled it.
                (0, logging_1.exitWithError)(`Error calling parser: ${e}.`);
            }
            else {
                (0, logging_1.exitWithError)(`Error returned from parser: ${(0, zod_validation_error_1.fromError)(e)}. Try re-running the command with --verbose for more information.`);
            }
        }
    }
    const rawTemplateFiles = projectInfo.files.filter((f) => {
        // Suffix may be used by HTML / custom parsers
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
    if (rawTemplateFiles.length > 0) {
        // Resolve the label before parsing so language inference works correctly
        const resolvedLabel = cmd.label || projectInfo.config.label;
        const rawTemplateDocs = [];
        for (const file of rawTemplateFiles) {
            try {
                const doc = (0, raw_templates_1.parseRawFile)(file, resolvedLabel, projectInfo.config, projectInfo.absPath);
                // Store the Code Connect file path for migration purposes
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
// React/Storybook and HTML parsers are handled as special cases for now, they
// do not use the parser executable model but instead directly call a function
// in the code base. We may want to transition them to that model in future.
async function getCodeConnectObjectsFromParseFn({ 
/** The function used to parse a source file into a Code Connect object */
parseFn, 
/** Optional function used to resolve imports in a source file */
resolveImportsFn, 
/** The file extension to filter for when checking if files should be parsed */
fileExtension, 
/** Project info */
projectInfo, 
/** The commander command object */
cmd, 
/** Silences console output */
silent = false, 
/** Whether this parse is for the migrate command */
isForMigration = false, }) {
    const codeConnectObjects = [];
    const tsProgram = (0, project_1.getTsProgram)(projectInfo);
    const { files, remoteUrl, config, absPath } = projectInfo;
    for (const file of files.filter((f) => (0, parser_common_1.isFigmaConnectFile)(tsProgram, f, fileExtension))) {
        try {
            const docs = await (0, parser_common_1.parseCodeConnect)({
                program: tsProgram,
                file,
                config,
                parseFn,
                resolveImportsFn,
                absPath,
                parseOptions: {
                    repoUrl: remoteUrl,
                    debug: cmd.verbose,
                    silent,
                    isForMigration,
                },
            });
            codeConnectObjects.push(...docs);
            if (!silent || cmd.verbose) {
                logging_1.logger.info((0, logging_1.success)(file));
            }
        }
        catch (e) {
            if (!silent || cmd.verbose) {
                logging_1.logger.error(`❌ ${file}`);
                if (e instanceof parser_common_1.ParserError) {
                    if (cmd.verbose) {
                        console.trace(e);
                    }
                    else {
                        logging_1.logger.error(e.toString());
                    }
                    if (cmd.exitOnUnreadableFiles) {
                        logging_1.logger.info('Exiting due to unreadable files');
                        process.exit(1);
                    }
                }
                else {
                    if (cmd.verbose) {
                        console.trace(e);
                    }
                    else {
                        logging_1.logger.error(new parser_common_1.InternalError(String(e)).toString());
                    }
                }
            }
        }
    }
    return codeConnectObjects;
}
async function getReactCodeConnectObjects(projectInfo, cmd, silent = false, isForMigration = false) {
    const codeConnectObjects = await getCodeConnectObjectsFromParseFn({
        parseFn: parser_2.parseReactDoc,
        resolveImportsFn: parser_2.findAndResolveImports,
        fileExtension: ['tsx', 'jsx'],
        projectInfo,
        cmd,
        silent,
        isForMigration,
    });
    const storybookCodeConnectObjects = await (0, convert_1.convertStorybookFiles)({
        projectInfo: (0, project_1.getReactProjectInfo)(projectInfo),
        isForMigration,
    });
    const allCodeConnectObjects = codeConnectObjects.concat(storybookCodeConnectObjects);
    return allCodeConnectObjects;
}
async function handlePublish(cmd) {
    setupHandler(cmd);
    // Show deprecation warning if the flag is used
    if (cmd.includeTemplateFiles !== undefined) {
        logging_1.logger.warn('[Deprecated] The --include-template-files flag is no longer needed because template files are now included by default. ' +
            "Please don't use this flag - it will be removed in a future version.");
    }
    let dir = getDir(cmd);
    const projectInfo = (0, filter_project_info_1.filterProjectInfoByFile)(await (0, project_1.getProjectInfo)(dir, cmd.config), cmd.file);
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
        var start = new Date().getTime();
        const valid = await (0, validation_1.validateDocs)(cmd, accessToken, codeConnectObjects, cmd.apiUrl || projectInfo.config.apiUrl);
        if (!valid) {
            (0, helpers_1.exitWithFeedbackMessage)(1);
        }
        else {
            var end = new Date().getTime();
            var time = end - start;
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
        docs: codeConnectObjects,
        batchSize: batchSize,
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
    const projectInfo = (0, filter_project_info_1.filterProjectInfoByFile)(await (0, project_1.getProjectInfo)(dir, cmd.config), cmd.file);
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
        docs: nodesToDeleteRelevantInfo,
        apiUrl: cmd.apiUrl || projectInfo.config.apiUrl,
    });
}
async function handleParse(cmd) {
    setupHandler(cmd);
    // Show deprecation warning if the flag is used
    if (cmd.includeTemplateFiles !== undefined) {
        logging_1.logger.warn('[Deprecated] The --include-template-files flag is no longer needed because template files are now included by default. ' +
            "Please don't use this flag - it will be removed in a future version.");
    }
    const dir = cmd.dir ?? process.cwd();
    const projectInfo = (0, filter_project_info_1.filterProjectInfoByFile)(await (0, project_1.getProjectInfo)(dir, cmd.config), cmd.file);
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
        // don't format the output, so it can be piped to other commands
        console.log(JSON.stringify(codeConnectObjects, undefined, 2));
    }
}
async function handleCreate(nodeUrl, cmd) {
    setupHandler(cmd);
    const dir = cmd.dir ?? process.cwd();
    const projectInfo = await (0, project_1.getProjectInfo)(dir, cmd.config);
    if (cmd.dryRun) {
        process.exit(0);
    }
    const accessToken = getAccessTokenOrExit(cmd);
    return (0, create_1.createCodeConnectFromUrl)({
        accessToken,
        // We remove \s to allow users to paste URLs inside quotes - the terminal
        // paste will add backslashes, which the quotes preserve, but expected user
        // behaviour would be to strip the quotes
        figmaNodeUrl: nodeUrl.replace(/\\/g, ''),
        outFile: cmd.outFile,
        outDir: cmd.outDir,
        projectInfo,
        cmd,
    });
}
/**
 * Migrate native parser Code Connect files to parserless. For each found doc:
 * - Replace helpers with figma.* versions
 * - Migrate v1 syntax to v2 (equivalent but more readable)
 * - Format as valid parserless file w/ url="" comment
 * - Name collisions are skipped, unless file is from migration (in which case add "_1")
 */
async function handleMigrate(pattern, cmd) {
    setupHandler(cmd);
    const dir = cmd.dir ?? process.cwd();
    let projectInfo = await (0, project_1.getProjectInfo)(dir, cmd.config);
    const documentUrlSubstitutions = projectInfo.config.documentUrlSubstitutions;
    // Clear documentUrlSubstitutions so we preserve original URLs in migrated templates
    projectInfo = {
        ...projectInfo,
        config: {
            ...projectInfo.config,
            documentUrlSubstitutions: {},
        },
    };
    // If a glob pattern is provided, override the project files
    if (pattern) {
        const { globSync } = require('glob');
        const files = globSync(pattern, {
            cwd: dir,
            absolute: true,
            nodir: true,
        });
        if (files.length === 0) {
            (0, logging_1.exitWithError)(`No files found matching pattern: ${pattern}`);
        }
        logging_1.logger.info(`Found ${files.length} file(s) matching pattern: ${pattern}`);
        projectInfo = {
            ...projectInfo,
            files,
        };
    }
    // Parse the files to get Code Connect objects
    const allCodeConnectObjects = await getCodeConnectObjects(cmd, projectInfo, false, true);
    const codeConnectObjectsByFigmaUrl = (0, migration_helpers_1.groupCodeConnectObjectsByFigmaUrl)(allCodeConnectObjects);
    const groupCount = Object.keys(codeConnectObjectsByFigmaUrl).length;
    if (groupCount === 0) {
        (0, logging_1.exitWithError)('No Code Connect objects found to migrate');
    }
    logging_1.logger.info(`Found ${groupCount} component(s) to migrate`);
    let migratedCount = 0;
    let skippedCount = 0;
    const errors = [];
    const filePathsCreated = new Set();
    const gitRootPath = (0, project_2.getGitRepoAbsolutePath)(dir);
    const useTypeScript = !cmd.javascript;
    for (const [figmaUrl, group] of Object.entries(codeConnectObjectsByFigmaUrl)) {
        try {
            const hasVariants = group.variants.length > 0;
            const representativeDoc = group.main ?? group.variants[0];
            if (!representativeDoc?.template) {
                logging_1.logger.warn(`Skipping ${figmaUrl}: no template found`);
                skippedCount++;
                continue;
            }
            // Determine local source path for output location
            let localSourcePath;
            if (representativeDoc._codeConnectFilePath) {
                // Use the Code Connect file path directly (preferred)
                localSourcePath = representativeDoc._codeConnectFilePath;
            }
            else if (representativeDoc?.source && gitRootPath) {
                // Fallback: Convert remote file URL to local path
                const relativePath = (0, run_wizard_2.convertRemoteFileUrlToRelativePath)({
                    remoteFileUrl: representativeDoc.source,
                    gitRootPath,
                    dir,
                });
                if (relativePath) {
                    localSourcePath = path_1.default.resolve(dir, relativePath);
                }
            }
            const { outputPath, skipped } = hasVariants
                ? (0, migration_helpers_1.writeVariantTemplateFile)(group, figmaUrl, cmd.outDir, dir, {
                    localSourcePath,
                    filePathsCreated,
                    useTypeScript,
                    includeProps: cmd.includeProps,
                })
                : (0, migration_helpers_1.writeTemplateFile)(representativeDoc, cmd.outDir, dir, {
                    localSourcePath,
                    filePathsCreated,
                    includeProps: cmd.includeProps,
                    useTypeScript,
                });
            if (skipped) {
                logging_1.logger.warn(`Skipping ${outputPath}: file already exists`);
                skippedCount++;
            }
            else {
                logging_1.logger.info(`${(0, logging_1.success)('✓')} Migrated${hasVariants ? ' (with variants)' : ''} to ${(0, logging_1.highlight)(outputPath)}`);
                migratedCount++;
            }
        }
        catch (error) {
            const errorMsg = `Failed to migrate ${figmaUrl}: ${error}`;
            logging_1.logger.error(errorMsg);
            errors.push(errorMsg);
        }
    }
    if (migratedCount > 0) {
        if (cmd.outDir) {
            const configFilePath = path_1.default.join(cmd.outDir, 'figma.config.json');
            if (fs_1.default.existsSync(configFilePath)) {
                logging_1.logger.warn(`Config file already exists at ${(0, logging_1.highlight)(configFilePath)}`);
            }
            else {
                const { language: docLanguage, label } = allCodeConnectObjects[0];
                const language = (0, label_language_mapping_1.getInferredLanguageForRaw)(label, docLanguage);
                const config = {
                    parser: undefined,
                    include: [useTypeScript ? '**/*.figma.ts' : '**/*.figma.js'],
                    language,
                    label,
                    ...(documentUrlSubstitutions && Object.keys(documentUrlSubstitutions).length > 0
                        ? { documentUrlSubstitutions }
                        : {}),
                };
                fs_1.default.writeFileSync(configFilePath, JSON.stringify({ codeConnect: config }, null, 2));
                logging_1.logger.info(`${(0, logging_1.success)('✓')} Wrote Figma config to ${(0, logging_1.highlight)(configFilePath)}`);
            }
        }
    }
    // Summary
    console.log('');
    logging_1.logger.info(`Migration complete: ${(0, logging_1.success)(`${migratedCount} migrated`)}, ${skippedCount} skipped`);
    if (errors.length > 0) {
        console.log('');
        logging_1.logger.error(`Encountered ${errors.length} error(s):`);
        errors.forEach((err) => logging_1.logger.error(`  ${err}`));
        process.exit(1);
    }
    if (migratedCount === 0) {
        (0, logging_1.exitWithError)('No files were migrated');
    }
}
