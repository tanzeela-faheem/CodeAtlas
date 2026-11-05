export const AST_SCHEMA_VERSION = 1;
export const NORMALIZATION_VERSION = "syntax-preorder-v1";
export const COORDINATES = "utf16-code-units; zero-based rows/columns; end-exclusive" as const;
export interface SourcePoint {
    readonly offset: number;
    readonly row: number;
    readonly column: number;
}
export interface AstNode {
    readonly id: string;
    readonly type: string;
    readonly parentId: string | null;
    readonly fieldName: string | null;
    readonly children: readonly string[];
    readonly named: boolean;
    readonly error: boolean;
    readonly missing: boolean;
    readonly start: SourcePoint;
    readonly end: SourcePoint;
    // Only leaves retain text. Non-leaf text is recoverable from source spans.
    readonly text?: string;
}
export interface AstDiagnostic {
    readonly nodeId: string;
    readonly code: "ERROR_NODE" | "MISSING_NODE";
    readonly start: SourcePoint;
    readonly end: SourcePoint;
}
export interface AstDocument {
    readonly schemaVersion: 1;
    readonly normalizationVersion?: string;
    readonly projectId: string;
    readonly analysisId: string;
    readonly relativePath: string;
    readonly language: string;
    readonly parserId: string;
    readonly parserVersion: string | null;
    readonly grammarVersion: string | null;
    readonly contentHash: string;
    readonly coordinates: typeof COORDINATES;
    readonly rootId: string;
    readonly nodes: readonly AstNode[];
    readonly parseStatus: "success" | "syntax_errors";
    readonly diagnostics: readonly AstDiagnostic[];
    readonly createdAt: string;
}
