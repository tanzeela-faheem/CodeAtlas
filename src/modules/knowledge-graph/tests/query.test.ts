import { beforeAll,expect,it } from 'vitest';
import { buildGraph } from '../core/GraphBuilder.js';
import { GraphIndex } from '../core/GraphIndex.js';
import { GraphQueryEngine } from '../core/GraphQueryEngine.js';
import { graphInput } from './test-input.js';
import type { GraphDocument } from '../model.js';
let doc:GraphDocument,index:GraphIndex,query:GraphQueryEngine;
beforeAll(()=>{doc=buildGraph(graphInput(true));index=new GraphIndex(doc);query=new GraphQueryEngine(index);});
it('indexes exact nodes, entity IDs, symbol IDs, kinds and source paths from the validated graph',()=>{
 for(const n of doc.nodes){expect(index.node(n.graphNodeId)).toEqual(n);if(n.metadataEntityId)expect(index.entity(n.metadataEntityId)).toEqual(n);if(n.symbolId)expect(index.symbol(n.symbolId)).toEqual(n);expect(index.kind(n.nodeKind)).toContainEqual(n);expect(index.source(n.relativePath)).toContainEqual(n);}
 for(const kind of ['CALLS','READS','CONTAINS'] as const)expect(index.edgeKind(kind)).toEqual(doc.edges.filter(e=>e.edgeKind===kind));
});
it('looks up entities and symbols separately, supports intersecting filters and stable pagination',()=>{
 const entity=doc.nodes.find(n=>n.metadataEntityId)!;expect(query.nodes({metadataEntityId:entity.metadataEntityId}).items).toEqual([entity]);const symbol=doc.nodes.find(n=>n.symbolId)!;expect(query.nodes({symbolId:symbol.symbolId}).items).toEqual([symbol]);
 expect(query.nodes({nodeKind:'function',relativePath:'same.jsx'}).items.every(n=>n.nodeKind==='function'&&n.relativePath==='same.jsx')).toBe(true);
 const all=query.nodes({limit:200}),first=query.nodes({limit:2}),second=query.nodes({limit:2,offset:2});expect(first.items.concat(second.items)).toEqual(all.items.slice(0,4));expect(first.nextOffset).toBe(2);expect(query.nodes({offset:10000}).items).toEqual([]);
});
it('retrieves incoming/outgoing and filtered occurrence edges and neighbors deterministically',()=>{
 const node=doc.nodes.find(n=>n.nodeKind==='function'&&n.displayName==='target'&&n.relativePath==='rich.jsx')!;
 expect(query.edges({nodeId:node.graphNodeId,direction:'incoming'}).items).toEqual(doc.edges.filter(e=>e.targetGraphNodeId===node.graphNodeId));
 expect(query.edges({nodeId:node.graphNodeId,direction:'outgoing'}).items).toEqual(doc.edges.filter(e=>e.sourceGraphNodeId===node.graphNodeId));
 const results=query.neighbors(node.graphNodeId,{direction:'incoming',edgeKind:'CALLS'}).items;expect(results.length).toBeGreaterThan(2);expect(results.every(x=>x.edge.edgeKind==='CALLS'&&x.edge.targetGraphNodeId===node.graphNodeId)).toBe(true);expect(new Set(results.map(x=>x.node.graphNodeId)).size).toBeLessThan(results.length);
 const recursive=doc.nodes.find(n=>n.nodeKind==='function'&&n.displayName==='recursive')!;expect(index.connected(recursive.graphNodeId,'both',['CALLS'])).toHaveLength(1);
});
it('retrieves candidates separately and never adds them to adjacency',()=>{
 const all=query.candidates({limit:200});expect(all.total).toBe(doc.candidates.length);expect(query.candidates({targetStatus:'deferred'}).items.every(c=>c.relationship.target.status==='deferred')).toBe(true);
 for(const c of all.items)expect(index.connected(c.sourceGraphNodeId,'both').some(e=>e.relationshipId===c.relationship.relationshipId)).toBe(false);
});
it('rejects unknown schema, unsafe paths, unbounded pagination and invalid identifiers',()=>{
 for(const q of [{limit:201},{offset:-1},{offset:0.5},{relativePath:'../escape'},{nodeKind:'database'},{symbolId:'meta-bad'},{text:'name'},{metadataEntityId:['bad']}])expect(()=>query.nodes(q)).toThrow();
 expect(()=>query.edges({direction:'sideways'})).toThrow();expect(()=>query.neighbors('bad',{})).toThrow();expect(()=>query.candidates({targetStatus:'resolved'})).toThrow();expect(()=>query.node('gn-'+'a'.repeat(64))).toThrow('GRAPH_NODE_NOT_FOUND');
});
it('captures immutable records so reconstructed indexes cannot become stale after caller mutation',()=>{
 const original=structuredClone(doc),rebuilt=new GraphIndex(original),id=original.nodes[0]!.graphNodeId,name=original.nodes[0]!.displayName;original.nodes[0]!.displayName='mutated';original.edges=[];expect(rebuilt.node(id)!.displayName).toBe(name);expect(rebuilt.edges).toHaveLength(doc.edges.length);expect(()=>{rebuilt.node(id)!.displayName='write';}).toThrow();
 const corrupt=structuredClone(doc);corrupt.edges[0]!.targetGraphNodeId='gn-'+'a'.repeat(64);expect(()=>new GraphIndex(corrupt)).toThrow();
});
