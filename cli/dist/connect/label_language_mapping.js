"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyntaxHighlightLanguage = exports.CodeConnectLabel = void 0;
exports.getInferredLanguageForRaw = getInferredLanguageForRaw;
/**
 * Default Code Connect labels for native parsers
 */
var CodeConnectLabel;
(function (CodeConnectLabel) {
    CodeConnectLabel["React"] = "React";
    CodeConnectLabel["Storybook"] = "Storybook";
    CodeConnectLabel["SwiftUI"] = "SwiftUI";
    CodeConnectLabel["Compose"] = "Compose";
    CodeConnectLabel["WebComponents"] = "Web Components";
    CodeConnectLabel["HTML"] = "HTML";
    CodeConnectLabel["Vue"] = "Vue";
    CodeConnectLabel["Angular"] = "Angular";
    CodeConnectLabel["Code"] = "Code";
})(CodeConnectLabel || (exports.CodeConnectLabel = CodeConnectLabel = {}));
/**
 * Supported Code Connect languages for syntax highlighting and formatting
 */
var SyntaxHighlightLanguage;
(function (SyntaxHighlightLanguage) {
    SyntaxHighlightLanguage["TypeScript"] = "typescript";
    SyntaxHighlightLanguage["CPP"] = "cpp";
    SyntaxHighlightLanguage["Ruby"] = "ruby";
    SyntaxHighlightLanguage["CSS"] = "css";
    SyntaxHighlightLanguage["JavaScript"] = "javascript";
    SyntaxHighlightLanguage["HTML"] = "html";
    SyntaxHighlightLanguage["JSON"] = "json";
    SyntaxHighlightLanguage["GraphQL"] = "graphql";
    SyntaxHighlightLanguage["Python"] = "python";
    SyntaxHighlightLanguage["Go"] = "go";
    SyntaxHighlightLanguage["SQL"] = "sql";
    SyntaxHighlightLanguage["Swift"] = "swift";
    SyntaxHighlightLanguage["Kotlin"] = "kotlin";
    SyntaxHighlightLanguage["Rust"] = "rust";
    SyntaxHighlightLanguage["Bash"] = "bash";
    SyntaxHighlightLanguage["XML"] = "xml";
    SyntaxHighlightLanguage["Plaintext"] = "plaintext";
    SyntaxHighlightLanguage["JSX"] = "jsx";
    SyntaxHighlightLanguage["TSX"] = "tsx";
    SyntaxHighlightLanguage["Dart"] = "dart";
})(SyntaxHighlightLanguage || (exports.SyntaxHighlightLanguage = SyntaxHighlightLanguage = {}));
/**
 * Maps Code Connect labels to their corresponding language for syntax highlighting.
 * This is used for raw template files to infer the correct language.
 */
const LABEL_TO_LANGUAGE_MAP = {
    [CodeConnectLabel.React]: SyntaxHighlightLanguage.JSX,
    [CodeConnectLabel.Storybook]: SyntaxHighlightLanguage.TypeScript,
    [CodeConnectLabel.SwiftUI]: SyntaxHighlightLanguage.Swift,
    [CodeConnectLabel.Compose]: SyntaxHighlightLanguage.Kotlin,
    [CodeConnectLabel.WebComponents]: SyntaxHighlightLanguage.HTML,
    [CodeConnectLabel.HTML]: SyntaxHighlightLanguage.HTML,
    [CodeConnectLabel.Vue]: SyntaxHighlightLanguage.HTML,
    [CodeConnectLabel.Angular]: SyntaxHighlightLanguage.HTML,
    [CodeConnectLabel.Code]: SyntaxHighlightLanguage.Plaintext,
};
/**
 * Infers the appropriate language for a raw template file based on its label.
 * Falls back to 'plaintext' if the label is not recognized.
 *
 * @param label - The label associated with the Code Connect file
 * @returns The corresponding language identifier for syntax highlighting
 */
function getInferredLanguageForRaw(label, defaultLanguage = SyntaxHighlightLanguage.Plaintext) {
    // Try to match against known labels (enum values)
    const knownLabel = Object.values(CodeConnectLabel).find((enumLabel) => enumLabel === label);
    if (knownLabel) {
        return LABEL_TO_LANGUAGE_MAP[knownLabel];
    }
    return defaultLanguage;
}
