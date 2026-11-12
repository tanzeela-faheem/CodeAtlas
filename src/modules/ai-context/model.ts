import type { Range } from '../symbol-resolution/model.js';
import type { Direction,EdgeKind,GraphDocument } from '../knowledge-graph/model.js';
import type { SearchIndex,SearchRequest } from '../search-engine/model.js';
import type { AdvancedIndex,AdvancedRequest } from '../search-engine/advanced/model.js';
export const CONTEXT_VERSION='evidence-context-v1' as const;
export const CATEGORIES=['metadata','graph','relationships','candidates','documentation','source','search'] as const;
export type Category=typeof CATEGORIES[number];
export type Focus={type:'entity';entityId:string}|{type:'graph_node';nodeId:string}|{type:'file';relativePath:string;range?:Range};
export interface ContextRequest {
 schemaVersion:1;userQuestion:string;strategy:'focused'|'search'|'question_lexical';focus:Focus[];
 categories:Category[];search:SearchRequest|AdvancedRequest|null;
 graph:{direction:Direction;edgeKinds:EdgeKind[];maxDepth:number;maxNodes:number;maxEdges:number;maxCandidates:number};
 retrieval:{maxSearchResults:number;maxRetrievedRecords:number;maxSnippets:number;maxDocumentation:number;maxDurationMs:number};
 budget:{maxCharacters:number;maxBytes:number;maxEvidence:number;maxSnippetCharacters:number;maxDocumentationCharacters:number;maxItemBytes:number};
 sourcePolicy:'verified_current'|'allow_historical';
}
export const CONTEXT_LIMITS=Object.freeze({maxFocus:4,maxQuestion:2048,maxGraphDepth:2,maxGraphNodes:50,maxGraphEdges:100,maxCandidates:20,maxSearchResults:20,maxRetrievedRecords:256,maxSnippets:12,maxDocumentation:8,maxDurationMs:30000,maxCharacters:131072,maxBytes:262144,maxEvidence:100,maxSnippetCharacters:2048,maxDocumentationCharacters:4096,maxItemBytes:16384,maxInputBytes:128*1024*1024,maxResponseBytes:1024*1024,maxFileDetails:20});
export class ContextError extends Error {constructor(readonly code:string,readonly httpStatus=422){super(code);}}
export interface ContextProvenance {
 graphSnapshotId:string;graphDocumentHash:string;sourceAnalysisHash:string;metadataAnalysisHash:string;resolutionAnalysisHash:string;relationshipAnalysisHash:string;
 searchIndexId:string|null;searchDocumentHash:string|null;advancedIndexId:string|null;advancedDocumentHash:string|null;
}
export type EvidenceKind='metadata_entity'|'graph_node'|'established_relationship'|'candidate_relationship'|'documentation'|'source_excerpt'|'search_match';
export type EvidenceClass='recorded_metadata'|'recorded_graph_node'|'local_semantic'|'syntactic_ownership'|'heritage_syntax'|'uncertain'|'recorded_documentation'|'verified_source'|'historical_source'|'historical_search_match';
export interface Navigation {relativePath:string|null;range:Range|null;contentHash:string|null;metadataEntityId:string|null;moduleId:string|null;astArtifactId:string|null;astNodeId:string|null;symbolId:string|null;graphNodeId:string|null;graphEdgeId:string|null;relationshipId:string|null;metadataArtifactId:string|null;resolutionArtifactId:string|null;relationshipArtifactId:string|null;searchDocumentId:string|null;searchMatchId:string|null}
export interface Evidence {
 evidenceId:string;kind:EvidenceKind;classification:EvidenceClass;projectId:string;analysisId:string;provenanceId:string;
 producer:{module:string;schemaVersion:number;version:string;identity:string;artifactId:string;documentHash:string};
 navigation:Navigation;content:unknown;ranking:{score:number;reasons:string[]};limitations:string[];
}
export type DraftEvidence=Omit<Evidence,'evidenceId'|'projectId'|'analysisId'|'provenanceId'>;
export interface Omission {code:string;kind:EvidenceKind|null;count:number}
export interface ContextCoverage {
 graph:{evidenceCoverage:GraphDocument['snapshot']['evidenceCoverage'];totalFiles:number;counts:Record<string,number>;metadataCounts:Record<string,number>;files:GraphDocument['snapshot']['coverage'];fileDetailsOmitted:number};
 search:{state:'not_requested'|'available'|'missing';schemaVersion:1|2|null;totalMatches:number|null;returned:number;truncated:boolean;code:string|null};
 traversal:{seedCount:number;nodeCount:number;edgeCount:number;candidateCount:number;truncated:boolean;limitsReached:string[]};
 sources:{relativePath:string;status:'verified_current'|'historical'|'unavailable'|'unsupported';code:string|null}[];
 omissions:Omission[];diagnostics:string[];
}
export interface AIContextPackage {
 schemaVersion:1;engineVersion:typeof CONTEXT_VERSION;contextId:string;projectId:string;analysisId:string;
 request:ContextRequest;provenance:ContextProvenance;status:'complete'|'partial';evidence:Evidence[];
 coverage:ContextCoverage;counts:{retrieved:number;selected:number;omitted:number;byKind:Record<string,{retrieved:number;selected:number;omitted:number}>};
 totals:{characters:number;bytes:number;evidenceRecords:number;sourceExcerpts:number;documentationRecords:number};
}
export interface GroundingInputs {graph:GraphDocument;search:SearchIndex|null;advanced:AdvancedIndex|null}
export function checkpoint(deadline:number,signal?:AbortSignal){if(signal?.aborted)throw new ContextError('CONTEXT_CANCELLED',499);if(Date.now()>deadline)throw new ContextError('CONTEXT_TIME_BUDGET',503);}
