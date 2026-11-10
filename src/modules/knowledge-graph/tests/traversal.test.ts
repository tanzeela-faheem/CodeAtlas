import { expect,it } from 'vitest';
import { GraphTraversalEngine } from '../core/GraphTraversalEngine.js';
import { graphId } from '../contracts.js';
import type { GraphIndex } from '../core/GraphIndex.js';
import type { GraphEdge,Direction,EdgeKind } from '../model.js';
// Algorithm-only graph fixture: no synthetic metadata or producer evidence is used for construction tests.
function fixture(pairs:[string,string,EdgeKind?][],nodes=['a','b','c','d','isolated']){
 const id=(s:string)=>graphId('gn','algorithm-fixture',s),edges=pairs.map(([from,to,kind='CALLS'],i)=>({graphEdgeId:graphId('ge','algorithm-fixture',i),sourceGraphNodeId:id(from),targetGraphNodeId:id(to),edgeKind:kind}) as GraphEdge);
 const outgoing=new Map<string,GraphEdge[]>(),incoming=new Map<string,GraphEdge[]>();for(const e of edges){outgoing.set(e.sourceGraphNodeId,[...(outgoing.get(e.sourceGraphNodeId)??[]),e]);incoming.set(e.targetGraphNodeId,[...(incoming.get(e.targetGraphNodeId)??[]),e]);}
 const ids=new Set(nodes.map(id));const index={snapshot:{snapshotId:'algorithm-fixture'},node:(s:string)=>ids.has(s)?{graphNodeId:s}:undefined,connected:(s:string,d:Direction,k:EdgeKind[])=>[...new Map([...(d==='incoming'?[]:outgoing.get(s)??[]),...(d==='outgoing'?[]:incoming.get(s)??[])].map(e=>[e.graphEdgeId,e])).values()].filter(e=>k.includes(e.edgeKind))} as unknown as GraphIndex;
 return{engine:new GraphTraversalEngine(index),id,edges};
}
it.each(['bfs','dfs'] as const)('%s handles cycles, self-loops, disconnected nodes and depth zero',algorithm=>{
 const {engine,id}=fixture([['a','b'],['b','c'],['c','a'],['a','a']]);const result=engine.traverse({startNodeId:id('a'),algorithm,maxDepth:10});expect(new Set(result.nodeIds)).toEqual(new Set(['a','b','c'].map(id)));expect(result.edges).toHaveLength(4);expect(result.truncated).toBe(false);expect(engine.traverse({startNodeId:id('isolated'),algorithm}).nodeIds).toEqual([id('isolated')]);
 const zero=engine.traverse({startNodeId:id('a'),algorithm,maxDepth:0});expect(zero.nodeIds).toEqual([id('a')]);expect(zero.edges).toEqual([]);expect(zero.limitsReached).toEqual(['maxDepth']);
});
it('BFS visits breadth first and DFS follows the deterministic neighbor order with iterative backtracking',()=>{
 const base=fixture([]),ordered=['b','c'].sort((a,b)=>base.id(a).localeCompare(base.id(b))),first=ordered[0]!,second=ordered[1]!;
 const {engine,id}=fixture([['a',first],['a',second],[first,'d']]);
 expect(engine.traverse({startNodeId:id('a'),algorithm:'bfs'}).nodeIds).toEqual(['a',first,second,'d'].map(id));
 expect(engine.traverse({startNodeId:id('a'),algorithm:'dfs'}).nodeIds).toEqual(['a',first,'d',second].map(id));
});
it('respects direction, edge filters and occurrence edges without candidates',()=>{
 const {engine,id}=fixture([['a','b'],['a','b'],['c','b','READS']]);
 expect(engine.traverse({startNodeId:id('b'),direction:'outgoing'}).nodeIds).toEqual([id('b')]);expect(new Set(engine.traverse({startNodeId:id('b'),direction:'incoming'}).nodeIds)).toEqual(new Set(['a','b','c'].map(id)));
 const filtered=engine.traverse({startNodeId:id('b'),direction:'both',edgeKinds:['CALLS']});expect(new Set(filtered.nodeIds)).toEqual(new Set(['a','b'].map(id)));expect(filtered.edges).toHaveLength(2);
});
it.each(['bfs','dfs'] as const)('%s reports precise depth/node/edge budget encounters',algorithm=>{
 const {engine,id}=fixture([['a','b'],['b','c'],['c','d']]);
 for(const [key,value] of [['maxDepth',1],['maxNodes',2],['maxEdges',1]] as const){const r=engine.traverse({startNodeId:id('a'),algorithm,[key]:value});expect(r.truncated).toBe(true);expect(r.limitsReached).toContain(key);expect(r.nodeIds.length).toBeLessThanOrEqual(2);}
 expect(engine.traverse({startNodeId:id('a'),algorithm,maxNodes:4,maxEdges:3,maxDepth:3}).truncated).toBe(false);
});
it('rejects nonexistent starts, invalid options, arbitrary code and oversized traversal requests',()=>{
 const {engine,id}=fixture([]);expect(()=>engine.traverse({startNodeId:id('absent')})).toThrow('GRAPH_NODE_NOT_FOUND');
 for(const extra of [{algorithm:'recursive'},{direction:'sideways'},{maxDepth:1001},{maxNodes:5001},{maxEdges:10001},{maxNodes:0},{maxDepth:-1},{maxEdges:1.2},{edgeKinds:['DEPENDS_ON']},{edgeKinds:[]},{edgeKinds:['CALLS','CALLS']},{expression:'process.exit()'}])expect(()=>engine.traverse({startNodeId:id('a'),...extra})).toThrow();
});
it('iterative DFS and BFS handle a large chain within bounded resource/depth limits',()=>{
 const nodes=Array.from({length:10000},(_,i)=>String(i)),{engine,id}=fixture(nodes.slice(1).map((n,i)=>[nodes[i]!,n]),nodes);
 for(const algorithm of ['bfs','dfs']){const r=engine.traverse({startNodeId:id('0'),algorithm,maxDepth:1000,maxNodes:2000,maxEdges:2000});expect(r.nodeIds).toHaveLength(1001);expect(r.limitsReached).toEqual(['maxDepth']);}
});
