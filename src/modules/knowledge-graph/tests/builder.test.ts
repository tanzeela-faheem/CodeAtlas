import { expect,it } from 'vitest';
import { buildGraph } from '../core/GraphBuilder.js';
import { validateGraph } from '../validation.js';
import { graphProvenance } from '../contracts.js';
import { NodeManager } from '../core/NodeManager.js';
import { GRAPH_LIMITS } from '../model.js';
import { graphInput } from './test-input.js';
it('creates canonical authoritative entity and binding nodes with exact identity, ranges and declaration mappings',()=>{
 const input=graphInput(),d=buildGraph(input);validateGraph(d);
 expect(d.nodes.filter(n=>n.metadataEntityId)).toHaveLength(input.files.reduce((n,f)=>n+f.metadata.entities.length,0));
 expect(d.nodes.filter(n=>n.symbolId)).toHaveLength(input.files.reduce((n,f)=>n+f.resolution!.symbols.length,0));
 for(const f of input.files)for(const entity of f.metadata.entities){const node=d.nodes.find(n=>n.metadataEntityId===entity.entityId)!;expect(node.graphNodeId).toMatch(/^gn-/);expect(node.graphNodeId).not.toBe(entity.entityId);expect(node.range).toEqual(entity.sourceRange);expect(node.relativePath).toBe(entity.relativePath);expect(node.properties).toEqual(entity.properties);}
 expect(d.nodes.filter(n=>n.displayName==='x'&&n.nodeKind==='parameter').length).toBeGreaterThanOrEqual(2);
 expect(new Set(d.nodes.filter(n=>n.displayName==='f').map(n=>n.relativePath)).size).toBeGreaterThan(1);
 expect(d.snapshot.countsByNodeKind.constructor).toBe(1);
 const manager=new NodeManager(graphProvenance(input));manager.addFile(input.files[0]!);const count=manager.nodes().length;manager.addFile(input.files[0]!);expect(manager.nodes()).toHaveLength(count);
});
it('supports AST-only catch bindings and distinguishes same-name declarations and separate lexical bindings',()=>{
 const i=graphInput(true),d=buildGraph(i),binding=d.nodes.find(n=>n.nodeKind==='binding'&&n.displayName==='error')!;
 expect(binding.limitations).toContain('AST_ONLY_BINDING');expect(binding.metadataEntityId).toBeNull();expect(binding.declarationGraphNodeIds).toEqual([]);
 const targets=d.nodes.filter(n=>n.nodeKind==='function'&&n.displayName==='target');expect(targets).toHaveLength(3);expect(new Set(targets.map(n=>n.graphNodeId)).size).toBe(3);
 for(const n of d.nodes.filter(n=>n.symbolId)){const f=i.files.find(f=>f.ast.relativePath===n.relativePath)!,s=f.resolution!.symbols.find(s=>s.id===n.symbolId)!;expect(n.declarationGraphNodeIds).toHaveLength(new Set(s.declarations.flatMap(x=>x.metadataEntityId?[x.metadataEntityId]:[])).size);}
});
it('preserves occurrences, true local targets, recursive/nested callers and module contexts',()=>{
 const i=graphInput(true),d=buildGraph(i),byId=new Map(d.nodes.map(n=>[n.graphNodeId,n]));
 const caller=d.nodes.find(n=>n.nodeKind==='function'&&n.displayName==='caller')!,target=d.nodes.find(n=>n.nodeKind==='function'&&n.displayName==='target'&&n.relativePath==='rich.jsx')!;
 const calls=d.edges.filter(e=>e.sourceGraphNodeId===caller.graphNodeId&&e.targetGraphNodeId===target.graphNodeId&&e.edgeKind==='CALLS');expect(calls).toHaveLength(2);expect(calls[0]!.graphEdgeId).not.toBe(calls[1]!.graphEdgeId);
 expect(d.edges.some(e=>e.edgeKind==='CALLS'&&e.sourceGraphNodeId===e.targetGraphNodeId)).toBe(true);
 expect(d.edges.some(e=>e.edgeKind==='CALLS'&&byId.get(e.sourceGraphNodeId)!.displayName==='nested'&&e.targetGraphNodeId===target.graphNodeId)).toBe(true);
 expect(d.edges.some(e=>e.edgeKind==='CALLS'&&e.sourceContext.context==='module'&&byId.get(e.sourceGraphNodeId)!.nodeKind==='module')).toBe(true);
 expect(d.edges.some(e=>e.edgeKind==='CALLS'&&byId.get(e.sourceGraphNodeId)!.nodeKind==='field')).toBe(true);
 expect(d.edges.some(e=>e.edgeKind==='CALLS'&&byId.get(e.sourceGraphNodeId)!.nodeKind==='class')).toBe(false);
 expect(d.candidates.some(c=>c.reason==='CLASS_INITIALIZER_CONTEXT_UNMODELED')).toBe(true);
});
it('maps creates, heritage, containment and binding read/write occurrences with precise guarantees',()=>{
 const i=graphInput(),d=buildGraph(i),nodes=new Map(d.nodes.map(n=>[n.graphNodeId,n]));
 for(const kind of ['CREATES','EXTENDS','CONTAINS','READS','WRITES'])expect(d.edges.some(e=>e.edgeKind===kind)).toBe(true);
 for(const e of d.edges){expect(nodes.has(e.sourceGraphNodeId)&&nodes.has(e.targetGraphNodeId)).toBe(true);const f=i.files.find(f=>f.ast.relativePath===e.relativePath)!,r=f.relationships!.relationships.find(r=>r.relationshipId===e.relationshipId)!;expect(e.range).toEqual(r.range);expect(r.target.status).toBe('established');
 if(e.edgeKind==='READS'||e.edgeKind==='WRITES'){expect(nodes.get(e.targetGraphNodeId)!.nodeKind).toBe('binding');expect(nodes.get(e.targetGraphNodeId)!.symbolId).toBe(r.target.symbolId);}
 if(e.edgeKind==='EXTENDS')expect(e.guarantee).toBe('heritage_syntax');if(e.edgeKind==='CONTAINS')expect(e.guarantee).toBe('syntactic_ownership');}
});
it('separates ambiguous, unknown, invalid, dynamic, import/export and unmapped evidence without fake targets',()=>{
 const i=graphInput(),d=buildGraph(i);for(const status of ['ambiguous','unresolved','invalid','unsupported','deferred'])expect(d.candidates.some(c=>c.relationship.target.status===status)).toBe(true);
 for(const kind of ['imports_syntax','exports_syntax'])expect(d.candidates.some(c=>c.relationship.kind===kind)).toBe(true);
 expect(d.nodes.some(n=>n.displayName==='UNKNOWN_TARGET')).toBe(false);
 const seen=[...d.edges.map(e=>e.relationshipId),...d.candidates.map(c=>c.relationship.relationshipId)];expect(new Set(seen).size).toBe(i.files.reduce((n,f)=>n+f.relationships!.relationships.length,0));expect(seen).toHaveLength(new Set(seen).size);
});
it('deterministic construction is independent of loaded file order and does not mutate inputs',()=>{
 const i=graphInput(),original=structuredClone(i),a=buildGraph(i),b=buildGraph({...i,files:[...i.files].reverse()});expect(b).toEqual(a);expect(i).toEqual(original);expect(a.snapshot.evidenceCoverage).toBe('partial');
});
it('rejects unsupported kinds, corrupted identity/range, ownership and source provenance',()=>{
 for(const mutate of [(i:any)=>i.files[0].metadata.entities[0].kind='interface',(i:any)=>i.files[0].metadata.entities[0].entityId='meta-'+'a'.repeat(64),(i:any)=>i.files[0].metadata.sourceAst.contentHash='a'.repeat(64),(i:any)=>i.files[0].ast.analysisId='AN-00000000-0000-0000-0000-000000000002',(i:any)=>i.files[0].metadata.entities[1].parentEntityId=i.files[0].metadata.entities[1].entityId]){const i=structuredClone(graphInput());mutate(i);expect(()=>buildGraph(i)).toThrow();}
});
it('enforces file/node/entity/edge/candidate/byte/time budgets',()=>{
 const i=graphInput();for(const key of ['maxFiles','maxNodes','maxEntities','maxEdges','maxCandidates','maxRelationships','maxInputBytes','maxBytes'] as const)expect(()=>buildGraph(i,{...GRAPH_LIMITS,[key]:1})).toThrow();expect(()=>buildGraph(i,GRAPH_LIMITS,0)).toThrow('GRAPH_TIME_BUDGET');
});

it('requires explicit null for unavailable producer documents rather than accepting false as missing evidence',()=>{
 for(const stage of ['resolution','relationships'] as const){const i=structuredClone(graphInput(true)),file=i.files[0]!;file[stage]=null;if(stage==='resolution')file.relationships=null;i.gaps.push({relativePath:file.ast.relativePath,stage,code:'GRAPH_UPSTREAM_MISSING'});expect(()=>buildGraph(i)).not.toThrow();(file as any)[stage]=false;expect(()=>buildGraph(i)).toThrow('nullable producer document');}
});
