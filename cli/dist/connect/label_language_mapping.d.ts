/**
 * Default Code Connect labels for native parsers
 */
export declare enum CodeConnectLabel {
    React = "React",
    Storybook = "Storybook",
    SwiftUI = "SwiftUI",
    Compose = "Compose",
    WebComponents = "Web Components",
    HTML = "HTML",
    Vue = "Vue",
    Angular = "Angular",
    Code = "Code"
}
/**
 * Supported Code Connect languages for syntax highlighting and formatting
 */
export declare enum SyntaxHighlightLanguage {
    TypeScript = "typescript",
    CPP = "cpp",
    Ruby = "ruby",
    CSS = "css",
    JavaScript = "javascript",
    HTML = "html",
    JSON = "json",
    GraphQL = "graphql",
    Python = "python",
    Go = "go",
    SQL = "sql",
    Swift = "swift",
    Kotlin = "kotlin",
    Rust = "rust",
    Bash = "bash",
    XML = "xml",
    Plaintext = "plaintext",
    JSX = "jsx",
    TSX = "tsx",
    Dart = "dart"
}
/**
 * Infers the appropriate language for a raw template file based on its label.
 * Falls back to 'plaintext' if the label is not recognized.
 *
 * @param label - The label associated with the Code Connect file
 * @returns The corresponding language identifier for syntax highlighting
 */
export declare function getInferredLanguageForRaw(label: string, defaultLanguage?: SyntaxHighlightLanguage): SyntaxHighlightLanguage;
