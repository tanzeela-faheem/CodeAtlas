import type { AstReference } from "../ast-management/store.js";
export type FileStatus =
    | "parsed"
    | "syntax_errors"
    | "unsupported"
    | "skipped"
    | "read_failed"
    | "parser_failed"
    | "ast_failed"
    | "storage_failed";
export interface FileOutcome {
    relativePath: string;
    status: FileStatus;
    code?: string;
    artifact?: AstReference;
}
export interface AnalysisSummary {
    schemaVersion: 1;
    projectId: string;
    analysisId: string;
    status: "queued" | "running" | "completed" | "completed_with_errors" | "failed" | "interrupted";
    startedAt: string;
    completedAt?: string;
    counts: Record<FileStatus, number>;
    files: FileOutcome[];
    failureCode?: string;
}
export const emptyCounts = (): AnalysisSummary["counts"] => ({
    parsed: 0,
    syntax_errors: 0,
    unsupported: 0,
    skipped: 0,
    read_failed: 0,
    parser_failed: 0,
    ast_failed: 0,
    storage_failed: 0
});
