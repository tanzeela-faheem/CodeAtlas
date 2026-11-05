import { createRequire } from "node:module";
import Parser from "tree-sitter";
import JavaScript from "tree-sitter-javascript";

import type { LanguageParser } from "../contracts/LanguageParser.ts";
import type { ParseResult } from "../contracts/ParseResult.ts";

const require = createRequire(import.meta.url);
const version = (name: string): string | null => {
    try {
        const value: unknown = (require(`${name}/package.json`) as { version?: unknown }).version;
        return typeof value === "string" ? value : null;
    } catch {
        return null;
    }
};
export class JavascriptParser implements LanguageParser {
    readonly provenance = Object.freeze({
        parserVersion: version("tree-sitter"),
        grammarVersion: version("tree-sitter-javascript")
    });
    readonly id = "tree-sitter-javascript";
    readonly supportedLanguages = ["JavaScript"];
    readonly supportedExtensions = [".js", ".jsx", ".mjs", ".cjs"];

    parse(sourceCode: string): ParseResult {
        const parser = new Parser();
        parser.setLanguage(JavaScript);

        const tree = parser.parse(sourceCode);

        return {
            tree,
            hasErrors: tree.rootNode.hasError
        };
    }
}
