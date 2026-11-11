import { it,expect,vi } from 'vitest';
import express from 'express';
import { once } from 'node:events';
import { advancedPrepared,PROJECT,ANALYSIS } from './advanced-helpers.js';
import { searchRoutes } from '../routes.js';
import { SourceReader } from '../../analysis/source-reader.js';
it('supports explicit v2 build/status/query while preserving schema 1 responses and local-only validation',async()=>{
 const s=await advancedPrepared(),app=express();app.use(express.json({limit:'128kb'}));app.use('/api/projects',searchRoutes(s.workspaces));const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api/projects/${PROJECT}/analysis/${ANALYSIS}/search`,post=(suffix:string,body:unknown)=>fetch(base+suffix,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 try{expect((await fetch(base+'?schemaVersion=2')).status).toBe(404);const old=await(await post('/index',{})).json(),oldRequest={schemaVersion:1,mode:'exact',query:'target'},oldResponse=await(await post('/query',oldRequest)).json();
 const built=await post('/index',{schemaVersion:2});expect(built.status).toBe(200);const advanced=await built.json();expect(advanced.schemaVersion).toBe(2);expect(await(await fetch(base+'?schemaVersion=2')).json()).toEqual(advanced);expect(await(await fetch(base)).json()).toEqual(old);expect(await(await post('/query',oldRequest)).json()).toEqual(oldResponse);
 const request={schemaVersion:2,mode:'token_phrase',query:'target target',groupBy:'file',limit:1,occurrenceLimit:1};const read=vi.spyOn(SourceReader.prototype,'read');let result:any;try{result=await(await post('/query',request)).json();expect(read).not.toHaveBeenCalled();}finally{read.mockRestore();}expect(result.schemaVersion).toBe(2);expect(result.results).toHaveLength(1);expect(result.results[0].occurrencesTruncated).toBe(true);expect(result.provenance.graphDocumentHash).toBe(advanced.provenance.graphDocumentHash);expect(JSON.stringify(result)).not.toContain(s.f.root);
 for(const body of [{schemaVersion:3,mode:'token_phrase',query:'x'},{schemaVersion:2,mode:'text_phrase',query:'...'},{schemaVersion:2,mode:'entity',entity:{attributes:{async:true}}},{schemaVersion:2,mode:'token_phrase',query:'x',limit:101}])expect((await post('/query',body)).status).toBe(400);
 expect((await post('/index',{schemaVersion:2,rebuild:true})).status).toBe(400);expect((await fetch(base+'?schemaVersion=3')).status).toBe(400);expect((await fetch(base+'?schemaVersion=2&path=secret')).status).toBe(400);expect((await post('/query',{schemaVersion:2,mode:'entity',graph:[{nodeId:'gn-'+'a'.repeat(64),direction:'incoming',edgeKind:'CALLS'}]})).status).toBe(404);
 expect(await(await post('/index',{schemaVersion:2})).json()).toEqual(advanced);expect(await(await post('/query',request)).json()).toEqual(result);
 }finally{server.closeAllConnections();server.close();await once(server,'close');await s.f.cleanup();}
});
