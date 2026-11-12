import type {BindingDocument,Candidate as BindingCandidate} from '../cross-file-binding/model.js';
import type {Range} from '../symbol-resolution/model.js';
export const VERSION='cross-file-relationship-v1' as const;
export const LIMITS=Object.freeze({maxModules:1000,maxNodesPerFile:10000,maxNodes:200000,maxOperations:20000,maxNamespaceCalls:10000,maxDependencies:20000,maxRelationships:30000,maxCandidates:20000,maxDiagnostics:20000,maxStates:500000,maxContextDepth:256,maxInputBytes:64*1024*1024,maxBytes:96*1024*1024,maxResponseBytes:1024*1024,maxDurationMs:60000,maxPage:100});
export type Limits={[K in keyof typeof LIMITS]:number};
export class CrossRelationshipError extends Error {constructor(readonly code:string,readonly httpStatus=422){super(code);}}
export const bound=(ok:unknown)=>{if(!ok)throw new CrossRelationshipError('CROSS_REL_RESOURCE_LIMIT',413);};
export function checkpoint(deadline:number,signal?:AbortSignal){if(signal?.aborted)throw new CrossRelationshipError('CROSS_REL_CANCELLED',499);if(Date.now()>deadline)throw new CrossRelationshipError('CROSS_REL_TIME_LIMIT',503);}
export const STATUSES=['established','unresolved_callee','unresolved_module','ambiguous_target','unsupported_syntax','unsupported_callable_origin','unsupported_namespace_access','missing_caller_evidence','partial_producer_evidence','unsupported_runtime_semantics'] as const;
export type Status=typeof STATUSES[number];
export const KINDS=['calls','imports','reexports','constructs','tagged_template'] as const;
export type Kind=typeof KINDS[number];
export const GUARANTEES=['static_cross_file_call_v1','static_module_specifier_v1','observed_syntax_v1'] as const;
export type Guarantee=typeof GUARANTEES[number];
export interface Occurrence {id:string;astArtifactId:string;astNodeId:string;nodeType:string;range:Range;calleeAstNodeId:string|null;calleeRange:Range|null}
export interface Caller {id:string;moduleId:string;relativePath:string;kind:'module'|'callable'|'call_site';astArtifactId:string;astNodeId:string;nodeType:string;range:Range;scopeIds:string[];symbolIds:string[];metadataEntityId:string|null;codes:string[];truncated:boolean}
export interface Evidence {bindingId:string|null;referenceAssociationId:string|null;namespaceAssociationId:string|null;referenceId:string|null;localSymbolId:string|null;importIds:string[];exportIds:string[];importLinkIds:string[];exportEntryIds:string[];originId:string|null;witnesses:BindingCandidate[];existingRelationshipId:null}
export interface Callee {originId:string;moduleId:string;relativePath:string;astArtifactId:string;astNodeId:string;nodeType:string;range:Range;symbolId:string|null;metadataEntityId:string|null;meaning:'function_declaration'|'default_function_slot'}
export interface Base {id:string;projectId:string;analysisId:string;kind:Kind;guarantee:Guarantee;status:Status;sourceModuleId:string;sourcePath:string;sourceContextId:string;targetModuleId:string|null;targetPath:string|null;occurrence:Occurrence;evidence:Evidence;codes:string[];limitations:string[]}
export interface Call extends Base {kind:'calls';status:'established';guarantee:'static_cross_file_call_v1';targetModuleId:string;targetPath:string;target:Callee;localAlias:string|null;importedName:string|null}
export interface Dependency extends Base {kind:'imports'|'reexports';status:'established';guarantee:'static_module_specifier_v1';targetModuleId:string;targetPath:string;specifier:string;policy:'explicit-relative-js-v1';forms:string[]}
export interface Observation extends Base {status:Exclude<Status,'established'>;guarantee:'observed_syntax_v1';target:Callee|null}
export interface Coverage {moduleId:string;relativePath:string;eligible:boolean;sourceEvidence:string;lexicalAvailable:boolean;operations:number;calls:number;dependencies:number;candidates:number;nonCallImportedReferences:number;codes:string[]}
export interface Diagnostic {sourceModuleId:string;sourcePath:string;recordId:string|null;code:string}
export interface RelationshipDocument {schemaVersion:1;relationshipVersion:typeof VERSION;artifactId:string;projectId:string;analysisId:string;moduleArtifactId:string;moduleDocumentHash:string;bindingArtifactId:string;bindingDocumentHash:string;sourceAnalysisHash:string;resolutionAnalysisHash:string;metadataAnalysisHash:string;limits:Limits;status:'complete'|'partial';calls:Call[];dependencies:Dependency[];candidates:Observation[];contexts:Caller[];coverage:Coverage[];diagnostics:Diagnostic[];counts:{modules:number;eligibleModules:number;operations:number;namespaceCalls:number;calls:number;dependencies:number;imports:number;reexports:number;candidates:number;contexts:number;truncatedContexts:number;nonCallImportedReferences:number};limitations:string[];input:BindingDocument}
