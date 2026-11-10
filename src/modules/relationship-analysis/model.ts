import type { AstDocument } from "../ast-management/model.js";
import type { AstProvenance, Diagnostic, MetadataDiagnostic, MetadataReference, Range, ResolutionAnalysis, ResolutionReference } from "../symbol-resolution/model.js";
export const ANALYZER_VERSION = "javascript-relationships-v1" as const;
export const KINDS = ["calls", "constructs", "extends_syntax", "imports_syntax", "exports_syntax", "reads", "writes", "contains"] as const;
export type RelationshipKind = typeof KINDS[number];
export type TargetStatus = "established" | "unresolved" | "ambiguous" | "deferred" | "unsupported" | "invalid";
export interface Endpoint { entityId: string | null; symbolId: string | null }
export interface Target extends Endpoint {
    status: TargetStatus;
    meaning: "callable_declaration" | "class_declaration" | "lexical_binding" | "syntactic_entity" | null;
}
export interface SyntaxSlice { astNodeId: string; tokens: { astNodeId: string; text: string }[]; truncated: boolean }
export interface RelationshipRecord {
    relationshipId: string; kind: RelationshipKind;
    source: { entityId: string; moduleEntityId: string; enclosingCallableEntityId: string | null; context: "module" | "callable" | "initializer" | "declaration" | "ownership" };
    target: Target;
    classification: "verified_local" | "syntax" | "candidate" | "unsupported" | "invalid";
    astNodeId: string; range: Range;
    evidence: { astNodeIds: string[]; metadataEntityIds: string[]; referenceIds: string[]; bindingSymbolId: string | null; candidateSymbolIds: string[] };
    syntax: {
        expression: SyntaxSlice | null; moduleSpecifier: SyntaxSlice | null;
        importedName: string | null; localName: string | null; exportedName: string | null;
        importKind: "default" | "named" | "namespace" | "side_effect" | null;
        exportKind: "local" | "declaration" | "default" | "reexport" | "star" | null;
    };
    limitations: string[];
}
export interface RelationshipInputs {
    sourceAst: AstProvenance; astArtifactId: string; metadataArtifact: MetadataReference;
    resolutionArtifact: ResolutionReference; resolverVersion: string;
    sourceAnalysisHash: string; metadataAnalysisHash: string; resolutionAnalysisHash: string;
}
export interface RelationshipCounts {
    kinds: Record<RelationshipKind, number>;
    targets: Record<TargetStatus, number>;
}
export interface RelationshipDocument {
    schemaVersion: 1; analyzerVersion: typeof ANALYZER_VERSION; inputs: RelationshipInputs;
    upstreamStatus: "complete" | "partial"; status: "complete" | "partial";
    relationships: RelationshipRecord[]; counts: RelationshipCounts; diagnostics: Diagnostic[];
    upstreamDiagnostics: { ast: AstDocument["diagnostics"]; metadata: MetadataDiagnostic[]; resolution: Diagnostic[]; references: { referenceId: string; diagnostics: Diagnostic[] }[] };
}
export interface RelationshipReference { artifactId: string; documentHash: string; relativePath: string; counts: RelationshipCounts; status: "complete" | "partial" }
export interface RelationshipOutcome {
    relativePath: string; status: "complete" | "partial" | "unavailable" | "unsupported" | "failed";
    code: string | null; artifact: RelationshipReference | null;
    upstreamStatus: string; upstreamCode: string | null; upstreamDiagnostics: ResolutionAnalysis["files"][number]["upstreamDiagnostics"];
}
export interface RelationshipAnalysis {
    schemaVersion: 1; analyzerVersion: typeof ANALYZER_VERSION; projectId: string; analysisId: string;
    sourceAnalysisHash: string; metadataAnalysisHash: string; resolutionAnalysisHash: string;
    upstreamStatus: ResolutionAnalysis["status"];
    upstreamDiagnostics: ResolutionAnalysis["upstreamDiagnostics"];
    status: "running" | "complete" | "partial" | "failed" | "interrupted";
    startedAt: string; completedAt: string | null; files: RelationshipOutcome[];
    counts: Record<RelationshipOutcome["status"], number>;
    relationshipCounts: RelationshipCounts;
}
export interface RelationshipLimits {
    maxFiles: number; maxNodes: number; maxEntities: number; maxReferences: number;
    maxRelationships: number; maxArtifactBytes: number; maxTotalBytes: number; maxDurationMs: number;
}
export const DEFAULT_LIMITS: Readonly<RelationshipLimits> = Object.freeze({
    maxFiles: 1000, maxNodes: 10000, maxEntities: 10000, maxReferences: 10000,
    maxRelationships: 20000, maxArtifactBytes: 16 * 1024 * 1024,
    maxTotalBytes: 128 * 1024 * 1024, maxDurationMs: 60000
});
export class RelationshipError extends Error {
    constructor(readonly code: string, readonly httpStatus = 422) { super(code); }
}
export const emptyRelationshipCounts = (): RelationshipCounts => ({
    kinds: { calls: 0, constructs: 0, extends_syntax: 0, imports_syntax: 0, exports_syntax: 0, reads: 0, writes: 0, contains: 0 },
    targets: { established: 0, unresolved: 0, ambiguous: 0, deferred: 0, unsupported: 0, invalid: 0 }
});
export const emptyFileCounts = (): RelationshipAnalysis["counts"] => ({ complete: 0, partial: 0, unavailable: 0, unsupported: 0, failed: 0 });
export function validateLimits(limits: RelationshipLimits): void {
    for (const key of Object.keys(DEFAULT_LIMITS) as (keyof RelationshipLimits)[]) {
        if (!Number.isSafeInteger(limits[key]) || limits[key] <= 0 || limits[key] > DEFAULT_LIMITS[key]) throw new Error("Invalid relationship limits");
    }
}
