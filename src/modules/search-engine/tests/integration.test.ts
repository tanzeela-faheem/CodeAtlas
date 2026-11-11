import { it,expect,vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepared,PROJECT,ANALYSIS } from './helpers.js';
import { SearchCoordinator } from '../coordinator.js';
import { FileSearchIndexStore } from '../storage.js';
import { LIMITS } from '../model.js';
import { buildSearchIndex } from '../builder.js';
import { validateIndex } from '../validation.js';
import { digest } from '../../symbol-resolution/integration/contracts.js';
import { parseQuery,retrieve } from '../query.js';
import { buildGraph } from '../../knowledge-graph/core/GraphBuilder.js';
const directory=(s:Awaited<ReturnType<typeof prepared>>)=>path.join(s.f.storage,PROJECT,'analysis',ANALYSIS,'search');
it('builds from persisted graph evidence, preserves producer hashes, determinism and restart/offline retrieval',async()=>{
 const s=await prepared();try{const graph=await s.store.get(PROJECT,ANALYSIS),index=await s.searchCoordinator.build(PROJECT,ANALYSIS);validateIndex(index);expect(index.provenance.graphDocumentHash).toBe(digest(graph));expect(index.coverage.find(c=>c.relativePath==='unsupported.ts')!.source).toBe('unsupported');expect(index.documents.filter(d=>d.type==='file')).toHaveLength(3);expect(index.documents.filter(d=>d.type==='entity')).toHaveLength(graph.nodes.filter(n=>n.metadataEntityId).length);expect(index.status).toBe('partial');expect(index.documents.some(d=>d.type==='source_occurrence')).toBe(true);expect(await buildSearchIndex(graph,s.reader)).toEqual(index);
 s.setOffline();const restart=new FileSearchIndexStore(s.workspaces);expect(await restart.get(PROJECT,ANALYSIS)).toEqual(index);const fresh=new SearchCoordinator(s.store,s.reader,restart);expect(await fresh.build(PROJECT,ANALYSIS)).toEqual(index);expect(s.calls).toEqual({analysis:1,document:2});expect(await s.store.get(PROJECT,ANALYSIS)).toEqual(graph);
 }finally{await s.f.cleanup();}
});
it.each(['changed','missing','symlink'] as const)('records %s source gaps and retains authenticated historical entities',async mode=>{
 const s=await prepared();try{const target=path.join(s.f.storage,PROJECT,'repository','rich.jsx');if(mode==='changed')await fs.writeFile(target,'unverifiedNewToken');else {await fs.unlink(target);if(mode==='symlink')await fs.symlink(path.join(s.f.storage,PROJECT,'repository','same.jsx'),target);}
 const index=await s.searchCoordinator.build(PROJECT,ANALYSIS);expect(index.coverage.find(c=>c.relativePath==='rich.jsx')!.source).toBe('unavailable');expect(index.documents.some(d=>d.relativePath==='rich.jsx'&&d.type==='source_occurrence')).toBe(false);expect(index.documents.some(d=>d.relativePath==='rich.jsx'&&d.type==='entity')).toBe(true);expect(retrieve(index,parseQuery({schemaVersion:1,query:'unverifiedNewToken',mode:'exact'})).total).toBe(0);
 }finally{await s.f.cleanup();}
});
it('cached queries remain historical after source mutation and rebuilding does not overwrite a snapshot',async()=>{
 const s=await prepared();try{const index=await s.searchCoordinator.build(PROJECT,ANALYSIS);await fs.writeFile(path.join(s.f.storage,PROJECT,'repository','rich.jsx'),'changed');expect(await s.searchCoordinator.build(PROJECT,ANALYSIS)).toEqual(index);const revised=await buildSearchIndex(await s.store.get(PROJECT,ANALYSIS),s.reader);expect(revised.indexId).not.toBe(index.indexId);await expect(s.search.publish(revised)).rejects.toMatchObject({code:'SEARCH_INDEX_CONFLICT'});expect(await s.search.get(PROJECT,ANALYSIS)).toEqual(index);
 }finally{await s.f.cleanup();}
});
it('rejects wrong ownership, missing graphs, concurrent builds and bounded deadline failures',async()=>{
 const s=await prepared();try{const graph=await s.store.get(PROJECT,ANALYSIS);const forged={get:async()=>({...graph,snapshot:{...graph.snapshot,projectId:'PRJ-FFFFFF'}}),publish:async()=>{}};await expect(new SearchCoordinator(forged,s.reader,s.search).build(PROJECT,ANALYSIS)).rejects.toThrow();await expect(s.searchCoordinator.build('bad',ANALYSIS)).rejects.toThrow();await expect(s.searchCoordinator.build(PROJECT,'AN-00000000-0000-0000-0000-000000000002')).rejects.toMatchObject({code:'GRAPH_NOT_FOUND'});await expect(buildSearchIndex(graph,s.reader,0)).rejects.toMatchObject({code:'SEARCH_TIME_BUDGET'});
 const first=s.searchCoordinator.build(PROJECT,ANALYSIS);await expect(s.searchCoordinator.build(PROJECT,ANALYSIS)).rejects.toMatchObject({code:'SEARCH_BUSY'});await first;
 }finally{await s.f.cleanup();}
});
it.each(['checksum','postings','version','pointer','missing_artifact'] as const)('rejects corrupt %s without silently replacing it',async kind=>{
 const s=await prepared();try{const index=await s.searchCoordinator.build(PROJECT,ANALYSIS),dir=directory(s),file=path.join(dir,`${index.indexId}.search.json`),pointerFile=path.join(dir,'summary.json');const envelope=JSON.parse(await fs.readFile(file,'utf8')),pointer=JSON.parse(await fs.readFile(pointerFile,'utf8'));
 if(kind==='pointer')await fs.writeFile(pointerFile,'{');else if(kind==='missing_artifact')await fs.unlink(file);else {if(kind==='checksum')envelope.index.documents[0].fields.name='tamper';if(kind==='postings')envelope.index.tables.exact=[];if(kind==='version')envelope.index.builderVersion='future';if(kind==='postings'){envelope.documentHash=digest(envelope.index);pointer.pointer.documentHash=envelope.documentHash;pointer.documentHash=digest(pointer.pointer);await fs.writeFile(pointerFile,JSON.stringify(pointer));}await fs.writeFile(file,JSON.stringify(envelope));}
 await expect(s.search.get(PROJECT,ANALYSIS)).rejects.toMatchObject({code:kind==='version'?'SEARCH_VERSION_INCOMPATIBLE':'SEARCH_STORAGE_CORRUPT'});await expect(s.searchCoordinator.build(PROJECT,ANALYSIS)).rejects.toThrow();
 }finally{await s.f.cleanup();}
});
it('handles empty eligible inventories, unavailable/partial metadata and no source reads without AST evidence',async()=>{
 const s=await prepared();try{const graph=await s.store.get(PROJECT,ANALYSIS),partial=structuredClone(graph);partial.evidence.files=[];partial.nodes=[];const reader={read:vi.fn(s.reader.read.bind(s.reader))};const index=await buildSearchIndex(partial,reader);expect(reader.read).not.toHaveBeenCalled();expect(index.documents.every(d=>d.type==='file')).toBe(true);expect(index.coverage.every(c=>c.metadata==='unavailable')).toBe(true);
 const empty=structuredClone(graph);empty.evidence.source.files=[];empty.evidence.files=[];const built=await buildSearchIndex(empty,reader);expect(built.documents).toEqual([]);expect(built.coverage).toEqual([]);validateIndex(built);
 }finally{await s.f.cleanup();}
});
it('rejects rehashed identity/schema/certainty/range tampering and duplicate document IDs',async()=>{
 const s=await prepared();try{const index=await s.searchCoordinator.build(PROJECT,ANALYSIS);for(const mutate of [(i:typeof index)=>i.documents.push(i.documents[0]!), (i:typeof index)=>{i.documents[0]!.projectId='PRJ-FFFFFF';},(i:typeof index)=>{i.provenance.sourceAnalysisHash='bad';},(i:typeof index)=>{i.documents.find(d=>d.snippet)!.snippet!.matchStart++;}]){const copy=structuredClone(index);mutate(copy);expect(()=>validateIndex(copy)).toThrow();}
 }finally{await s.f.cleanup();}
});
it('atomic publication is idempotent and retry recovers after pointer publication interruption',async()=>{
 const s=await prepared();try{const index=await buildSearchIndex(await s.store.get(PROJECT,ANALYSIS),s.reader),original=fs.link.bind(fs);const mock=vi.spyOn(fs,'link').mockImplementation(async(from,to)=>{if(String(to).endsWith('/search/summary.json'))throw new Error('interrupted');return original(from,to);});try{await expect(s.search.publish(index)).rejects.toThrow('interrupted');}finally{mock.mockRestore();}await expect(s.search.get(PROJECT,ANALYSIS)).rejects.toMatchObject({code:'SEARCH_INDEX_MISSING'});await Promise.all([s.search.publish(index),s.search.publish(index)]);expect(await s.search.get(PROJECT,ANALYSIS)).toEqual(index);expect((await fs.readdir(directory(s))).some(n=>n.endsWith('.tmp'))).toBe(false);
 }finally{await s.f.cleanup();}
});

