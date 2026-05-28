"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.filterProjectInfoByFile = filterProjectInfoByFile;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const logging_1 = require("../common/logging");
/**
 * If --file is specified, filter projectInfo.files to only include that file.
 * Exits with an error if the file doesn't exist or isn't in the project's file list.
 */
function filterProjectInfoByFile(projectInfo, file) {
    if (!file) {
        return projectInfo;
    }
    const absFile = path_1.default.resolve(file);
    if (!fs_1.default.existsSync(absFile)) {
        (0, logging_1.exitWithError)(`File not found: ${absFile}`);
    }
    const matched = projectInfo.files.filter((f) => f === absFile);
    if (matched.length === 0) {
        (0, logging_1.exitWithError)(`File ${absFile} was not found in the project's file list. ` +
            `Make sure it matches the include/exclude globs in your config.`);
    }
    return {
        ...projectInfo,
        files: matched,
    };
}
