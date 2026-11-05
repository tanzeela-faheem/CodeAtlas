import type { ParserProvenance } from "./ParserProvenance.js";
import type { ParseResult } from "./ParseResult.ts";

export interface LanguageParser {
    readonly provenance?: ParserProvenance;
    readonly id: string;
    readonly supportedLanguages: readonly string[];
    readonly supportedExtensions: readonly string[];

    parse(sourceCode: string): ParseResult;
}
