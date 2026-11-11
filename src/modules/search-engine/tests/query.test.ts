import { it,expect } from 'vitest';
import { occurrences,terms,queryTerms } from '../normalization.js';
import { parseQuery,retrieve } from '../query.js';
import { prepared,PROJECT,ANALYSIS } from './helpers.js';
import { documentId,assemble } from '../indexing.js';
import type { SearchDocument } from '../model.js';
it('normalizes Unicode NFC/case, camel/acronym/snake/path punctuation and repeated terms without changing spans',()=>{
 expect(terms('HTTPServer foo_bar /src/BillingService.js foo_bar')).toEqual(expect.arrayContaining(['httpserver','http','server','foo_bar','foo','bar','billingservice','billing','service','js']));expect(terms('CAFÉ cafe\u0301')).toEqual(['café']);expect(terms('x x x')).toEqual(['x']);expect(queryTerms('HTTPServer foo_bar')).toEqual(['bar','foo','http','server']);expect(terms('a'.repeat(257))).toEqual([]);expect(terms('...')).toEqual([]);expect(occurrences('😀\r\n café')).toEqual([{text:'café',start:5,end:9}]);
});
it.each([{},[],{schemaVersion:2,query:'x',mode:'exact'},{schemaVersion:1,query:' ',mode:'exact'},{schemaVersion:1,query:'x'.repeat(257),mode:'exact'},{schemaVersion:1,query:'.*',mode:'lexical'},{schemaVersion:1,query:'x',mode:'regex'},{schemaVersion:1,query:'x',mode:'exact',filters:{package:'x'}},{schemaVersion:1,query:'x',mode:'exact',filters:{entityKind:'interface'}},{schemaVersion:1,query:'x',mode:'exact',filters:{path:'../secret'}},{schemaVersion:1,query:'x',mode:'exact',filters:{startRow:2}},{schemaVersion:1,query:'x',mode:'exact',limit:101},{schemaVersion:1,query:'x',mode:'exact',offset:-1},{schemaVersion:1,query:'x',mode:'exact',filters:{moduleId:'billing'}},{schemaVersion:1,query:'x',mode:'exact',filters:{path:'a.js',startRow:3,endRow:1}}])('rejects malformed, excessive or unsupported query %j',raw=>{expect(()=>parseQuery(raw)).toThrow();});
it('retrieves exact names separately from occurrences, stable duplicates, filters, navigation and pagination',async()=>{
 const s=await prepared();try{const index=await s.searchCoordinator.build(PROJECT,ANALYSIS);const q=(query:string,mode:'exact'|'lexical'='exact',filters={},offset=0,limit=100)=>retrieve(index,parseQuery({schemaVersion:1,query,mode,filters,offset,limit}));
 const exact=q('target');expect(exact.total).toBeGreaterThan(3);expect(new Set(exact.results.map(r=>r.documentId)).size).toBe(exact.total);expect(exact.results[0]!.matchingField).toBe('name');expect(exact.results[0]!.recordKind).toBe('entity');expect(exact.results[0]!.navigation.graphNodeId).toMatch(/^gn-/);expect(exact.results[0]!.sourceMatchRange).toBeNull();expect(q('TARGET').total).toBe(0);expect(q('TARGET','lexical').total).toBe(exact.total);expect(q('noSuchToken').total).toBe(0);
 const functions=q('target','exact',{entityKind:'function',language:'JavaScript',path:'same.jsx'});expect(functions.total).toBe(2);expect(functions.results.every(r=>r.recordKind==='entity')).toBe(true);const moduleId=functions.results[0]!.navigation.moduleId!;expect(q('target','exact',{moduleId}).results.every(r=>r.location.relativePath==='same.jsx')).toBe(true);
 const first=q('target','exact',{},0,2),second=q('target','exact',{},2,2);expect(first.pagination.nextOffset).toBe(2);expect([...first.results,...second.results].map(r=>r.documentId)).toEqual(exact.results.slice(0,4).map(r=>r.documentId));expect(q('target')).toEqual(exact);expect(q('rich.jsx').results.some(r=>r.recordKind==='file')).toBe(true);expect(q('rich','lexical',{documentKind:'file'}).total).toBe(1);expect(q('target','exact',{path:'rich.jsx',startRow:9}).total).toBe(0);
 const text=q('target','exact',{documentKind:'source_occurrence'});expect(text.results.every(r=>r.snippet!.text.slice(r.snippet!.matchStart,r.snippet!.matchEnd)==='target'&&r.sourceMatchRange!==null)).toBe(true);expect(q('target','exact',{pathPrefix:'other'}).total).toBe(0);
 }finally{await s.f.cleanup();}
});
it('indexes documentation, Unicode, path prefixes, camel/snake matching and retains CRLF/surrogate coordinates',async()=>{
 const s=await prepared();try{const index=await s.searchCoordinator.build(PROJECT,ANALYSIS),template=index.documents.find(d=>d.type==='entity')!;const extra:SearchDocument[]=[];
 const add=(body:Omit<SearchDocument,'id'>)=>extra.push({id:documentId(body),...body});
 const text='😀\r\nconst café = UserController;';
 add({...template,type:'entity',entityKind:'documentation',fields:{text:'The UserController handles billing_records café'},relativePath:'src/a.js'});
 const {id:_,...body}=template;const offset=text.indexOf('café');add({...body,type:'source_occurrence',entityKind:null,metadataEntityId:null,graphNodeId:null,astNodeId:null,symbolId:null,fields:{text:'café'},relativePath:'src/a.js',range:{start:{offset,row:1,column:6},end:{offset:offset+4,row:1,column:10}},snippet:{text,startOffset:0,matchStart:offset,matchEnd:offset+4}});
 const combined=assemble({...index,documents:extra});const q=(query:string,filters={})=>retrieve(combined,parseQuery({schemaVersion:1,query,mode:'lexical',filters}));
 expect(q('user_controller',{entityKind:'documentation',pathPrefix:'src'}).total).toBe(1);expect(q('billing records').total).toBe(1);const unicode=q('CAFE\u0301',{documentKind:'source_occurrence',path:'src/a.js',startRow:1,endRow:1});expect(unicode.total).toBe(1);expect(unicode.results[0]!.sourceMatchRange!.start).toEqual({offset:10,row:1,column:6});expect(q('café',{startRow:1,path:'src/a.js'}).total).toBe(1);
 }finally{await s.f.cleanup();}
});

it('handles prototype-like names and untrusted markup as inert indexed values',async()=>{
 const s=await prepared();try{const index=await s.searchCoordinator.build(PROJECT,ANALYSIS),{id:_,...template}=index.documents.find(d=>d.type==='entity')!;
 for(const value of ['__proto__','constructor','<script>alert(1)</script>']){const body={...template,fields:{name:value}},d={...body,id:documentId(body)},copy=assemble({...index,documents:[d]});const result=retrieve(copy,parseQuery({schemaVersion:1,query:value,mode:'exact'}));expect(result.total).toBe(1);expect(result.results[0]!.label).toBe(value);}
 }finally{await s.f.cleanup();}
});
