import type { AstDocument } from '../ast-management/model.js';
import type { AnalysisSummary } from '../analysis/model.js';
import type { MetadataAnalysis, MetadataDocument, ResolutionAnalysis, ResolutionDocument, Range } from '../symbol-resolution/model.js';
import type { RelationshipAnalysis, RelationshipDocument, RelationshipRecord } from '../relationship-analysis/model.js';

export const GRAPH_VERSION = 'knowledge-graph-v1' as const;
export const NODE_KINDS = ['module','class','function','method','constructor','field','variable_declaration','variable','parameter','import','import_specifier','export','export_specifier','comment','documentation','binding'] as const;
export const EDGE_KINDS = ['CALLS','CREATES','READS','WRITES','CONTAINS','EXTENDS'] as const;
export type NodeKind = typeof NODE_KINDS[number];
export type EdgeKind = typeof EDGE_KINDS[number];
export type Direction = 'outgoing' | 'incoming' | 'both';
export interface GraphProvenance {
    projectId: string; analysisId: string; sourceAnalysisHash: string; metadataAnalysisHash: string;
    resolutionAnalysisHash: string; relationshipAnalysisHash: string; architectureAnalysisHash: null;
}
export interface GraphNode {
    graphNodeId: string; projectId: string; analysisId: string; nodeKind: NodeKind;
    displayName: string; qualifiedName: string | null; language: string; relativePath: string; range: Range;
    metadataEntityId: string | null; symbolId: string | null; astNodeId: string;
    parentGraphNodeId: string | null; declarationGraphNodeIds: string[];
    evidence: { astArtifactId: string; metadataArtifactId: string; resolutionArtifactId: string | null };
    attributes: Record<string, unknown>; properties: Record<string, unknown>; limitations: string[];
}
export interface GraphEdge {
    graphEdgeId: string; projectId: string; analysisId: string;
    sourceGraphNodeId: string; targetGraphNodeId: string; edgeKind: EdgeKind;
    classification: 'established'; guarantee: 'local_semantic' | 'syntactic_ownership' | 'heritage_syntax';
    relationshipId: string; relationshipArtifactId: string; relativePath: string; astNodeId: string; range: Range;
    sourceContext: RelationshipRecord['source']; limitations: string[];
}
export interface GraphCandidate {
    candidateId: string; projectId: string; analysisId: string; sourceGraphNodeId: string;
    relativePath: string; relationshipArtifactId: string; relationship: RelationshipRecord;
    reason: 'TARGET_NOT_ESTABLISHED' | 'UNMAPPED_RELATIONSHIP' | 'CLASS_INITIALIZER_CONTEXT_UNMODELED';
}
export interface GraphFile {
    ast: AstDocument; metadata: MetadataDocument;
    resolution: ResolutionDocument | null; relationships: RelationshipDocument | null;
}
export interface GraphGap {
    relativePath: string; stage: 'metadata' | 'resolution' | 'relationships';
    code: 'GRAPH_UPSTREAM_MISSING' | 'GRAPH_UPSTREAM_UNAVAILABLE' | 'GRAPH_INPUT_INCOMPATIBLE';
}
export interface GraphInput {
    source: AnalysisSummary; metadataAnalysis: MetadataAnalysis; resolutionAnalysis: ResolutionAnalysis;
    relationshipAnalysis: RelationshipAnalysis; files: GraphFile[]; gaps: GraphGap[];
}
export interface GraphCoverage {
    relativePath: string; sourceStatus: string; metadataStatus: string; resolutionStatus: string; relationshipStatus: string;
    status: 'available' | 'partial' | 'unsupported' | 'unavailable' | 'failed'; codes: string[];
}
export interface GraphSnapshot extends GraphProvenance {
    schemaVersion: 1; graphBuilderVersion: typeof GRAPH_VERSION; snapshotId: string; createdAt: string;
    executionStatus: 'completed' | 'completed_with_errors'; evidenceCoverage: 'supported_subset' | 'partial' | 'insufficient';
    nodeCount: number; edgeCount: number; candidateCount: number;
    countsByNodeKind: Partial<Record<NodeKind, number>>; countsByEdgeKind: Partial<Record<EdgeKind, number>>;
    coverage: GraphCoverage[]; diagnostics: {code: string; relativePath: string | null; message: string}[];
    storage: { artifact: string; index: 'derived_in_memory' };
}
/** Bounded internal artifact; never returned as a full graph API response. */
export interface GraphDocument { snapshot: GraphSnapshot; nodes: GraphNode[]; edges: GraphEdge[]; candidates: GraphCandidate[]; evidence: GraphInput }
export interface GraphLimits {
    maxFiles: number; maxNodes: number; maxEdges: number; maxCandidates: number; maxEntities: number;
    maxRelationships: number; maxInputBytes: number; maxBytes: number; maxDurationMs: number;
}
export const GRAPH_LIMITS: Readonly<GraphLimits> = Object.freeze({maxFiles:1000,maxEntities:20000,maxNodes:40000,maxEdges:50000,maxCandidates:50000,maxRelationships:50000,maxInputBytes:64*1024*1024,maxBytes:32*1024*1024,maxDurationMs:60000});
export const QUERY_LIMIT = 200;
export const TRAVERSAL_LIMITS = Object.freeze({maxDepth:1000,maxNodes:5000,maxEdges:10000});
export class GraphError extends Error {
    constructor(readonly code: string, readonly httpStatus=422) { super(code); }
}
export function graphCheckpoint(deadline: number): void { if(Date.now()>deadline)throw new GraphError('GRAPH_TIME_BUDGET',503); }
