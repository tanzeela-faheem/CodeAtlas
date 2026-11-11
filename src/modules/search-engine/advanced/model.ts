import type { SearchIndex, SearchRequest } from '../model.js';
import type { EdgeKind, NodeKind } from '../../knowledge-graph/model.js';
export const ADVANCED_VERSION = 'search-positional-v2' as const;
export const ADVANCED_LIMITS = Object.freeze({maxPositions:100000,maxTerms:200000,maxPostings:1000000,maxSourceBytes:16*1024*1024,maxBytes:32*1024*1024,maxFiles:1000,maxDurationMs:60000,maxConstraints:4,maxEvidence:100,maxOccurrences:20});
export type AdvancedLimits = {[K in keyof typeof ADVANCED_LIMITS]:number};
export interface Position {start:number;end:number;term:string|null;documentId:string|null}
export interface HistoricalSource {fileId:string;relativePath:string;contentHash:string;astArtifactId:string;text:string;positions:Position[]}
export interface PositionRef {fileId:string;position:number}
export interface AdvancedIndex {
 schemaVersion:2;builderVersion:typeof ADVANCED_VERSION;indexId:string;projectId:string;analysisId:string;
 baseIndexId:string;baseDocumentHash:string;provenance:SearchIndex['provenance'];
 configuration:{tokenization:'whole-identifier-nfc-v1';textPhrase:'longest-whole-token-anchor-v1'};
 coverage:{relativePath:string;status:'indexed'|'unavailable'|'unsupported';code:string|null}[];
 sources:HistoricalSource[];tokens:[string,PositionRef[]][];lexical:[string,PositionRef[]][];
}
export interface AdvancedRequest {
 schemaVersion:2;mode:'entity'|'token_phrase'|'text_phrase'|'file_lexical';query:string|null;match:'exact'|'lexical';
 filters:SearchRequest['filters'];entity:{id?:string;name?:string;qualifiedName?:string;parentId?:string;parentMode?:'direct'|'descendant'};
 graph:{nodeId:string;direction:'incoming'|'outgoing';edgeKind:EdgeKind;neighborKind?:NodeKind}[];
 groupBy:'entity'|'occurrence'|'file';offset:number;limit:number;occurrenceLimit:number;
}
export const ADVANCED_CONFIGURATION:AdvancedIndex['configuration']={tokenization:'whole-identifier-nfc-v1',textPhrase:'longest-whole-token-anchor-v1'};
