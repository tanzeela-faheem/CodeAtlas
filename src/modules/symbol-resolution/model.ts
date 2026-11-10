import type { AstDocument, SourcePoint } from "../ast-management/model.js";
import type { AstReference } from "../ast-management/identity.js";
import type { AnalysisSummary } from "../analysis/model.js";
export const RESOLVER_VERSION = "javascript-lexical-v1" as const;
export const METADATA_VERSION = "project-metadata-v1/javascript-syntax-v1";
export interface Range { start: SourcePoint; end: SourcePoint }
export interface Diagnostic { code: string; astNodeId: string | null; message: string }
export interface MetadataEntity {
    entityId: string; kind: string; name: string | null; qualifiedName: string | null;
    language: string; projectId: string; analysisId: string; relativePath: string; contentHash: string;
    astNodeId: string; parentEntityId: string | null; sourceRange: Range;
    attributes: Record<string, unknown>; properties: Record<string, unknown>;
}
export interface MetadataDiagnostic { code: string; message: string; astNodeId: string | null; sourceRange: Range | null }
export type AstProvenance = Omit<AstDocument, "nodes" | "diagnostics" | "normalizationVersion"> & { normalizationVersion: string | null };
export interface MetadataDocument {
    schemaVersion: 1; extractorVersion: "javascript-syntax-v1"; sourceAst: AstProvenance;
    extractionStatus: "complete" | "partial"; entities: MetadataEntity[];
    diagnostics: MetadataDiagnostic[]; summary: Record<string, number>;
}
export interface MetadataReference {
    artifactId: string; astArtifactId: string; projectId: string; analysisId: string;
    relativePath: string; contentHash: string; documentHash: string;
    extractionStatus: "complete" | "partial"; entityCounts: Record<string, number>;
}
export interface MetadataOutcome {
    relativePath: string; upstreamStatus: string; status: string;
    sourceArtifact: AstReference | null; metadataArtifact: MetadataReference | null;
    diagnostics: { code: string; message: string; relativePath: string | null; astArtifactId: string | null }[];
}
export interface MetadataAnalysis {
    schemaVersion: 1; projectId: string; analysisId: string; extractionVersion: typeof METADATA_VERSION;
    status: "complete" | "partial" | "failed"; createdAt: string; completedAt: string;
    sourceAnalysis: AnalysisSummary; sourceAnalysisHash: string; files: MetadataOutcome[];
    entityCounts: Record<string, number>; outcomeCounts: Record<string, number>;
    diagnostics: MetadataOutcome["diagnostics"];
}
export type BindingKind = "var" | "let" | "const" | "function" | "parameter" | "class" | "catch" | "import" | "function-name" | "class-name";
export interface SymbolRecord {
    id: string; name: string; kind: BindingKind; scopeId: string; bindingNodeId: string;
    declarations: { metadataEntityId: string | null; astNodeId: string; range: Range }[];
    initializationOffset: number | null; modifiers: string[];
    import: { importedName: string; moduleSpecifier: string; targetStatus: "deferred" } | null;
}
export interface ScopeRecord {
    id: string; kind: "module" | "function" | "parameters" | "block" | "class" | "catch" | "function-name";
    parentId: string | null; astNodeId: string; range: Range; children: string[]; bindings: string[];
}
export interface ReferenceRecord {
    id: string; name: string; astNodeId: string; range: Range; scopeId: string;
    usage: "read" | "write" | "read_write" | "call" | "export";
    status: "resolved" | "unresolved" | "ambiguous" | "unsupported" | "invalid";
    symbolId: string | null; candidates: string[];
    initialization: "not_applicable" | "before_initialization" | "runtime_unknown";
    diagnostics: Diagnostic[];
}
export interface ResolutionDocument {
    schemaVersion: 1; resolverVersion: typeof RESOLVER_VERSION; sourceAst: AstProvenance;
    astArtifactId: string; metadataArtifact: MetadataReference; status: "complete" | "partial";
    scopes: ScopeRecord[]; symbols: SymbolRecord[]; references: ReferenceRecord[];
    diagnostics: Diagnostic[]; astDiagnostics: AstDocument["diagnostics"];
    metadataDiagnostics: MetadataDiagnostic[];
}
export interface ResolutionReference { artifactId: string; documentHash: string; relativePath: string }
export interface ResolutionOutcome {
    relativePath: string; status: "complete" | "partial" | "unavailable" | "unsupported" | "failed";
    code: string | null; artifact: ResolutionReference | null; upstreamDiagnostics: MetadataOutcome["diagnostics"];
}
export interface ResolutionAnalysis {
    schemaVersion: 1; resolverVersion: typeof RESOLVER_VERSION; projectId: string; analysisId: string;
    metadataAnalysisHash: string; sourceAnalysisHash: string; extractionVersion: string; upstreamStatus: MetadataAnalysis["status"]; upstreamDiagnostics: MetadataAnalysis["diagnostics"]; status: "running" | "complete" | "partial" | "failed" | "interrupted";
    startedAt: string; completedAt: string | null; files: ResolutionOutcome[];
    counts: Record<ResolutionOutcome["status"], number>;
}
export class ResolutionError extends Error {
    constructor(readonly code: string, readonly httpStatus = 422) { super(code); }
}
