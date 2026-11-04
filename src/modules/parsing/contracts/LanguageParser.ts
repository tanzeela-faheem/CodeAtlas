import type { ParseResult } from './ParseResult.ts';

export interface LanguageParser {
    readonly id: string;
    readonly supportedLanguages: readonly string[];
    readonly supportedExtensions: readonly string[];

    parse(sourceCode: string): ParseResult;
}