import { expect,it,vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setup,PROJECT,ANALYSIS } from './test-project.js';
import { graphInput } from './test-input.js';
import { buildGraph } from '../core/GraphBuilder.js';
import { FileGraphStore } from '../storage/GraphStore.js';
import { GraphCoordinator } from '../integration/GraphCoordinator.js';
import { GraphIndex } from '../core/GraphIndex.js';
import { validateGraph } from '../validation.js';
import { GRAPH_LIMITS,GraphError } from '../model.js';
import { digest } from '../../symbol-resolution/integration/contracts.js';
const directory=(s:Awaited<ReturnType<typeof setup>>)=>path.join(s.f.storage,PROJECT,'analysis',ANALYSIS,'graph');
it('builds from real persisted producer snapshots and reconstructs without Python, architecture or repeated file reads',async()=>{
 const s=await setup();try{const d=await s.coordinator.build(PROJECT,ANALYSIS);validateGraph(d);expect(d.snapshot.schemaVersion).toBe(1);expect(d.snapshot.architectureAnalysisHash).toBeNull();expect(s.calls).toEqual({analysis:1,document:9});
 s.setOffline();expect(await new FileGraphStore(s.workspaces).get(PROJECT,ANALYSIS)).toEqual(d);const fresh=new GraphCoordinator(s.projects,s.source,s.asts,s.resolutions,s.relationships,s.provider,new FileGraphStore(s.workspaces));expect(await fresh.build(PROJECT,ANALYSIS)).toEqual(d);expect(s.calls).toEqual({analysis:1,document:9});expect(new GraphIndex(d).nodes).toHaveLength(d.snapshot.nodeCount);
 }finally{await s.f.cleanup();}
});
it('retains unsupported source coverage and separates partial execution from partial graph evidence',async()=>{
 const s=await setup(graphInput(true));try{const d=await s.coordinator.build(PROJECT,ANALYSIS);expect(d.snapshot.coverage.find(c=>c.relativePath==='unsupported.ts')!.status).toBe('unsupported');expect(d.nodes.some(n=>n.relativePath==='unsupported.ts')).toBe(false);expect(d.snapshot.executionStatus).toBe('completed');expect(d.snapshot.evidenceCoverage).toBe('partial');expect(d.snapshot.coverage.some(c=>c.relationshipStatus==='partial')).toBe(true);
 }finally{await s.f.cleanup();}
});
it.each(['metadata','resolution','relationships'] as const)('isolates missing %s evidence without dropping unrelated files',async stage=>{
 const s=await setup(graphInput(true));try{
 const first=s.input.files[0]!,file=first.ast.relativePath;let provider=s.provider;
 if(stage==='metadata')provider={...provider,document:async(p,a,id)=>{if(id===s.input.metadataAnalysis.files.find(f=>f.relativePath===file)!.metadataArtifact!.artifactId)throw Object.assign(new Error('missing'),{code:'ENOENT'});return s.provider.document(p,a,id);}};
 else{const artifact=stage==='resolution'?s.input.resolutionAnalysis.files.find(f=>f.relativePath===file)!.artifact!.artifactId:s.input.relationshipAnalysis.files.find(f=>f.relativePath===file)!.artifact!.artifactId;await fs.unlink(path.join(s.f.storage,PROJECT,'analysis',ANALYSIS,stage==='resolution'?'resolution':'relationships',`${artifact}.${stage==='resolution'?'resolution':'relationships'}.json`));}
 const coordinator=new GraphCoordinator(s.projects,s.source,s.asts,s.resolutions,s.relationships,provider,s.store),d=await coordinator.build(PROJECT,ANALYSIS);
 expect(d.snapshot.executionStatus).toBe('completed_with_errors');expect(d.snapshot.coverage.find(c=>c.relativePath===file)!.codes.length).toBeGreaterThan(0);expect(d.nodes.some(n=>n.relativePath===s.input.files[1]!.ast.relativePath)).toBe(true);
 if(stage!=='metadata')expect(d.nodes.some(n=>n.relativePath===file&&n.metadataEntityId)).toBe(true);
 if(stage==='resolution')expect(d.nodes.some(n=>n.relativePath===file&&n.symbolId)).toBe(false);
 expect(d.edges.some(e=>e.relativePath===file)).toBe(false);
 }finally{await s.f.cleanup();}
});
it('rejects incompatible metadata identity per file while retaining other verified subgraphs',async()=>{
 const s=await setup(graphInput(true));try{const provider={...s.provider,document:async(p:string,a:string,id:string)=>{const m=await s.provider.document(p,a,id);if(m.sourceAst.relativePath==='rich.jsx')m.entities[0]!.contentHash='a'.repeat(64);return m;}};const d=await new GraphCoordinator(s.projects,s.source,s.asts,s.resolutions,s.relationships,provider,s.store).build(PROJECT,ANALYSIS);expect(d.snapshot.coverage.find(c=>c.relativePath==='rich.jsx')!.status).toBe('failed');expect(d.nodes.filter(n=>n.relativePath==='rich.jsx')).toEqual([]);expect(d.nodes.some(n=>n.relativePath==='same.jsx')).toBe(true);
 }finally{await s.f.cleanup();}
});
it('conflicts on changed known producer snapshots without overwriting the published graph',async()=>{
 const s=await setup(graphInput(true));try{const d=await s.coordinator.build(PROJECT,ANALYSIS),manifest=await s.relationships.getAnalysisManifest(PROJECT,ANALYSIS);manifest.completedAt='2026-11-09T00:00:08.000Z';await s.relationships.saveAnalysis(manifest);await expect(s.coordinator.build(PROJECT,ANALYSIS)).rejects.toMatchObject({code:'GRAPH_SNAPSHOT_CONFLICT'});expect(await s.store.get(PROJECT,ANALYSIS)).toEqual(d);
 }finally{await s.f.cleanup();}
});
it('rejects mismatched global metadata/source/analysis provenance and unfinished prerequisites',async()=>{
 const s=await setup(graphInput(true));try{
 const provider={...s.provider,analysis:async()=>{const m=await s.provider.analysis();m.projectId='PRJ-ABCDEF';return m;}};await expect(new GraphCoordinator(s.projects,s.source,s.asts,s.resolutions,s.relationships,provider,s.store).build(PROJECT,ANALYSIS)).rejects.toThrow();
 await expect(s.coordinator.build('PRJ-FFFFFF',ANALYSIS)).rejects.toMatchObject({code:'GRAPH_PROJECT_MISSING'});await expect(s.coordinator.build(PROJECT,'AN-00000000-0000-0000-0000-000000000002')).rejects.toMatchObject({code:'GRAPH_SOURCE_MISSING'});
 const source=await s.source.get(PROJECT,ANALYSIS);source.status='running';delete source.completedAt;await s.source.save(source);await expect(s.coordinator.build(PROJECT,ANALYSIS)).rejects.toMatchObject({code:'GRAPH_SOURCE_NOT_READY'});
 }finally{await s.f.cleanup();}
});
it('enforces build concurrency and configurable resource/deadline limits without publishing success',async()=>{
 const s=await setup(graphInput(true));try{const first=s.coordinator.build(PROJECT,ANALYSIS);await expect(s.coordinator.build(PROJECT,ANALYSIS)).rejects.toMatchObject({code:'GRAPH_BUSY'});await first;
 }finally{await s.f.cleanup();}
 const fresh=await setup(graphInput(true));try{
 for(const policy of [{maxFiles:1},{maxEntities:1},{maxNodes:1},{maxEdges:1},{maxCandidates:1},{maxBytes:1},{maxInputBytes:1},{maxDurationMs:1}]){
 const c=new GraphCoordinator(fresh.projects,fresh.source,fresh.asts,fresh.resolutions,fresh.relationships,fresh.provider,fresh.store,{...GRAPH_LIMITS,...policy});await expect(c.build(PROJECT,ANALYSIS)).rejects.toBeInstanceOf(GraphError);await expect(fresh.store.get(PROJECT,ANALYSIS)).rejects.toMatchObject({code:'GRAPH_NOT_FOUND'});
 }
 }finally{await fresh.f.cleanup();}
});
it('immutable publication is idempotent, rejects same-identity payload changes and recovers after reconstruction',async()=>{
 const s=await setup(graphInput(true));try{const d=buildGraph(s.input);await Promise.all([s.store.publish(d),s.store.publish(d)]);expect(await new FileGraphStore(s.workspaces).get(PROJECT,ANALYSIS)).toEqual(d);
 const changed=structuredClone(s.input);changed.files[0]!.relationships=null;changed.gaps.push({relativePath:changed.files[0]!.ast.relativePath,stage:'relationships',code:'GRAPH_UPSTREAM_MISSING'});await expect(s.store.publish(buildGraph(changed))).rejects.toMatchObject({code:'GRAPH_ARTIFACT_CONFLICT'});
 }finally{await s.f.cleanup();}
});
it.each(['json','checksum','missing_artifact','pointer','counts','endpoint','source_evidence','version'] as const)('rejects corrupt graph %s and never silently repairs it',async kind=>{
 const s=await setup(graphInput(true));try{const d=await s.coordinator.build(PROJECT,ANALYSIS),dir=directory(s),file=path.join(dir,d.snapshot.storage.artifact),pointerFile=path.join(dir,'summary.json');
 const envelope=JSON.parse(await fs.readFile(file,'utf8')),pointer=JSON.parse(await fs.readFile(pointerFile,'utf8'));
 if(kind==='json')await fs.writeFile(file,'{');else if(kind==='pointer')await fs.writeFile(pointerFile,'{');else if(kind==='missing_artifact')await fs.unlink(file);else{
 if(kind==='checksum')envelope.document.nodes[0].displayName='tampered';
 if(kind==='counts')envelope.document.snapshot.nodeCount++;
 if(kind==='endpoint')envelope.document.edges[0].targetGraphNodeId='gn-'+'a'.repeat(64);
 if(kind==='source_evidence')envelope.document.edges[0].sourceContext.entityId='meta-'+'a'.repeat(64);
 if(kind==='version')envelope.document.snapshot.graphBuilderVersion='knowledge-graph-v999';
 if(kind!=='checksum'){envelope.documentHash=digest(envelope.document);pointer.pointer.documentHash=envelope.documentHash;pointer.documentHash=digest(pointer.pointer);await fs.writeFile(pointerFile,JSON.stringify(pointer));}
 await fs.writeFile(file,JSON.stringify(envelope));}
 await expect(s.store.get(PROJECT,ANALYSIS)).rejects.toMatchObject({code:kind==='version'?'GRAPH_VERSION_INCOMPATIBLE':'GRAPH_STORAGE_CORRUPT'});await expect(s.store.publish(d)).rejects.toBeInstanceOf(GraphError);
 }finally{await s.f.cleanup();}
});
it('failed pointer publication leaves no successful graph and permits retry of the immutable orphan',async()=>{
 const s=await setup(graphInput(true));try{const d=buildGraph(s.input),link=fs.link.bind(fs),mock=vi.spyOn(fs,'link').mockImplementation(async(from,to)=>{if(String(to).endsWith('/graph/summary.json'))throw new Error('publication interrupted');return link(from,to);});
 try{await expect(s.store.publish(d)).rejects.toThrow('publication interrupted');}finally{mock.mockRestore();}
 await expect(s.store.get(PROJECT,ANALYSIS)).rejects.toMatchObject({code:'GRAPH_NOT_FOUND'});expect((await fs.readdir(directory(s))).some(f=>f.endsWith('.graph.json'))).toBe(true);await s.store.publish(d);expect(await s.store.get(PROJECT,ANALYSIS)).toEqual(d);
 }finally{await s.f.cleanup();}
});
it('rejects escaping workspace symlinks and unsafe graph storage identifiers',async()=>{
 const s=await setup(graphInput(true)),outside=await fs.mkdtemp('/tmp/codeatlas-graph-containment-');try{
 await fs.symlink(outside,directory(s));await expect(s.store.publish(buildGraph(s.input))).rejects.toMatchObject({code:'GRAPH_STORAGE_CORRUPT'});expect(await fs.readdir(outside)).toEqual([]);await expect(s.store.get('../bad',ANALYSIS)).rejects.toThrow();await expect(s.store.get(PROJECT,'../../bad')).rejects.toThrow();
 }finally{await s.f.cleanup();await fs.rm(outside,{recursive:true,force:true});}
});
it('an all-unavailable metadata subset remains explicitly insufficient rather than a complete empty repository',async()=>{
 const s=await setup(graphInput(true));try{const {ResolutionError}=await import('../../symbol-resolution/model.js');const provider={...s.provider,document:async()=>{throw new ResolutionError('METADATA_UNAVAILABLE',503);}};
 const d=await new GraphCoordinator(s.projects,s.source,s.asts,s.resolutions,s.relationships,provider,s.store).build(PROJECT,ANALYSIS);expect(d.nodes).toEqual([]);expect(d.edges).toEqual([]);expect(d.snapshot.evidenceCoverage).toBe('insufficient');expect(d.snapshot.executionStatus).toBe('completed_with_errors');expect(d.snapshot.coverage).toHaveLength(3);expect(d.snapshot.coverage.filter(c=>c.codes.includes('GRAPH_UPSTREAM_UNAVAILABLE'))).toHaveLength(2);
 }finally{await s.f.cleanup();}
});
