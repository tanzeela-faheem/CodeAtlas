import path from 'node:path';
import { setImmediate as yieldToLoop } from 'node:timers/promises';
import type { GraphDocument } from '../knowledge-graph/model.js';
import type { SourceReader } from '../analysis/source-reader.js';
import type { SourcePoint } from '../ast-management/model.js';
import { verifyAstSource } from '../ast-management/serializer.js';
import { digest } from '../symbol-resolution/integration/contracts.js';
import { LIMITS,SEARCH_VERSION,SearchError,checkpoint,type SearchIndex,type SearchDocument,type Coverage } from './model.js';
import { occurrences } from './normalization.js';
import { assemble,documentId,CONFIGURATION,compare } from './indexing.js';
/** Build only from the graph's validated, retained producer projection and snapshot-verified reads. */
export async function buildSearchIndex(graph:GraphDocument,reader:Pick<SourceReader,'read'>,deadline=Date.now()+LIMITS.maxDurationMs,limits:{[K in keyof typeof LIMITS]:number}=LIMITS):Promise<SearchIndex>{
 for(const key of Object.keys(LIMITS) as (keyof typeof LIMITS)[])if(!Number.isSafeInteger(limits[key])||limits[key]<=0||limits[key]>LIMITS[key])throw new Error('Invalid search limits');
 const s=graph.snapshot,documents:SearchDocument[]=[],coverage:Coverage[]=[];let sourceBytes=0,documentBytes=0;
 if(graph.evidence.source.files.length>limits.maxFiles)throw new SearchError('SEARCH_RESOURCE_LIMIT',413);
 const add=(d:Omit<SearchDocument,'id'>)=>{if(documents.length>=limits.maxDocuments)throw new SearchError('SEARCH_RESOURCE_LIMIT',413);const doc={id:documentId(d),...d};documentBytes+=Buffer.byteLength(JSON.stringify(doc));if(documentBytes>limits.maxBytes)throw new SearchError('SEARCH_RESOURCE_LIMIT',413);documents.push(doc);};
 const files=new Map(graph.evidence.files.map(f=>[f.ast.relativePath,f])),nodes=new Map(graph.nodes.filter(n=>n.metadataEntityId).map(n=>[n.metadataEntityId!,n]));
 for(const outcome of [...graph.evidence.source.files].sort((a,b)=>compare(a.relativePath,b.relativePath))){
 checkpoint(deadline);const relativePath=outcome.relativePath,file=files.get(relativePath),ref=outcome.artifact;
 const module=file?.metadata.entities.find(e=>e.kind==='module'&&e.parentEntityId===null);
 const base={projectId:s.projectId,analysisId:s.analysisId,relativePath,language:file?.ast.language??null,range:null,entityKind:null,metadataEntityId:null,astArtifactId:ref?.artifactId??null,astNodeId:null,symbolId:null,graphNodeId:null,moduleId:module?.entityId??null,contentHash:ref?.contentHash??null,snippet:null,limitations:[] } satisfies Omit<SearchDocument,'id'|'type'|'fields'>;
 const c:Coverage={relativePath,source:outcome.status==='unsupported'?'unsupported':'unavailable',metadata:file?.metadata.extractionStatus??'unavailable',codes:[]};
 if(!file)c.codes.push('METADATA_UNAVAILABLE');if(file?.metadata.extractionStatus==='partial')c.codes.push('METADATA_PARTIAL');
 add({...base,type:'file',fields:{path:relativePath,name:path.posix.basename(relativePath),...(module?{module:module.entityId}:{})},limitations:['File inventory record; content availability is reported separately.']});
 if(file){const astNodes=new Map(file.ast.nodes.map(n=>[n.id,n])),symbols=new Map(file.resolution?.symbols.flatMap(s=>s.declarations.filter(d=>d.metadataEntityId).map(d=>[d.metadataEntityId!,s.id] as const))??[]);
 for(const entity of file.metadata.entities){checkpoint(deadline);const node=nodes.get(entity.entityId),syntax=astNodes.get(entity.astNodeId);
 const comment=['comment','documentation'].includes(entity.kind)&&typeof syntax?.text==='string'?syntax.text:null;
 add({...base,type:'entity',entityKind:entity.kind,range:entity.sourceRange,metadataEntityId:entity.entityId,astNodeId:entity.astNodeId,graphNodeId:node?.graphNodeId??null,symbolId:node?.symbolId??symbols.get(entity.entityId)??null,
 fields:{path:relativePath,...(entity.name?{name:entity.name}:{}),...(entity.qualifiedName?{qualifiedName:entity.qualifiedName}:{}),...(comment?{text:comment}:{}),...(module?{module:module.entityId}:{})},limitations:['Syntactic metadata entity; range navigates to the entity, not necessarily its name.',...(comment?['Comment text retained by the indexed AST snapshot.']:[])]});
 }}
 if(!ref)c.codes.push('SOURCE_SNAPSHOT_UNAVAILABLE');else if(!file)c.codes.push('SOURCE_AST_EVIDENCE_UNAVAILABLE');else{
 const read=await reader.read(s.projectId,{absolutePath:'',relativePath,extension:path.posix.extname(relativePath),language:'JavaScript',linesOfCode:0,isGenerated:false,contentHash:ref.contentHash},s.analysisId);
 if(read.status==='read_failed')c.codes.push(read.code);else{
 if(read.contentHash!==ref.contentHash||file.ast.contentHash!==ref.contentHash)throw new SearchError('SEARCH_INPUT_INCOMPATIBLE');
 verifyAstSource(file.ast,read.sourceCode);sourceBytes+=Buffer.byteLength(read.sourceCode);if(sourceBytes>limits.maxSourceBytes)throw new SearchError('SEARCH_RESOURCE_LIMIT',413);
 const source=read.sourceCode;let cursor=0,row=0,column=0;
 const point=(offset:number):SourcePoint=>{while(cursor<offset){if(source[cursor++]==='\n'){row++;column=0;}else column++;}return {offset,row,column};};
 for(const token of occurrences(source)){checkpoint(deadline);const start=point(token.start),end=point(token.end);
 if(token.text.length>limits.maxToken){if(!c.codes.includes('SOURCE_LONG_TOKEN_OMITTED'))c.codes.push('SOURCE_LONG_TOKEN_OMITTED');continue;}
 let left=Math.max(0,token.start-60),right=Math.min(source.length,token.end+60);if(left>0&&/[\uDC00-\uDFFF]/.test(source[left]!))left--;if(right<source.length&&/[\uDC00-\uDFFF]/.test(source[right]!))right++;
 add({...base,type:'source_occurrence',range:{start,end},fields:{text:token.text},snippet:{text:source.slice(left,right),startOffset:left,matchStart:token.start-left,matchEnd:token.end-left},limitations:['Text occurrence; does not establish a declaration or relationship.','Historical indexed snippet; current source must be verified separately.']});
 }
 c.source='indexed';
 }}
 coverage.push(c);await yieldToLoop();
 }
 checkpoint(deadline);
 const index=assemble({schemaVersion:1,builderVersion:SEARCH_VERSION,projectId:s.projectId,analysisId:s.analysisId,provenance:{graphSnapshotId:s.snapshotId,graphDocumentHash:digest(graph),sourceAnalysisHash:s.sourceAnalysisHash,metadataAnalysisHash:s.metadataAnalysisHash,resolutionAnalysisHash:s.resolutionAnalysisHash,relationshipAnalysisHash:s.relationshipAnalysisHash},configuration:{...CONFIGURATION},status:coverage.every(c=>c.source==='indexed'&&c.metadata==='complete'&&c.codes.length===0)?'complete':'partial',coverage,documents,diagnostics:['Search absence applies only to indexed coverage.','No cross-file semantic inference, API classification or configuration interpretation.','moduleId identifies the producer metadata module, not a package or directory.']},limits);
 if(Buffer.byteLength(JSON.stringify(index))>limits.maxBytes)throw new SearchError('SEARCH_RESOURCE_LIMIT',413);checkpoint(deadline);return index;
}
