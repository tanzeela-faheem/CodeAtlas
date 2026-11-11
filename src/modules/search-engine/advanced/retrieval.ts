import { digest } from '../../symbol-resolution/integration/contracts.js';
import type { MetadataEntity, Range } from '../../symbol-resolution/model.js';
import type { GraphDocument, GraphEdge } from '../../knowledge-graph/model.js';
import { GraphIndex } from '../../knowledge-graph/core/GraphIndex.js';
import { LIMITS,SearchError,type SearchDocument,type SearchIndex } from '../model.js';
import { compare } from '../indexing.js';
import { occurrences,queryTerms } from '../normalization.js';
import { ADVANCED_LIMITS,type AdvancedIndex,type AdvancedRequest,type HistoricalSource } from './model.js';
import { lineStarts,sourceRange,snippet,tokenKey } from './positions.js';

function intersect<T>(left:Set<T>,right:Set<T>){for(const item of left)if(!right.has(item))left.delete(item);return left;}
/** Filters first use Phase 1 posting tables; location filtering applies to the actual returned span. */
function filteredDocuments(base:SearchIndex,q:AdvancedRequest,kind:'file'|'entity'){
 const ids=new Set(new Map(base.tables.kind).get('document:'+kind)??[]),f=q.filters;
 const apply=(table:[string,string[]][],key:string|undefined)=>{if(key!==undefined)intersect(ids,new Set(new Map(table).get(key)??[]));};
 apply(base.tables.kind,f.entityKind?'entity:'+f.entityKind:undefined);apply(base.tables.path,f.path);apply(base.tables.directory,f.pathPrefix);apply(base.tables.language,f.language);apply(base.tables.module,f.moduleId);return ids;
}
function inRows(range:Range|null,q:AdvancedRequest){return (q.filters.startRow===undefined||!!range&&range.end.row>=q.filters.startRow)&&(q.filters.endRow===undefined||!!range&&range.start.row<=q.filters.endRow);}
function navigation(d:SearchDocument){return {metadataEntityId:d.metadataEntityId,astArtifactId:d.astArtifactId,astNodeId:d.astNodeId,symbolId:d.symbolId,graphNodeId:d.graphNodeId,moduleId:d.moduleId};}
function entityMatches(base:SearchIndex,graph:GraphDocument,q:AdvancedRequest){
 const docs=new Map(base.documents.map(d=>[d.id,d])),byEntity=new Map(base.documents.filter(d=>d.metadataEntityId).map(d=>[d.metadataEntityId!,d])),entities=new Map<string,MetadataEntity>(),children=new Map<string,string[]>();
 for(const file of graph.evidence.files)for(const e of file.metadata.entities){entities.set(e.entityId,e);if(e.parentEntityId){const list=children.get(e.parentEntityId)??[];list.push(e.entityId);children.set(e.parentEntityId,list);}}
 const ids=filteredDocuments(base,q,'entity');
 const exact=(value:string,field:'name'|'qualifiedName')=>intersect(ids,new Set((new Map(base.tables.exact).get(value)??[]).filter(p=>p.field===field).map(p=>p.documentId)));
 if(q.query!==null){if(q.match==='exact')exact(q.query,'name');else for(const term of queryTerms(q.query))intersect(ids,new Set((new Map(base.tables.lexical).get(term)??[]).filter(p=>p.field==='name').map(p=>p.documentId)));}
 if(q.entity.name!==undefined)exact(q.entity.name,'name');if(q.entity.qualifiedName!==undefined)exact(q.entity.qualifiedName,'qualifiedName');
 if(q.entity.id!==undefined){const d=byEntity.get(q.entity.id);if(!d)throw new SearchError('SEARCH_ENTITY_NOT_FOUND',404);intersect(ids,new Set([d.id]));}
 if(q.entity.parentId!==undefined){if(!entities.has(q.entity.parentId))throw new SearchError('SEARCH_PARENT_NOT_FOUND',404);const selected=new Set(children.get(q.entity.parentId)??[]);
 if(q.entity.parentMode==='descendant'){const queue=[...selected];for(let i=0;i<queue.length;i++)for(const child of children.get(queue[i]!)??[]){if(selected.has(child))throw new SearchError('SEARCH_INPUT_INCOMPATIBLE');selected.add(child);queue.push(child);if(queue.length>20000)throw new SearchError('SEARCH_RESOURCE_LIMIT',413);}}
 intersect(ids,new Set([...selected].flatMap(id=>{const d=byEntity.get(id);return d?[d.id]:[];})));}
 const graphIndex=q.graph.length?new GraphIndex(graph):null,evidence:Map<string,GraphEdge[]>[]=[];
 for(const constraint of q.graph){if(!graphIndex!.node(constraint.nodeId))throw new SearchError('SEARCH_GRAPH_NODE_NOT_FOUND',404);const matches=new Map<string,GraphEdge[]>();
 for(const edge of graphIndex!.connected(constraint.nodeId,constraint.direction,[constraint.edgeKind])){
 const neighbor=constraint.direction==='incoming'?edge.sourceGraphNodeId:edge.targetGraphNodeId,node=graphIndex!.node(neighbor)!;
 if(constraint.neighborKind!==undefined&&node.nodeKind!==constraint.neighborKind)continue;const document=node.metadataEntityId?byEntity.get(node.metadataEntityId):undefined;if(!document)continue;
 const list=matches.get(document.id)??[];list.push(edge);matches.set(document.id,list);
 }
 intersect(ids,new Set(matches.keys()));evidence.push(matches);
 }
 return [...ids].flatMap(id=>{const d=docs.get(id)!;if(!inRows(d.range,q))return [];const e=entities.get(d.metadataEntityId!)!;
 const edges=[...new Map(evidence.flatMap(map=>(map.get(id)??[]).map(edge=>[edge.graphEdgeId,edge] as const))).values()].sort((a,b)=>compare(a.graphEdgeId,b.graphEdgeId));
 const score=q.entity.id?1200:q.query!==null&&d.fields.name===q.query?1100:q.query!==null&&d.fields.qualifiedName===q.query?1000:q.query!==null?100:0;
 return [{id:d.id,path:d.relativePath,start:d.range?.start.offset??0,score,result:{documentId:d.id,recordKind:'entity',label:(d.fields.name??d.fields.qualifiedName??d.relativePath).slice(0,256),entityKind:d.entityKind,location:{relativePath:d.relativePath,range:d.range,language:d.language},navigation:navigation(d),contentHash:d.contentHash,classification:'verified_structural_constraints',constraintsSatisfied:{entity:q.entity,filters:q.filters,nameQuery:q.query,match:q.match,graph:q.graph},producerFields:{entityId:e.entityId,kind:e.kind,name:e.name,qualifiedName:e.qualifiedName,parentEntityId:e.parentEntityId},supportingEdges:edges.slice(0,ADVANCED_LIMITS.maxEvidence).map(edge=>({graphEdgeId:edge.graphEdgeId,sourceGraphNodeId:edge.sourceGraphNodeId,targetGraphNodeId:edge.targetGraphNodeId,edgeKind:edge.edgeKind,guarantee:edge.guarantee,relationshipId:edge.relationshipId,relativePath:edge.relativePath,range:edge.range,limitations:edge.limitations})),supportingEdgeCount:edges.length,edgesTruncated:edges.length>ADVANCED_LIMITS.maxEvidence,rankingReason:q.entity.id?'Exact metadata identity':q.query!==null?'Name match plus all explicit constraints':'All explicit structural/graph constraints',limitations:d.limitations}}];
 });
}
interface Match {source:HistoricalSource;start:number;end:number;position:number;endPosition:number}
function sourceMatches(index:AdvancedIndex,base:SearchIndex,q:AdvancedRequest):Match[]{
 const eligible=filteredDocuments(base,q,'file'),sources=new Map(index.sources.map(s=>[s.fileId,s])),matches:Match[]=[];
 if(q.mode==='file_lexical'){
 const table=new Map(index.lexical),keys=queryTerms(q.query!),perTerm=keys.map(key=>{const map=new Map<string,number[]>();for(const ref of table.get(key)??[]){if(!eligible.has(ref.fileId))continue;const list=map.get(ref.fileId)??[];list.push(ref.position);map.set(ref.fileId,list);}return map;});
 const files=new Set(perTerm[0]?.keys()??[]);for(const map of perTerm.slice(1))intersect(files,new Set(map.keys()));
 for(const id of files){const s=sources.get(id)!;for(const pos of new Set(perTerm.flatMap(map=>map.get(id)??[]))){const p=s.positions[pos]!;matches.push({source:s,start:p.start,end:p.end,position:pos,endPosition:pos});}}
 }else{
 const tokens=occurrences(q.query!),table=new Map(index.tokens);
 if(q.mode==='token_phrase'){
 const keys=tokens.map(t=>tokenKey(t.text));let anchor=0;for(let i=1;i<keys.length;i++)if((table.get(keys[i]!)?.length??0)<(table.get(keys[anchor]!)?.length??0))anchor=i;
 for(const ref of table.get(keys[anchor]!)??[]){if(!eligible.has(ref.fileId))continue;const s=sources.get(ref.fileId)!,start=ref.position-anchor,end=start+keys.length-1;if(start<0||end>=s.positions.length||!keys.every((key,i)=>s.positions[start+i]!.term===key))continue;matches.push({source:s,start:s.positions[start]!.start,end:s.positions[end]!.end,position:start,endPosition:end});}
 }else{
 let anchor=tokens[0]!;for(const token of tokens)if(token.text.length>anchor.text.length)anchor=token;
 for(const ref of table.get(tokenKey(anchor.text))??[]){if(!eligible.has(ref.fileId))continue;const s=sources.get(ref.fileId)!,start=s.positions[ref.position]!.start-anchor.start,end=start+q.query!.length;
 if(start>=0&&s.text.slice(start,end)===q.query)matches.push({source:s,start,end,position:ref.position,endPosition:ref.position});}
 }
 }
 const starts=new Map<string,number[]>();const lines=(s:HistoricalSource)=>{let list=starts.get(s.fileId);if(!list){list=lineStarts(s.text);starts.set(s.fileId,list);}return list;};
 const filtered=matches.filter(m=>inRows(sourceRange(lines(m.source),m.start,m.end),q));
 if(q.mode==='file_lexical'&&(q.filters.startRow!==undefined||q.filters.endRow!==undefined)){
 // Row-scoped AND must be satisfied by the retained occurrences, not by discarded terms outside the interval.
 const wanted=queryTerms(q.query!),available=new Map<string,Set<string>>();for(const m of filtered){const found=available.get(m.source.fileId)??new Set<string>();for(const t of queryTerms(m.source.text.slice(m.start,m.end)))found.add(t);available.set(m.source.fileId,found);}return filtered.filter(m=>wanted.every(term=>available.get(m.source.fileId)!.has(term)));
 }
 return filtered;
}
function sourceResults(index:AdvancedIndex,base:SearchIndex,q:AdvancedRequest){
 const docs=new Map(base.documents.map(d=>[d.id,d])),starts=new Map<string,number[]>(),matches=sourceMatches(index,base,q).sort((a,b)=>compare(a.source.relativePath,b.source.relativePath)||a.start-b.start||a.end-b.end);
 const lines=(s:HistoricalSource)=>{let list=starts.get(s.fileId);if(!list){list=lineStarts(s.text);starts.set(s.fileId,list);}return list;};
 const occurrence=(m:Match)=>({occurrenceId:'sm-'+digest([index.indexId,q.mode,m.source.fileId,m.start,m.end]),sourceDocumentIds:[...new Set([m.source.positions[m.position]?.documentId,m.source.positions[m.endPosition]?.documentId].filter((id):id is string=>!!id))],range:sourceRange(lines(m.source),m.start,m.end),snippet:snippet(m.source.text,m.start,m.end)});
 const groups:Match[][]=q.groupBy==='file'?[...matches.reduce((map,m)=>{const values=map.get(m.source.fileId)??[];values.push(m);map.set(m.source.fileId,values);return map;},new Map<string,Match[]>()).values()]:matches.map(m=>[m]);
 return groups.map(group=>{const first=group[0]!,d=docs.get(first.source.fileId)!,id=q.groupBy==='file'?d.id:'sm-'+digest([index.indexId,q.mode,d.id,first.start,first.end]);return {id,path:d.relativePath,start:first.start,score:q.groupBy==='file'?group.length:1,result:{documentId:d.id,matchId:id,recordKind:q.groupBy==='file'?'source_file':'source_phrase',label:d.relativePath,location:{relativePath:d.relativePath,range:q.groupBy==='file'?null:sourceRange(lines(first.source),first.start,first.end),language:d.language},navigation:{...navigation(d),astArtifactId:first.source.astArtifactId},contentHash:first.source.contentHash,classification:q.mode,occurrenceCount:group.length,occurrences:group.slice(0,q.occurrenceLimit).map(occurrence),occurrencesTruncated:group.length>q.occurrenceLimit,rankingReason:q.groupBy==='file'?'Descending count of distinct matching occurrences, then path/offset/identity':'Recorded source position order',limitations:[q.mode==='token_phrase'?'Consecutive whole identifier tokens; punctuation/whitespace do not impose character adjacency.':q.mode==='text_phrase'?'Exact retained text with the longest query token aligned to a whole source token.':'All lexical terms occur in the same file/selected row interval; no adjacency implied.','Historical indexed source; current bytes require separate source verification.']}};});
}
export function retrieveAdvanced(index:AdvancedIndex,base:SearchIndex,graph:GraphDocument,q:AdvancedRequest){
 const ranked=(q.mode==='entity'?entityMatches(base,graph,q):sourceResults(index,base,q)).sort((a,b)=>b.score-a.score||compare(a.path,b.path)||a.start-b.start||compare(a.id,b.id));
 const results=ranked.slice(q.offset,q.offset+q.limit).map((item,i)=>({...item.result,projectId:index.projectId,analysisId:index.analysisId,indexId:index.indexId,ranking:{score:item.score,position:q.offset+i}}));
 const response={schemaVersion:2,projectId:index.projectId,analysisId:index.analysisId,indexId:index.indexId,baseIndexId:base.indexId,query:q,total:ranked.length,results,pagination:{offset:q.offset,limit:q.limit,nextOffset:q.offset+results.length<ranked.length?q.offset+results.length:null},coverage:{source:index.coverage,phase1:base.coverage,graph:graph.snapshot.coverage,evidence:graph.snapshot.evidenceCoverage},provenance:index.provenance,diagnostics:['Absence applies only to indexed evidence.','Untyped metadata attributes/modifiers are unsupported.','Only metadata entities are returned by entity mode; AST-only graph binding nodes remain navigation anchors.','Parallel established edges retain their distinct identities; bounded previews report truncation.']};
 if(Buffer.byteLength(JSON.stringify(response))>LIMITS.maxResponseBytes)throw new SearchError('SEARCH_RESPONSE_LIMIT',413);return response;
}