it('rejects incompatible authenticated producer hashes and conflicts on a different validated graph projection',async()=>{
 const s=await prepared();try{const index=await s.searchCoordinator.build(PROJECT,ANALYSIS),graph=await s.store.get(PROJECT,ANALYSIS),bad=structuredClone(graph);bad.snapshot.metadataAnalysisHash='a'.repeat(64);
 await expect(new SearchCoordinator({get:async()=>bad,publish:async()=>{}},s.reader,s.search).build(PROJECT,ANALYSIS)).rejects.toThrow();
 const input=structuredClone(s.input),removed=input.files.shift()!;input.gaps.push({relativePath:removed.ast.relativePath,stage:'metadata',code:'GRAPH_UPSTREAM_MISSING'});const alternate=buildGraph(input);
 await expect(new SearchCoordinator({get:async()=>alternate,publish:async()=>{}},s.reader,s.search).build(PROJECT,ANALYSIS)).rejects.toMatchObject({code:'SEARCH_SNAPSHOT_CONFLICT'});expect(await s.search.get(PROJECT,ANALYSIS)).toEqual(index);
 }finally{await s.f.cleanup();}
});
it('preserves partial metadata and explicitly records omitted overlong source tokens',async()=>{
 const s=await prepared();try{const graph=await s.store.get(PROJECT,ANALYSIS);graph.evidence.files[0]!.metadata.extractionStatus='partial';const index=await buildSearchIndex(graph,s.reader,Infinity,{...LIMITS,maxToken:3});expect(index.coverage.some(c=>c.metadata==='partial'&&c.codes.includes('METADATA_PARTIAL'))).toBe(true);expect(index.coverage.some(c=>c.codes.includes('SOURCE_LONG_TOKEN_OMITTED'))).toBe(true);expect(index.documents.filter(d=>d.type==='source_occurrence').every(d=>d.fields.text!.length<=3)).toBe(true);expect(index.status).toBe('partial');
 }finally{await s.f.cleanup();}
});
