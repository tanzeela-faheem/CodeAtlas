import * as v from '../../shared/validation.js';
import { NODE_KINDS } from '../knowledge-graph/model.js';
import { LIMITS,SearchError,type SearchRequest,type SearchIndex,type Field,type Posting } from './model.js';
import { queryTerms } from './normalization.js';
import { compare } from './indexing.js';
export function parseQuery(raw:unknown):SearchRequest{
 const o=v.object(raw,'search query',['schemaVersion','query','mode'],['filters','offset','limit']);v.check(o.schemaVersion===1,'search schema');v.string(o.query,'query',false,LIMITS.maxQuery);v.check(o.query.trim().length>0,'empty query');v.member(o.mode,['exact','lexical'],'mode');
 const filters=v.object(o.filters??{},'filters',[],['documentKind','entityKind','language','path','pathPrefix','moduleId','startRow','endRow']);
 if(filters.documentKind!==undefined)v.member(filters.documentKind,['file','entity','source_occurrence'],'document kind');
 if(filters.entityKind!==undefined)v.member(filters.entityKind,NODE_KINDS.filter(k=>k!=='binding'),'entity kind');
 if(filters.language!==undefined)v.member(filters.language,['JavaScript','TypeScript','Python','Java','C','C++','C#','Go','Rust','PHP','Ruby','Kotlin','Swift','Dart','Scala','SQL','HTML','CSS','Shell','PowerShell','R','Lua','Perl','Objective-C','MATLAB','Solidity','Elixir','Haskell','Other'],'language');
 for(const key of ['path','pathPrefix'])if(filters[key]!==undefined)v.sourcePath(filters[key]);
 if(filters.moduleId!==undefined){v.string(filters.moduleId,'module ID');v.check(/^meta-[a-f0-9]{64}$/.test(filters.moduleId),'module ID');}
 for(const key of ['startRow','endRow'])if(filters[key]!==undefined){v.integer(filters[key],'row');v.check(filters[key]<=10000000,'row limit');v.check(typeof filters.path==='string','location requires exact path');}
 v.check(filters.startRow===undefined||filters.endRow===undefined||Number(filters.startRow)<=Number(filters.endRow),'row order');
 const offset=o.offset??0,limit=o.limit??20;v.integer(offset,'offset');v.integer(limit,'limit');v.check(offset<=LIMITS.maxDocuments&&limit>=1&&limit<=100,'pagination bounds');
 if(o.mode==='lexical')v.check(queryTerms(o.query).length>0&&queryTerms(o.query).length<=32,'lexical query terms');
 return {schemaVersion:1,query:o.query,mode:o.mode as SearchRequest['mode'],filters:filters as SearchRequest['filters'],offset,limit};
}
const weights:Record<Field,number>={name:100,qualifiedName:90,module:80,path:50,text:10};
/** All normalized query terms must occur in a record; exact mode matches entire original field values. */
export function retrieve(index:SearchIndex,q:SearchRequest){
 const table=new Map(q.mode==='exact'?index.tables.exact:index.tables.lexical),keys=q.mode==='exact'?[q.query]:queryTerms(q.query);
 let candidates:Map<string,Set<Field>>|undefined;
 for(const key of keys){const found=new Map<string,Set<Field>>();for(const p of table.get(key)??[]){const fields=found.get(p.documentId)??new Set<Field>();fields.add(p.field);found.set(p.documentId,fields);}
 if(!candidates)candidates=found;else for(const [id,fields] of candidates){const next=found.get(id);if(!next)candidates.delete(id);else for(const field of next)fields.add(field);}
 }
 const c=candidates??new Map<string,Set<Field>>(),f=q.filters;
 const apply=(table:[string,string[]][],key:string|undefined)=>{if(key===undefined)return;const ids=new Set(new Map(table).get(key)??[]);for(const id of c.keys())if(!ids.has(id))c.delete(id);};
 apply(index.tables.kind,f.documentKind?'document:'+f.documentKind:undefined);apply(index.tables.kind,f.entityKind?'entity:'+f.entityKind:undefined);apply(index.tables.language,f.language);apply(index.tables.path,f.path);apply(index.tables.directory,f.pathPrefix);apply(index.tables.module,f.moduleId);
 const documents=new Map(index.documents.map(d=>[d.id,d]));
 const ranked=[...c].flatMap(([id,fields])=>{const d=documents.get(id)!;if(f.startRow!==undefined&&(!d.range||d.range.end.row<f.startRow))return [];if(f.endRow!==undefined&&(!d.range||d.range.start.row>f.endRow))return [];
 const matchingFields=[...fields].sort((a,b)=>weights[b]-weights[a]||compare(a,b)),field=matchingFields[0]!;
 const exactName=d.fields.name===q.query,exactQualified=d.fields.qualifiedName===q.query,score=(exactName?1000:exactQualified?900:0)+weights[field];
 return [{document:d,matchingFields,field,score}];}).sort((a,b)=>b.score-a.score||compare(a.document.relativePath,b.document.relativePath)||(a.document.range?.start.offset??-1)-(b.document.range?.start.offset??-1)||compare(a.document.id,b.document.id));
 const results=ranked.slice(q.offset,q.offset+q.limit).map(({document:d,matchingFields,field,score},i)=>({documentId:d.id,recordKind:d.type,entityKind:d.entityKind,label:d.fields.name??d.fields.text?.slice(0,160)??d.relativePath,matchingField:field,matchingFields,classification:q.mode==='exact'?'exact_field':'lexical_terms',ranking:{score,position:q.offset+i,reason:d.fields.name===q.query?'Exact name':d.fields.qualifiedName===q.query?'Exact qualified name':`${q.mode} match in ${matchingFields.join(', ')}`},location:{relativePath:d.relativePath,language:d.language,range:d.range,coordinates:'utf16-code-units; zero-based rows/columns; end-exclusive'},sourceMatchRange:d.type==='source_occurrence'?d.range:null,navigation:{metadataEntityId:d.metadataEntityId,astArtifactId:d.astArtifactId,astNodeId:d.astNodeId,symbolId:d.symbolId,graphNodeId:d.graphNodeId,moduleId:d.moduleId},contentHash:d.contentHash,snippet:d.snippet,snippetIdentity:d.snippet?'indexed_historical_snapshot':null,limitations:d.limitations}));
 const response={schemaVersion:1,indexId:index.indexId,projectId:index.projectId,analysisId:index.analysisId,query:q.query,mode:q.mode,filters:q.filters,total:ranked.length,results,pagination:{offset:q.offset,limit:q.limit,nextOffset:q.offset+results.length<ranked.length?q.offset+results.length:null},coverage:{status:index.status,files:index.coverage},diagnostics:index.diagnostics};
 if(Buffer.byteLength(JSON.stringify(response))>LIMITS.maxResponseBytes)throw new SearchError('SEARCH_RESPONSE_LIMIT',413);return response;
}
