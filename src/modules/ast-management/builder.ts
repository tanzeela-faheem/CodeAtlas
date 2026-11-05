import type Parser from "tree-sitter";
import type { ParseOutcome } from "../parsing/contracts/ParseOutcome.js";
import { COORDINATES, NORMALIZATION_VERSION, type AstDiagnostic, type AstDocument, type AstNode } from "./model.js";
import { validateAst } from "./serializer.js";

export interface AstBuildContext {
    analysisId: string;
    language: string;
    contentHash: string;
    parserVersion?: string;
    grammarVersion?: string;
    createdAt?: string;
}
export class AstBuilder {
    constructor(
        private readonly maxNodes = 100_000,
        private readonly maxDepth = 512
    ) {}
    build(outcome: Exclude<ParseOutcome, { status: "failed" }>, context: AstBuildContext): AstDocument {
        type BuildingNode = Omit<AstNode, "children"> & { children: string[] };
        const nodes: BuildingNode[] = [];
        const diagnostics: AstDiagnostic[] = [];
        const stack: { native: Parser.SyntaxNode; parentId: string | null; field: string | null; depth: number }[] = [
            { native: outcome.result.tree.rootNode, parentId: null, field: null, depth: 0 }
        ];
        const byId = new Map<string, BuildingNode>();
        while (stack.length) {
            if (nodes.length >= this.maxNodes) throw new Error("AST_NODE_LIMIT");
            const { native, parentId, field, depth } = stack.pop()!;
            if (depth > this.maxDepth) throw new Error("AST_DEPTH_LIMIT");
            const id = `n${nodes.length}`;
            const children = native.children;
            const node: BuildingNode = {
                id,
                type: native.type,
                parentId,
                fieldName: field,
                children: [],
                ...(!children.length ? { text: native.text } : {}),
                named: native.isNamed,
                error: native.isError,
                missing: native.isMissing,
                start: {
                    offset: native.startIndex,
                    row: native.startPosition.row,
                    column: native.startPosition.column
                },
                end: { offset: native.endIndex, row: native.endPosition.row, column: native.endPosition.column }
            };
            if (nodes.length + stack.length + children.length > this.maxNodes) throw new Error("AST_NODE_LIMIT");
            nodes.push(node);
            byId.set(id, node);
            if (parentId) byId.get(parentId)!.children.push(id);
            if (node.error || node.missing)
                diagnostics.push({
                    nodeId: id,
                    code: node.missing ? "MISSING_NODE" : "ERROR_NODE",
                    start: node.start,
                    end: node.end
                });
            for (let i = children.length - 1; i >= 0; i--)
                stack.push({
                    native: children[i]!,
                    parentId: id,
                    field: native.fieldNameForChild(i) ?? null,
                    depth: depth + 1
                });
        }
        const document: AstDocument = {
            schemaVersion: 1,
            normalizationVersion: NORMALIZATION_VERSION,
            projectId: outcome.projectId,
            analysisId: context.analysisId,
            relativePath: outcome.relativePath,
            language: context.language,
            parserId: outcome.parserId,
            parserVersion:
                outcome.provenance !== undefined ? outcome.provenance.parserVersion : (context.parserVersion ?? null),
            grammarVersion:
                outcome.provenance !== undefined ? outcome.provenance.grammarVersion : (context.grammarVersion ?? null),
            contentHash: context.contentHash,
            coordinates: COORDINATES,
            rootId: "n0",
            nodes,
            parseStatus: outcome.status,
            diagnostics,
            createdAt: context.createdAt ?? new Date().toISOString()
        };
        validateAst(document);
        return document;
    }
}
