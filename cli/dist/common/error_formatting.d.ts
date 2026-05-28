/**
 * Formats a file operation error
 */
export declare function formatFileError(opts: {
    operation: 'read' | 'write' | 'parse' | 'access';
    filePath: string;
    error: Error;
    suggestion?: string;
}): string;
/**
 * Formats a network/API error
 */
export declare function formatNetworkError(opts: {
    operation: string;
    url?: string;
    statusCode?: number;
    error: Error;
    suggestion?: string;
}): string;
/**
 * Formats a validation error
 */
export declare function formatValidationError(opts: {
    item: string;
    errors: string[];
    suggestion?: string;
}): string;
/**
 * Extracts the most relevant error message from a stack of errors
 * @param error - The error to extract a message from
 * @param isVerbose - Whether verbose mode is already enabled (to avoid suggesting --verbose when it's already on)
 */
export declare function extractErrorMessage(error: unknown, isVerbose?: boolean): string;
