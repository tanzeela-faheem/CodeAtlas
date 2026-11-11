import path from 'node:path';
import { setImmediate as yieldToLoop } from 'node:timers/promises';
import * as v from '../../../shared/validation.js';
import type { GraphDocument } from '../../knowledge-graph/model.js';
import type { SourceReader } from '../../analysis/source-reader.js';
import { verifyAstSource } from '../../ast-management/serializer.js';
import { digest } from '../../symbol-resolution/integration/contracts.js';
import { LIMITS,SearchError,checkpoint,type SearchIndex } from '../model.js';
import { compare } from '../indexing.js';
import { ADVANCED_VERSION,ADVANCED_CONFIGURATION,ADVANCED_LIMITS,type AdvancedIndex,type AdvancedLimits } from './model.js';
import { positions,positionalTables } from './positions.js';
export const advancedIdentity=(value:Omit<AdvancedIndex,'indexId'>)=>'sx-'+digest(value);
export function matchSnapshots(index:AdvancedIndex,base:SearchIndex,graph:GraphDocument){
 v.check(index.projectId===base.projectId&&index.analysisId===base.analysisId&&index.baseIndexId===base.indexId&&index.baseDocumentHash===digest(base),'advanced base snapshot');
 v.check(graph.snapshot.projectId===base.projectId&&graph.snapshot.analysisId===base.analysisId&&digest(index.provenance)===digest(base.provenance)&&index.provenance.graphDocumentHash===digest(graph)&&index.provenance.graphSnapshotId===graph.snapshot.snapshotId,'advanced graph snapshot');
 v.check(index.coverage.length===base.coverage.length&&index.coverage.every(c=>base.coverage.some(b=>b.relativePath===c.relativePath)),'advanced coverage ownership');
 for(const key of ['sourceAnalysisHash','metadataAnalysisHash','resolutionAnalysisHash','relationshipAnalysisHash'] as const)v.check(index.provenance[key]===graph.snapshot[key],'advanced producer manifest hash');
 const manifests=new Map(graph.evidence.source.files.map(f=>[f.relativePath,f])),entities=new Map(graph.evidence.files.flatMap(f=>f.metadata.entities.map(e=>[e.entityId,e] as const))),nodes=new Map(graph.nodes.map(n=>[n.graphNodeId,n]));
 v.check(base.coverage.length===manifests.size&&base.coverage.every(c=>manifests.has(c.relativePath)),'base producer inventory');
 for(const d of base.documents){const ref=manifests.get(d.relativePath)?.artifact;v.check(d.contentHash===(ref?.contentHash??null)&&d.astArtifactId===(ref?.artifactId??null),'base producer source reference');
 if(d.type==='entity'){const e=entities.get(d.metadataEntityId!);v.check(e&&e.relativePath===d.relativePath&&e.kind===d.entityKind&&e.language===d.language&&(e.name??undefined)===d.fields.name&&(e.qualifiedName??undefined)===d.fields.qualifiedName&&e.astNodeId===d.astNodeId&&digest(e.sourceRange)===digest(d.range),'base metadata projection');if(d.graphNodeId)v.check(nodes.get(d.graphNodeId)?.metadataEntityId===e.entityId,'base graph entity identity');}}
 const docs=new Map(base.documents.map(d=>[d.id,d])),asts=new Map(graph.evidence.files.map(f=>[f.ast.relativePath,f.ast]));
 for(const s of index.sources){const file=docs.get(s.fileId),ast=asts.get(s.relativePath);v.check(file?.type==='file'&&file.relativePath===s.relativePath&&file.contentHash===s.contentHash&&file.astArtifactId===s.astArtifactId&&ast?.contentHash===s.contentHash,'advanced source identity');verifyAstSource(ast,s.text);
 for(const p of s.positions)if(p.documentId!==null){const d=docs.get(p.documentId);v.check(d?.type==='source_occurrence'&&d.relativePath===s.relativePath&&d.contentHash===s.contentHash&&d.range?.start.offset===p.start&&d.range.end.offset===p.end&&d.fields.text===s.text.slice(p.start,p.end),'position search document');}}
}
export async function buildAdvancedIndex(base:SearchIndex,graph:GraphDocument,reader:Pick<SourceReader,'read'>,deadline=Date.now()+ADVANCED_LIMITS.maxDurationMs,limits:AdvancedLimits=ADVANCED_LIMITS):Promise<AdvancedIndex>{
 for(const key of Object.keys(ADVANCED_LIMITS) as (keyof AdvancedLimits)[])if(!Number.isSafeInteger(limits[key])||limits[key]<=0||limits[key]>ADVANCED_LIMITS[key])throw new Error('Invalid advanced search limits');
 v.check(base.provenance.graphDocumentHash===digest(graph)&&base.projectId===graph.snapshot.projectId&&base.analysisId===graph.snapshot.analysisId,'advanced graph ownership');
 const sources:AdvancedIndex['sources']=[],coverage:AdvancedIndex['coverage']=[],asts=new Map(graph.evidence.files.map(f=>[f.ast.relativePath,f.ast])),files=base.documents.filter(d=>d.type==='file').sort((a,b)=>compare(a.relativePath,b.relativePath));
 if(files.length>limits.maxFiles)throw new SearchError('SEARCH_RESOURCE_LIMIT',413);
 const docPositions=new Map<string,Map<number,string>>();for(const d of base.documents)if(d.type==='source_occurrence'){const values=docPositions.get(d.relativePath)??new Map<number,string>();values.set(d.range!.start.offset,d.id);docPositions.set(d.relativePath,values);}
 let bytes=0,count=0;
 for(const d of files){checkpoint(deadline);const ast=asts.get(d.relativePath),upstream=graph.evidence.source.files.find(f=>f.relativePath===d.relativePath)!;
 if(!ast||!d.contentHash||!d.astArtifactId){coverage.push({relativePath:d.relativePath,status:upstream.status==='unsupported'?'unsupported':'unavailable',code:'SOURCE_SNAPSHOT_UNAVAILABLE'});continue;}
 const read=await reader.read(base.projectId,{absolutePath:'',relativePath:d.relativePath,extension:path.posix.extname(d.relativePath),language:'JavaScript',linesOfCode:0,isGenerated:false,contentHash:d.contentHash},base.analysisId);
 if(read.status==='read_failed'){coverage.push({relativePath:d.relativePath,status:'unavailable',code:read.code});continue;}
 v.check(read.contentHash===d.contentHash,'advanced source hash');verifyAstSource(ast,read.sourceCode);bytes+=Buffer.byteLength(read.sourceCode);if(bytes>limits.maxSourceBytes)throw new SearchError('SEARCH_RESOURCE_LIMIT',413);
 const recorded=positions(read.sourceCode,docPositions.get(d.relativePath)??new Map());count+=recorded.length;if(count>limits.maxPositions)throw new SearchError('SEARCH_RESOURCE_LIMIT',413);
 sources.push({fileId:d.id,relativePath:d.relativePath,astArtifactId:d.astArtifactId,contentHash:d.contentHash,text:read.sourceCode,positions:recorded});coverage.push({relativePath:d.relativePath,status:'indexed',code:null});await yieldToLoop();
 }
 const body:Omit<AdvancedIndex,'indexId'>={schemaVersion:2,builderVersion:ADVANCED_VERSION,projectId:base.projectId,analysisId:base.analysisId,baseIndexId:base.indexId,baseDocumentHash:digest(base),provenance:{...base.provenance},configuration:{...ADVANCED_CONFIGURATION},coverage,sources,...positionalTables(sources,limits)};
 if(Buffer.byteLength(JSON.stringify(body))>limits.maxBytes-80)throw new SearchError('SEARCH_RESOURCE_LIMIT',413);checkpoint(deadline);const result={...body,indexId:advancedIdentity(body)};matchSnapshots(result,base,graph);return result;
}
