import { digest } from '../symbol-resolution/integration/contracts.js';
import { FIELDS,LIMITS,SEARCH_VERSION,SearchError,type SearchDocument,type SearchTables,type Posting,type SearchIndex } from './model.js';
import { terms } from './normalization.js';
export const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
export function documentId(document:Omit<SearchDocument,'id'>):string{return 'sd-'+digest(document);}
export function indexIdentity(index:Omit<SearchIndex,'indexId'|'tables'>):string{return 'si-'+digest(index);}
export function buildTables(documents:SearchDocument[],limits:{[K in keyof typeof LIMITS]:number}=LIMITS):SearchTables {
 if(documents.length>limits.maxDocuments)throw new SearchError('SEARCH_RESOURCE_LIMIT',413);
 const exact=new Map<string,Posting[]>(),lexical=new Map<string,Posting[]>();let count=0;
 const add=(map:Map<string,Posting[]>,key:string,p:Posting)=>{if(++count>limits.maxPostings)throw new SearchError('SEARCH_RESOURCE_LIMIT',413);const values=map.get(key)??[];values.push(p);map.set(key,values);if(map.size>limits.maxTerms)throw new SearchError('SEARCH_RESOURCE_LIMIT',413);};
 const filters={kind:new Map<string,string[]>(),language:new Map<string,string[]>(),path:new Map<string,string[]>(),directory:new Map<string,string[]>(),module:new Map<string,string[]>()};
 const tag=(map:Map<string,string[]>,key:string|null,id:string)=>{if(key===null)return;const values=map.get(key)??[];values.push(id);map.set(key,values);if(++count>limits.maxPostings)throw new SearchError('SEARCH_RESOURCE_LIMIT',413);};
 for(const d of documents){for(const field of FIELDS){const value=d.fields[field];if(!value)continue;add(exact,value,{documentId:d.id,field});for(const term of terms(value))add(lexical,term,{documentId:d.id,field});}
 tag(filters.kind,'document:'+d.type,d.id);if(d.entityKind)tag(filters.kind,'entity:'+d.entityKind,d.id);tag(filters.language,d.language,d.id);tag(filters.path,d.relativePath,d.id);tag(filters.module,d.moduleId,d.id);
 const parts=d.relativePath.split('/');for(let i=1;i<parts.length;i++)tag(filters.directory,parts.slice(0,i).join('/'),d.id);
 }
 const sorted=<T>(map:Map<string,T[]>):[string,T[]][]=>[...map].sort((a,b)=>compare(a[0],b[0]));
 return {exact:sorted(exact),lexical:sorted(lexical),kind:sorted(filters.kind),language:sorted(filters.language),path:sorted(filters.path),directory:sorted(filters.directory),module:sorted(filters.module)};
}
export function assemble(index:Omit<SearchIndex,'indexId'|'tables'>,limits:{[K in keyof typeof LIMITS]:number}=LIMITS):SearchIndex{
 index.documents.sort((a,b)=>compare(a.id,b.id));return {...index,indexId:indexIdentity(index),tables:buildTables(index.documents,limits)};
}
export const CONFIGURATION:SearchIndex['configuration']={tokenization:'unicode-nfc-camel-v1',source:'verified-tokens-v1'};
export {SEARCH_VERSION};
