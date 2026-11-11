import { it,expect,vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { advancedPrepared,PROJECT,ANALYSIS } from './advanced-helpers.js';
import { buildAdvancedIndex,matchSnapshots } from '../advanced/builder.js';
import { FileAdvancedIndexStore } from '../advanced/storage.js';
import { AdvancedSearchCoordinator } from '../advanced/coordinator.js';
import { ADVANCED_LIMITS } from '../advanced/model.js';
import { validateAdvanced } from '../advanced/validation.js';
import { digest } from '../../symbol-resolution/integration/contracts.js';
const directory=(s:Awaited<ReturnType<typeof advancedPrepared>>)=>path.join(s.f.storage,PROJECT,'analysis',ANALYSIS,'search');
it('preserves old artifacts byte-for-byte, builds deterministically and retrieves offline after reconstruction',async()=>{
 const s=await advancedPrepared();try{const base=await s.searchCoordinator.build(PROJECT,ANALYSIS),before=await fs.readFile(path.join(directory(s),'summary.json'),'utf8');await expect(s.advancedStore.get(PROJECT,ANALYSIS)).rejects.toMatchObject({code:'SEARCH_V2_INDEX_MISSING'});const result=await s.advanced.build(PROJECT,ANALYSIS),graph=await s.store.get(PROJECT,ANALYSIS);validateAdvanced(result);expect(await buildAdvancedIndex(base,graph,s.reader)).toEqual(result);expect(await fs.readFile(path.join(directory(s),'summary.json'),'utf8')).toBe(before);expect(await s.search.get(PROJECT,ANALYSIS)).toEqual(base);
 s.setOffline();const restarted=new AdvancedSearchCoordinator(s.store,s.search,new FileAdvancedIndexStore(s.workspaces),s.reader,s.searchCoordinator);expect((await restarted.load(PROJECT,ANALYSIS)).index).toEqual(result);expect(await restarted.build(PROJECT,ANALYSIS)).toEqual(result);
 }finally{await s.f.cleanup();}
});
it.each(['changed','missing','symlink'] as const)('records %s source as a Phase 2 gap while old retrieval stays usable',async mode=>{
 const s=await advancedPrepared();try{const base=await s.searchCoordinator.build(PROJECT,ANALYSIS),file=path.join(s.f.storage,PROJECT,'repository','rich.jsx');if(mode==='changed')await fs.writeFile(file,'unverifiedCurrent');else {await fs.unlink(file);if(mode==='symlink')await fs.symlink(path.join(s.f.storage,PROJECT,'repository','same.jsx'),file);}const result=await s.advanced.build(PROJECT,ANALYSIS);expect(result.coverage.find(c=>c.relativePath==='rich.jsx')!.status).toBe('unavailable');expect(result.sources.some(f=>f.relativePath==='rich.jsx')).toBe(false);expect(result.coverage.find(c=>c.relativePath==='unsupported.ts')!.status).toBe('unsupported');expect(await s.search.get(PROJECT,ANALYSIS)).toEqual(base);
 }finally{await s.f.cleanup();}
});
it('enforces positional source/posting/term/byte/file budgets, deadline and build concurrency',async()=>{
 const s=await advancedPrepared();try{const base=await s.searchCoordinator.build(PROJECT,ANALYSIS),graph=await s.store.get(PROJECT,ANALYSIS);for(const policy of [{maxPositions:1},{maxTerms:1},{maxPostings:1},{maxSourceBytes:1},{maxBytes:1},{maxFiles:1}])await expect(buildAdvancedIndex(base,graph,s.reader,Infinity,{...ADVANCED_LIMITS,...policy})).rejects.toMatchObject({code:'SEARCH_RESOURCE_LIMIT'});await expect(buildAdvancedIndex(base,graph,s.reader,0)).rejects.toMatchObject({code:'SEARCH_TIME_BUDGET'});const first=s.advanced.build(PROJECT,ANALYSIS);await expect(s.advanced.build(PROJECT,ANALYSIS)).rejects.toMatchObject({code:'SEARCH_BUSY'});await first;
 }finally{await s.f.cleanup();}
});
it.each(['text','postings','pointer','version','missing_artifact','symlink'] as const)('rejects corrupt advanced %s without altering Phase 1',async kind=>{
 const s=await advancedPrepared();try{const index=await s.advanced.build(PROJECT,ANALYSIS),dir=directory(s),file=path.join(dir,`${index.indexId}.search-v2.json`),pointerFile=path.join(dir,'summary-v2.json');const envelope=JSON.parse(await fs.readFile(file,'utf8')),pointer=JSON.parse(await fs.readFile(pointerFile,'utf8'));if(kind==='pointer')await fs.writeFile(pointerFile,'{');else if(kind==='missing_artifact')await fs.unlink(file);else if(kind==='symlink'){await fs.unlink(file);await fs.symlink(path.join(dir,'summary.json'),file);}else {if(kind==='text')envelope.index.sources[0].text+='tamper';if(kind==='postings')envelope.index.tokens=[];if(kind==='version')envelope.index.builderVersion='future';envelope.documentHash=digest(envelope.index);pointer.pointer.documentHash=envelope.documentHash;pointer.documentHash=digest(pointer.pointer);await fs.writeFile(pointerFile,JSON.stringify(pointer));await fs.writeFile(file,JSON.stringify(envelope));}
 await expect(s.advancedStore.get(PROJECT,ANALYSIS)).rejects.toMatchObject({code:kind==='version'?'SEARCH_V2_VERSION_INCOMPATIBLE':'SEARCH_V2_STORAGE_CORRUPT'});await expect(s.advanced.build(PROJECT,ANALYSIS)).rejects.toThrow();expect((await s.search.get(PROJECT,ANALYSIS)).schemaVersion).toBe(1);
 }finally{await s.f.cleanup();}
});
it('rejects wrong source/graph/base identities and missing graph evidence explicitly',async()=>{
 const s=await advancedPrepared();try{const index=await s.advanced.build(PROJECT,ANALYSIS),base=await s.search.get(PROJECT,ANALYSIS),graph=await s.store.get(PROJECT,ANALYSIS);const forged=structuredClone(index);forged.provenance.graphDocumentHash='a'.repeat(64);expect(()=>matchSnapshots(forged,base,graph)).toThrow();const wrongBase=structuredClone(base);wrongBase.projectId='PRJ-FFFFFF';expect(()=>matchSnapshots(index,wrongBase,graph)).toThrow();const badParent=structuredClone(graph);badParent.evidence.files[0]!.metadata.entities[0]!.parentEntityId=badParent.evidence.files[0]!.metadata.entities[0]!.entityId;
 const injected=new AdvancedSearchCoordinator({get:async()=>badParent,publish:async()=>{}},s.search,s.advancedStore,s.reader,s.searchCoordinator);await expect(injected.load(PROJECT,ANALYSIS)).rejects.toThrow();await fs.unlink(path.join(s.f.storage,PROJECT,'analysis',ANALYSIS,'graph','summary.json'));await expect(s.advanced.load(PROJECT,ANALYSIS)).rejects.toMatchObject({code:'GRAPH_NOT_FOUND'});expect((await s.search.get(PROJECT,ANALYSIS)).schemaVersion).toBe(1);
 }finally{await s.f.cleanup();}
});
it('recovers immutable orphan after interrupted publication and never overwrites a different sidecar',async()=>{
 const s=await advancedPrepared();try{const base=await s.searchCoordinator.build(PROJECT,ANALYSIS),graph=await s.store.get(PROJECT,ANALYSIS),index=await buildAdvancedIndex(base,graph,s.reader),link=fs.link.bind(fs);const mock=vi.spyOn(fs,'link').mockImplementation(async(from,to)=>{if(String(to).endsWith('/summary-v2.json'))throw Error('interrupted');return link(from,to);});try{await expect(s.advancedStore.publish(index)).rejects.toThrow('interrupted');}finally{mock.mockRestore();}await Promise.all([s.advancedStore.publish(index),s.advancedStore.publish(index)]);expect(await s.advancedStore.get(PROJECT,ANALYSIS)).toEqual(index);await fs.writeFile(path.join(s.f.storage,PROJECT,'repository','rich.jsx'),'changed');const altered=await buildAdvancedIndex(base,graph,s.reader);await expect(s.advancedStore.publish(altered)).rejects.toMatchObject({code:'SEARCH_INDEX_CONFLICT'});expect(await s.advancedStore.get(PROJECT,ANALYSIS)).toEqual(index);
 }finally{await s.f.cleanup();}
});
