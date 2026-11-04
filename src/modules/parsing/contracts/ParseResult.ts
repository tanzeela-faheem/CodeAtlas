import type Parser from "tree-sitter";

export interface ParseResult {
    readonly tree: Parser.Tree;
    readonly hasErrors: boolean;
}