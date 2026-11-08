
import { createRequire } from "node:module";
import Parser from "tree-sitter";
import Python from "tree-sitter-python";

import type { LanguageParser } from "../contracts/LanguageParser.ts";
import type { ParseResult } from "../contracts/ParseResult.ts";

const require = createRequire(import.meta.url);

const version = (name: string): string | null => {
    try {
        const value: unknown = (
            require(`${name}/package.json`) as { version?: unknown }
        ).version;

        return typeof value === "string" ? value : null;
    } catch {
        return null;
    }
};

export class PythonParser implements LanguageParser {
    readonly provenance = Object.freeze({
        parserVersion: version("tree-sitter"),
        grammarVersion: version("tree-sitter-python")
    });

    readonly id = "tree-sitter-python";
    readonly supportedLanguages = ["Python"];
    readonly supportedExtensions = [".py"];

    parse(sourceCode: string): ParseResult {
        const parser = new Parser();
        parser.setLanguage(Python);

        const tree = parser.parse(sourceCode);

        return {
            tree,
            hasErrors: tree.rootNode.hasError
        };
    }
}
