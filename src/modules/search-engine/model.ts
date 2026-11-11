import type { Range } from '../symbol-resolution/model.js';
export const SEARCH_VERSION = 'search-lexical-v1' as const;
export const LIMITS = Object.freeze({maxFiles:1000,maxDocuments:100000,maxTerms:200000,maxPostings:1000000,maxSourceBytes:16*1024*1024,maxBytes:32*1024*1024,maxDurationMs:60000,maxResponseBytes:1024*1024,maxQuery:256,maxToken:256});
export const FIELDS = ['name','qualifiedName','path','text','module'] as const;
export type Field = typeof FIELDS[number];
export interface SearchDocument {
 id:string; projectId:string; analysisId:string; type:'file'|'entity'|'source_occurrence'; entityKind:string|null;
 language:string|null; relativePath:string; range:Range|null; fields:Partial<Record<Field,string>>;
 metadataEntityId:string|null; astArtifactId:string|null; astNodeId:string|null; symbolId:string|null; graphNodeId:string|null; moduleId:string|null;
 contentHash:string|null; snippet:{text:string;startOffset:number;matchStart:number;matchEnd:number}|null;
 limitations:string[];
}
export interface Posting {documentId:string;field:Field}
export interface SearchTables {exact:[string,Posting[]][];lexical:[string,Posting[]][];kind:[string,string[]][];language:[string,string[]][];path:[string,string[]][];directory:[string,string[]][];module:[string,string[]][]}
export interface Coverage {relativePath:string;source:'indexed'|'unavailable'|'unsupported';metadata:'complete'|'partial'|'unavailable';codes:string[]}
export interface SearchIndex {
 schemaVersion:1;builderVersion:typeof SEARCH_VERSION;indexId:string;projectId:string;analysisId:string;
 provenance:{graphSnapshotId:string;graphDocumentHash:string;sourceAnalysisHash:string;metadataAnalysisHash:string;resolutionAnalysisHash:string;relationshipAnalysisHash:string};
 configuration:{tokenization:'unicode-nfc-camel-v1';source:'verified-tokens-v1'};
 status:'complete'|'partial';coverage:Coverage[];documents:SearchDocument[];tables:SearchTables;
 diagnostics:string[];
}
export interface SearchRequest {schemaVersion:1;query:string;mode:'exact'|'lexical';filters:{documentKind?:SearchDocument['type'];entityKind?:string;language?:string;path?:string;pathPrefix?:string;moduleId?:string;startRow?:number;endRow?:number};offset:number;limit:number}
export class SearchError extends Error {constructor(readonly code:string,readonly httpStatus=422){super(code);}}
export function checkpoint(deadline:number){if(Date.now()>deadline)throw new SearchError('SEARCH_TIME_BUDGET',503);}
