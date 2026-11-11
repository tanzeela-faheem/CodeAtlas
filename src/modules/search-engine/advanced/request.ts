import * as v from '../../../shared/validation.js';
import { NODE_KINDS,EDGE_KINDS } from '../../knowledge-graph/model.js';
import { LIMITS } from '../model.js';
import { parseQuery } from '../query.js';
import { occurrences,queryTerms } from '../normalization.js';
import { ADVANCED_LIMITS,type AdvancedRequest } from './model.js';
import { identity } from './validation.js';
export function parseAdvancedRequest(raw:unknown):AdvancedRequest{
 const o=v.object(raw,'advanced query',['schemaVersion','mode'],['query','match','filters','entity','graph','groupBy','offset','limit','occurrenceLimit']);v.check(o.schemaVersion===2,'advanced schema');v.member(o.mode,['entity','token_phrase','text_phrase','file_lexical'],'advanced mode');
 for(const key of ['match','filters','entity','graph','groupBy','offset','limit','occurrenceLimit'])if(Object.hasOwn(o,key))v.check(o[key]!==null,'null advanced constraint');
 const match=o.match??'lexical';v.member(match,['exact','lexical'],'entity match');if(o.query!==undefined){v.string(o.query,'query',false,LIMITS.maxQuery);v.check(o.query.trim().length>0,'empty query');}
 const standard=parseQuery({schemaVersion:1,query:'validation',mode:'exact',filters:o.filters??{},offset:o.offset??0,limit:o.limit??20});
 const entity=v.object(o.entity??{},'entity',[],['id','name','qualifiedName','parentId','parentMode']);for(const key of ['id','parentId'])if(entity[key]!==undefined)identity(entity[key],'meta');for(const key of ['name','qualifiedName'])if(entity[key]!==undefined)v.string(entity[key],key,false,LIMITS.maxQuery);if(entity.parentMode!==undefined){v.member(entity.parentMode,['direct','descendant'],'parent mode');v.check(entity.parentId!==undefined,'parent ID required');}
 const graph=o.graph??[];v.array(graph,'graph constraints',ADVANCED_LIMITS.maxConstraints);for(const value of graph){const g=v.object(value,'graph constraint',['nodeId','direction','edgeKind'],['neighborKind']);identity(g.nodeId,'gn');v.member(g.direction,['incoming','outgoing'],'graph direction');v.member(g.edgeKind,EDGE_KINDS,'edge kind');if(g.neighborKind!==undefined)v.member(g.neighborKind,NODE_KINDS.filter(k=>k!=='binding'),'searchable neighbor kind');}
 const groupBy=o.groupBy??(o.mode==='entity'?'entity':o.mode==='file_lexical'?'file':'occurrence');v.member(groupBy,['entity','file','occurrence'],'grouping');const occurrenceLimit=o.occurrenceLimit??10;v.integer(occurrenceLimit,'occurrence limit');v.check(occurrenceLimit>=1&&occurrenceLimit<=ADVANCED_LIMITS.maxOccurrences,'occurrence bound');
 if(o.mode==='entity'){
 v.check(groupBy==='entity'&&o.occurrenceLimit===undefined,'entity grouping');v.check(standard.filters.documentKind===undefined||standard.filters.documentKind==='entity','entity record kind');v.check(o.query!==undefined||Object.keys(entity).length>0||graph.length>0||Object.keys(standard.filters).length>0,'entity query needs a constraint');if(o.query!==undefined&&match==='lexical')v.check(queryTerms(String(o.query)).length>0&&queryTerms(String(o.query)).length<=32,'entity query terms');
 }else{
 v.check(o.query!==undefined&&o.match===undefined&&Object.keys(entity).length===0&&graph.length===0,'incompatible source constraints');v.check(standard.filters.entityKind===undefined&&standard.filters.documentKind===undefined,'source record kinds are mode-defined');v.check(groupBy!=='entity'&&(o.mode!=='file_lexical'||groupBy==='file'),'source grouping');const tokens=occurrences(String(o.query));v.check(tokens.length>0&&tokens.length<=32,'source query tokens');if(o.mode==='file_lexical')v.check(queryTerms(String(o.query)).length>0&&queryTerms(String(o.query)).length<=32,'file lexical terms');
 }
 return {schemaVersion:2,mode:o.mode as AdvancedRequest['mode'],query:(o.query as string|undefined)??null,match:match as AdvancedRequest['match'],filters:standard.filters,entity:entity as AdvancedRequest['entity'],graph:graph as AdvancedRequest['graph'],groupBy:groupBy as AdvancedRequest['groupBy'],offset:standard.offset,limit:standard.limit,occurrenceLimit};
}
