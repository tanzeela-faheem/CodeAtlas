import { expect,it } from 'vitest';
import express from 'express';
import { once } from 'node:events';
import { graphRoutes } from '../routes.js';
import { graphInput } from './test-input.js';
import { setup,PROJECT,ANALYSIS } from './test-project.js';
it('exposes bounded persisted structural graph APIs with strict validation and no Python retrieval dependency',async()=>{
 const s=await setup(graphInput(true)),app=express();app.use(express.json({limit:'128kb'}));app.use('/api/projects',graphRoutes(s.workspaces,s.provider));const server=app.listen(0,'127.0.0.1');await once(server,'listening');
 const origin=`http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`,base=`${origin}/api/projects/${PROJECT}/analysis/${ANALYSIS}/graph`;
 const post=(url:string,body:unknown)=>fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 try{
 expect((await fetch(base)).status).toBe(404);expect((await post(base,{unexpected:true})).status).toBe(400);
 const built=await post(base,{});expect(built.status).toBe(200);const summary=await built.json() as any;expect(summary.nodeCount).toBeGreaterThan(0);expect(summary.nodes).toBeUndefined();expect(summary.executionStatus).toBe('completed');expect(summary.evidenceCoverage).toBe('partial');expect(await(await fetch(base)).json()).toEqual(summary);
 const functions=await(await fetch(base+'/nodes?nodeKind=function&relativePath=rich.jsx')).json() as any,caller=functions.items.find((n:any)=>n.displayName==='caller');expect(caller).toBeTruthy();expect((await fetch(base+'/nodes/'+caller.graphNodeId)).status).toBe(200);
 const neighbors=await(await fetch(base+'/nodes/'+caller.graphNodeId+'/neighbors?edgeKind=CALLS&limit=2')).json() as any;expect(neighbors.items).toHaveLength(2);expect(neighbors.nextOffset).toBe(2);
 const edges=await(await fetch(base+'/edges?nodeId='+caller.graphNodeId+'&direction=outgoing&edgeKind=CALLS')).json() as any;expect(edges.items).toHaveLength(3);
 const traversal=await post(base+'/traverse',{startNodeId:caller.graphNodeId,algorithm:'dfs',edgeKinds:['CALLS'],maxDepth:2});expect(traversal.status).toBe(200);expect((await traversal.json() as any).nodeIds.length).toBeGreaterThan(1);
 expect((await(await fetch(base+'/candidates?limit=1')).json() as any).items).toHaveLength(1);
 const metadataId=caller.metadataEntityId;expect((await(await fetch(base+'/nodes?metadataEntityId='+metadataId)).json() as any).items[0].graphNodeId).toBe(caller.graphNodeId);
 for(const suffix of ['/nodes?limit=201','/nodes?offset=-1','/nodes?limit=1&limit=2','/nodes?relativePath=../bad','/nodes?nodeKind=database','/nodes?search=name','/edges?direction=sideways','/candidates?targetStatus=resolved','/nodes/bad','?unknown=true'])expect((await fetch(base+suffix)).status,suffix).toBe(400);
 expect((await fetch(base+'/nodes/gn-'+'a'.repeat(64))).status).toBe(404);expect((await post(base+'/traverse',{startNodeId:caller.graphNodeId,maxDepth:1001})).status).toBe(400);expect((await post(base+'/traverse',{startNodeId:caller.graphNodeId,expression:'eval()'})).status).toBe(400);expect((await post(base,[])).status).toBe(400);
 s.setOffline();expect(await(await fetch(base)).json()).toEqual(summary);expect(await(await post(base,{})).json()).toEqual(summary);expect((await fetch(base+'/nodes?limit=1')).status).toBe(200);expect(s.calls).toEqual({analysis:1,document:2});
 expect((await fetch(`${origin}/api/projects/bad/analysis/${ANALYSIS}/graph`)).status).toBe(400);
 }finally{server.closeAllConnections();server.close();await once(server,'close');await s.f.cleanup();}
},20000);
