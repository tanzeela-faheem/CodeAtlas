import type {AstDocument,AstNode} from '../ast-management/model.js';
import type {AstReference} from '../ast-management/store.js';
import type {AnalysisSummary} from '../analysis/model.js';
import type {ResolutionAnalysis,ResolutionDocument,MetadataReference,Range} from '../symbol-resolution/model.js';
export const MODULE_VERSION='module-linking-v1' as const;
export const MODULE_POLICY='explicit-relative-js-v1' as const;
export const LIMITS=Object.freeze({maxModules:1000,maxNodesPerFile:10000,maxRecords:20000,maxExportEntries:20000,maxCandidates:32,maxDepth:32,maxStates:100000,maxDiagnostics:10000,maxInputBytes:64*1024*1024,maxSourceBytes:16*1024*1024,maxBytes:32*1024*1024,maxResponseBytes:1024*1024,maxDurationMs:60000,maxPage:100,maxSyntaxCharacters:4096});
export type Limits=typeof LIMITS extends Readonly<infer T>?{[K in keyof T]:number}:never;
export class ModuleError extends Error{constructor(readonly code:string,readonly httpStatus=422){super(code);}}
export const STATUSES=['established','unresolved_module','unresolved_export','ambiguous_export','unsupported_resolution','unsupported_syntax','partial_evidence'] as const;
export type Status=typeof STATUSES[number];
export interface InputFile{relativePath:string;ast:AstDocument|null;resolution:ResolutionDocument|null;source:string|null;codes:string[]}
export interface ModuleInput{source:AnalysisSummary;resolution:ResolutionAnalysis;files:InputFile[]}
export interface Diagnostic{code:string;moduleId:string;recordId:string|null}
export interface ModuleRecord{id:string;projectId:string;analysisId:string;relativePath:string;language:string|null;parserId:string|null;parserVersion:string|null;grammarVersion:string|null;contentHash:string|null;astArtifactId:string|null;astDocumentHash:string|null;metadataArtifact:MetadataReference|null;metadataModuleEntityId:null;resolutionArtifactId:string|null;resolutionDocumentHash:string|null;status:'available'|'partial'|'unsupported'|'unavailable';syntaxComplete:boolean;exportComplete:boolean;sourceEvidence:'verified_snapshot'|'retained_ast'|'unavailable';codes:string[]}
export interface Syntax{astNodeId:string;statementAstNodeId:string;range:Range;statementRange:Range;text:string|null;textRange:Range|null;truncated:boolean;astArtifactId:string}
export interface ModuleResolution{status:Status;specifier:string|null;normalizedPath:string|null;targetModuleId:string|null;candidates:string[];code:string|null}
export interface Declaration{astNodeId:string;metadataEntityId:string|null;range:Range}
export interface Origin{key:string;moduleId:string;kind:'binding'|'namespace'|'default_expression';symbolId:string|null;declarations:Declaration[];namespaceModuleId:string|null;expressionAstNodeId:string|null}
export interface ImportRecord{id:string;moduleId:string;form:'named'|'default'|'namespace'|'side_effect'|'dynamic'|'require'|'unsupported';importedName:string|null;localName:string|null;localSymbolId:string|null;localMetadataEntityId:string|null;source:ModuleResolution;syntax:Syntax;status:Status;codes:string[]}
export interface ExportRecord{id:string;moduleId:string;form:'declaration'|'local'|'default'|'named_reexport'|'star'|'namespace_reexport'|'unsupported';exportedName:string|null;localName:string|null;importedName:string|null;source:ModuleResolution|null;syntax:Syntax;status:Status;origin:Origin|null;codes:string[]}
export interface Candidate{origin:Origin;chain:string[]}
export interface ExportEntry{id:string;moduleId:string;exportedName:string;knownName:boolean;status:Status;candidates:Candidate[];codes:string[];truncated:boolean;cycleEncountered:boolean;alternateRoutes:boolean}
export interface ImportLink{id:string;moduleId:string;importId:string;targetModuleId:string|null;exportEntryId:string|null;status:Status;association:'export_binding'|'namespace'|'side_effect'|'none';candidates:Candidate[];codes:string[]}
export interface ModuleDocument{schemaVersion:1;linkerVersion:typeof MODULE_VERSION;policy:typeof MODULE_POLICY;artifactId:string;projectId:string;analysisId:string;inputHash:string;sourceAnalysisHash:string;resolutionAnalysisHash:string;metadataAnalysisHash:string;limits:Limits;status:'complete'|'partial';modules:ModuleRecord[];imports:ImportRecord[];exports:ExportRecord[];exportEntries:ExportEntry[];links:ImportLink[];diagnostics:Diagnostic[];inputs:ModuleInput;counts:{modules:number;imports:number;exports:number;exportEntries:number;links:number};limitations:string[]}
export interface Extraction{imports:ImportRecord[];exports:ExportRecord[];unknownExports:boolean;codes:string[]}
export type AstLookup={nodes:Map<string,AstNode>;children:(n:AstNode)=>AstNode[];field:(n:AstNode,name:string)=>AstNode|undefined};
export const terminal=(s:string)=>['completed','completed_with_errors'].includes(s);
export function checkpoint(deadline:number,signal?:AbortSignal){if(signal?.aborted)throw new ModuleError('MODULE_CANCELLED',499);if(Date.now()>deadline)throw new ModuleError('MODULE_TIME_LIMIT',503);}
export function bound(ok:unknown){if(!ok)throw new ModuleError('MODULE_RESOURCE_LIMIT',413);}
