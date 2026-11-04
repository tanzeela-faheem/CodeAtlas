import Parser from "tree-sitter";
import JavaScript from "tree-sitter-javascript";

import type { LanguageParser } from "../contracts/LanguageParser.ts";
import type { ParseResult } from "../contracts/ParseResult.ts";

export class JavascriptParser implements LanguageParser {
    readonly id = "tree-sitter-javascript";
    readonly supportedLanguages = ["JavaScript"];
    readonly supportedExtensions = [".js", ".jsx", ".mjs", ".cjs"];

    parse(sourceCode: string): ParseResult {
        const parser = new Parser();
        parser.setLanguage(JavaScript);

        const tree = parser.parse(sourceCode);

        return {
            tree,
            hasErrors: tree.rootNode.hasError,
        };
    }
}