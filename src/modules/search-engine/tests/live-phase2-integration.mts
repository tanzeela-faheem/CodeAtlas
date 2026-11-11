/** Optional controlled live check. Requires existing Python environment; no installation.
 * CODEATLAS_PYTHON_EXECUTABLE and CODEATLAS_PYTHON_REPOSITORY specify read-only producer code.
 */
import { FileGraphStore } from "../../knowledge-graph/storage/GraphStore.js";
import fs from "node:fs/promises";
import http from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import assert from "node:assert/strict";
import { createApp } from "../../../app.js";
import { fixture } from "../../../test/fixtures.js";
import { WorkspaceManagerService } from "../../respository/services/workspace-manager.service.js";
const python = process.env.CODEATLAS_PYTHON_EXECUTABLE;
const repository = process.env.CODEATLAS_PYTHON_REPOSITORY;
if (!python || !repository) throw new Error("Set Python executable and repository explicitly; no dependency installation is performed.");
const f = await fixture({ 'app.js': "import {value as imported} from './other.js'; function helper(p) { return p; } export class Local { method() { return 1; } } function nested() { class Child extends Local {} return new Child(); } export function run(p) { let local = p; local++; helper(local); helper(local); new Local(); return imported; } run(1);\r\n/** Café SearchDocumentation billing_records */\r\nconst café = '😀';\r\nfunction UnicodeScope(){ let repeated = 1; return repeated; }\r\nfunction OtherScope(){ let repeated = 2; return repeated; }\r\nthrow 'DO_NOT_EXECUTE';", 'other.js': 'export const value = 1;', 'views/View.jsx': 'const label = 1; export default <Thing value={label} />;', 'unsupported.ts': 'const n: number = 1;', 'controllers/UserController.js': 'export function UserController() {}', 'services/BillingService.js': 'export function BillingService() {}', 'repositories/StoreRepository.js': 'export class StoreRepository {}', 'domain/BillingModel.js': 'export class BillingModel {}', 'events.js': `import EventEmitter from 'node:events'; const bus = new EventEmitter(); bus.emit('work'); bus.on('work', () => {});` });
const server = http.createServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
const nodeUrl = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`;
const program = `import socket, uvicorn
from fastapi import FastAPI
from app.metadata.routes import v2_router
app = FastAPI()
app.include_router(v2_router)
sock = socket.socket()
sock.bind(('127.0.0.1', 0))
print('READY ' + str(sock.getsockname()[1]), flush=True)
uvicorn.Server(uvicorn.Config(app, log_level='error', lifespan='off')).run(sockets=[sock])`;
const child = spawn(python, ['-B', '-c', program], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: repository, CODEATLAS_AST_BASE_URL: nodeUrl, CODEATLAS_METADATA_ROOT: path.join(f.root, 'python-metadata') }, stdio: ['ignore', 'pipe', 'pipe'] });
let stderr = ''; child.stderr.on('data', data => stderr += String(data));
try {
    const port = await new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Python startup timed out: ' + stderr)), 10000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error(`Python exited ${code}: ${stderr}`)); });
        const lines = createInterface({ input: child.stdout }); lines.on('line', line => { if (line.startsWith('READY ')) { clearTimeout(timer); resolve(Number(line.slice(6))); } });
    });
    const pythonUrl = `http://127.0.0.1:${port}`;
    process.env.CODEATLAS_METADATA_BASE_URL = pythonUrl; process.env.CODEATLAS_TRUSTED_IMPORTS = 'true';
    server.on('request', createApp(new WorkspaceManagerService(f.storage)));
    const post = async (url: string, body: unknown = {}) => { const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const value = await res.json() as any; assert.equal(res.status, 200, JSON.stringify(value)); return value; };
    const imported = await post(nodeUrl + '/api/repository/import', { sourceType: 'local', source: f.source });
    assert.equal(imported.status, 'imported');
    const response = await fetch(`${nodeUrl}/api/projects/${imported.projectId}/analysis`, { method: 'POST' }); assert.equal(response.status, 202);
    const analysis = await response.json() as any;
    const base = `${nodeUrl}/api/projects/${imported.projectId}/analysis/${analysis.analysisId}`;
    for (let i = 0; i < 200; i++) { const s = await (await fetch(base)).json() as any; if (s.status === 'completed') break; await new Promise(r => setTimeout(r, 10)); }
    const extracted = await post(`${pythonUrl}/api/v2/metadata/projects/${imported.projectId}/analyses/${analysis.analysisId}/extract`);
    assert.equal(extracted.status, 'partial');
    const resolution = await post(`${base}/resolve`); assert.equal(resolution.status, 'partial'); assert.equal(resolution.fileCount, 9);
    const files = await (await fetch(`${base}/resolution/files`)).json() as any;
    assert.equal(files.files.filter((f: any) => f.artifact).length, 8);
    const app = files.files.find((f: any) => f.relativePath === 'app.js'); assert.equal(app.status, 'complete');
    const document = await (await fetch(`${base}/resolution/files/${app.artifact.artifactId}`)).json() as any;
    assert.equal(document.references.find((r: any) => r.name === 'local').status, 'resolved');
    assert.equal(document.symbols.find((s: any) => s.name === 'imported').import.targetStatus, 'deferred');
    assert.equal(files.files.find((f: any) => f.relativePath === 'unsupported.ts').status, 'unsupported');
    const again = await post(`${base}/resolve`); assert.deepEqual(again, resolution);
    const related = await post(`${base}/relationships`); assert.equal(related.status, 'partial'); assert.equal(related.fileCount, 9);
    const relationshipFiles = await (await fetch(`${base}/relationships/files`)).json() as any;
    assert.equal(relationshipFiles.files.filter((f: any) => f.artifact).length, 8);
    assert.equal(relationshipFiles.files.find((f: any) => f.relativePath === 'unsupported.ts').status, 'unsupported');
    const file = relationshipFiles.files.find((f: any) => f.relativePath === 'app.js');
    const relationDocument = await (await fetch(`${base}/relationships/files/${file.artifact.artifactId}`)).json() as any;
    const calls = relationDocument.relationships.filter((r: any) => r.kind === 'calls' && r.target.status === 'established');
    const constructions = relationDocument.relationships.filter((r: any) => r.kind === 'constructs' && r.target.status === 'established');
    assert.equal(calls.length, 3); assert.equal(constructions.length, 2);
    assert.equal(relationDocument.relationships.find((r: any) => r.kind === 'imports_syntax').target.symbolId, null);
    assert.deepEqual(await post(`${base}/relationships`), related);
    // Build the graph before architecture exists; architecture is an optional consumer.
    assert.equal((await fetch(`${base}/architecture`)).status, 404);
    const graph = await post(`${base}/graph`); assert.equal(graph.executionStatus, 'completed'); assert.equal(graph.evidenceCoverage, 'partial');
    assert.equal(graph.coverage.length, 9); assert.equal(graph.coverage.find((c:any)=>c.relativePath==='unsupported.ts').status,'unsupported');
    assert.deepEqual(await (await fetch(`${base}/graph`)).json(),graph);
    const stored = await new FileGraphStore(new WorkspaceManagerService(f.storage)).get(imported.projectId,analysis.analysisId);
    const authoritative = new Set(stored.evidence.files.flatMap(f=>f.metadata.entities.map(e=>e.entityId)));
    assert.equal(stored.nodes.filter(n=>n.metadataEntityId).length,authoritative.size);
    assert(stored.nodes.filter(n=>n.metadataEntityId).every(n=>authoritative.has(n.metadataEntityId!)));
    assert.equal(stored.edges.length+stored.candidates.length,stored.evidence.files.reduce((n,f)=>n+(f.relationships?.relationships.length??0),0));
    assert(stored.candidates.some(c=>c.relationship.kind==='imports_syntax'&&c.relationship.target.entityId===null));
    const functions = await (await fetch(`${base}/graph/nodes?nodeKind=function&relativePath=app.js`)).json() as any;
    const run = functions.items.find((n:any)=>n.displayName==='run'); assert(run);
    const outgoing = await (await fetch(`${base}/graph/edges?nodeId=${run.graphNodeId}&direction=outgoing&edgeKind=CALLS`)).json() as any;
    assert.equal(outgoing.items.length,2); assert.notEqual(outgoing.items[0].graphEdgeId,outgoing.items[1].graphEdgeId);
    const traversal = await post(`${base}/graph/traverse`,{startNodeId:run.graphNodeId,algorithm:'bfs',edgeKinds:['CALLS'],maxDepth:3,maxNodes:10,maxEdges:10});
    assert.equal(traversal.nodeIds.length,2); assert.equal(traversal.edges.length,2); assert.equal(traversal.truncated,false);
    assert.equal((await fetch(`${base}/graph/nodes/${run.graphNodeId}/neighbors?edgeKind=CALLS`)).status,200);
    assert.equal((await fetch(`${base}/graph/candidates?limit=2`)).status,200);
    assert.deepEqual(await post(`${base}/graph`),graph);
    assert(!JSON.stringify(graph).includes(f.root));
    const indexed = await post(`${base}/search/index`);
    assert.equal(indexed.status,'partial'); assert(indexed.documentCount > 50);
    const search = (body:unknown) => post(`${base}/search/query`,body);
    const exactRequest={schemaVersion:1,query:'run',mode:'exact',filters:{documentKind:'entity',entityKind:'function',language:'JavaScript',path:'app.js'},limit:10};
    const exact=await search(exactRequest);assert.equal(exact.total,1);assert(exact.results[0].navigation.graphNodeId);assert(exact.results[0].navigation.metadataEntityId);
    assert.equal((await search({...exactRequest,query:'RUN'})).total,0);
    assert.equal((await search({...exactRequest,query:'RUN',mode:'lexical'})).total,1);
    const documentation=await search({schemaVersion:1,query:'search documentation',mode:'lexical'});
    assert(documentation.results.some((r:any)=>['comment','documentation'].includes(r.entityKind)));
    const unicode=await search({schemaVersion:1,query:'café',mode:'exact',filters:{documentKind:'source_occurrence',path:'app.js'},limit:100});assert(unicode.total>=1);
    const sourceResponse=await fetch(`${base}/source?path=app.js`);assert.equal(sourceResponse.status,200);const verifiedSource=await sourceResponse.json() as any;
    for(const r of unicode.results){const range=r.sourceMatchRange;assert.equal(verifiedSource.sourceCode.slice(range.start.offset,range.end.offset),'café');const prefix=verifiedSource.sourceCode.slice(0,range.start.offset);assert.equal(range.start.row,prefix.split('\n').length-1);assert.equal(range.start.column,prefix.length-(prefix.lastIndexOf('\n')+1));assert.equal(r.snippet.text.slice(r.snippet.matchStart,r.snippet.matchEnd),'café');assert.equal(r.contentHash,verifiedSource.contentHash);}
    const repeated={schemaVersion:1,query:'repeated',mode:'exact',filters:{documentKind:'entity',entityKind:'variable'},limit:1};
    const page=await search(repeated);assert.equal(page.total,2);assert.equal(page.pagination.nextOffset,1);const page2=await search({...repeated,offset:1});assert.notEqual(page.results[0].documentId,page2.results[0].documentId);
    const moduleId=exact.results[0].navigation.moduleId;assert.equal((await search({...exactRequest,filters:{moduleId,entityKind:'function'}})).total,1);
    assert.equal(indexed.coverage.find((c:any)=>c.relativePath==='unsupported.ts').source,'unsupported');
    assert.deepEqual(await post(`${base}/search/index`),indexed);assert.deepEqual(await search(exactRequest),exact);
    const advancedIndex=await post(`${base}/search/index`,{schemaVersion:2});assert.equal(advancedIndex.schemaVersion,2);assert.equal(advancedIndex.sourceFiles,8);
    assert.deepEqual(await(await fetch(`${base}/search?schemaVersion=2`)).json(),advancedIndex);
    const tokenRequest={schemaVersion:2,mode:'token_phrase',query:'helper local helper local',filters:{path:'app.js'}};
    const tokenResult=await search(tokenRequest);assert.equal(tokenResult.total,1);
    const textRequest={schemaVersion:2,mode:'text_phrase',query:'helper(local); helper(local);',filters:{path:'app.js'}};
    const textResult=await search(textRequest);assert.equal(textResult.total,1);
    assert.equal(tokenResult.results[0].location.range.start.offset,textResult.results[0].location.range.start.offset);
    for(const result of [tokenResult,textResult]){const range=result.results[0].location.range;const original=verifiedSource.sourceCode.slice(range.start.offset,range.end.offset);assert(original.startsWith('helper(local); helper(local'));if(result===tokenResult)assert.equal(original,'helper(local); helper(local');const prefix=verifiedSource.sourceCode.slice(0,range.start.offset);assert.equal(range.start.row,prefix.split('\n').length-1);assert.equal(range.start.column,prefix.length-prefix.lastIndexOf('\n')-1);}
    assert.equal(verifiedSource.sourceCode.slice(textResult.results[0].location.range.start.offset,textResult.results[0].location.range.end.offset),textRequest.query);
    const unicodePhrase=await search({schemaVersion:2,mode:'text_phrase',query:'Café SearchDocumentation billing_records'});assert.equal(unicodePhrase.total,1);const unicodeRange=unicodePhrase.results[0].location.range;assert.equal(verifiedSource.sourceCode.slice(unicodeRange.start.offset,unicodeRange.end.offset),'Café SearchDocumentation billing_records');assert(unicodeRange.start.row>0);
    const fileRequest={schemaVersion:2,mode:'file_lexical',query:'café UnicodeScope',occurrenceLimit:1};const fileResult=await search(fileRequest);assert.equal(fileResult.total,1);assert.equal(fileResult.results[0].recordKind,'source_file');assert(fileResult.results[0].occurrencesTruncated);
    const helperNode=stored.nodes.find(n=>n.metadataEntityId&&n.displayName==='helper'&&n.relativePath==='app.js')!;
    const runEntity=stored.evidence.files.find(f=>f.ast.relativePath==='app.js')!.metadata.entities.find(e=>e.name==='run'&&e.kind==='function')!;
    const structuralRequest={schemaVersion:2,mode:'entity',query:'RUN',match:'lexical',entity:{parentId:runEntity.parentEntityId,parentMode:'direct'},filters:{path:'app.js',entityKind:'function',language:'JavaScript'},graph:[{nodeId:helperNode.graphNodeId,direction:'incoming',edgeKind:'CALLS',neighborKind:'function'}]};
    const structuralResult=await search(structuralRequest);assert.equal(structuralResult.total,1);assert.equal(structuralResult.results[0].navigation.metadataEntityId,runEntity.entityId);assert.equal(structuralResult.results[0].supportingEdgeCount,2);assert.equal(new Set(structuralResult.results[0].supportingEdges.map((e:any)=>e.graphEdgeId)).size,2);assert(structuralResult.results[0].supportingEdges.every((e:any)=>stored.edges.some(original=>original.graphEdgeId===e.graphEdgeId)));
    const nested=stored.evidence.files.find(f=>f.ast.relativePath==='app.js')!.metadata.entities.find(e=>e.name==='nested'&&e.kind==='function')!;const directChildren=await search({schemaVersion:2,mode:'entity',entity:{parentId:nested.entityId,parentMode:'direct'}});assert(directChildren.total>0);
    assert.equal(advancedIndex.coverage.find((c:any)=>c.relativePath==='unsupported.ts').status,'unsupported');assert.deepEqual(await search(structuralRequest),structuralResult);
    await fs.writeFile(path.join(f.storage,imported.projectId,'repository','app.js'),'unverifiedCurrentMutation');
    assert.equal((await fetch(`${base}/source?path=app.js`)).status,409);
    assert.deepEqual(await search(exactRequest),exact);assert.equal((await search({schemaVersion:1,query:'unverifiedCurrentMutation',mode:'exact'})).total,0);
    assert.deepEqual(await search(textRequest),textResult);assert.deepEqual(await search(structuralRequest),structuralResult);
    child.kill('SIGTERM');await once(child,'exit');
    server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
    // Start a separate Node process against only the existing isolated storage.
    const launch=`import { createApp } from './src/app.ts'; const s=createApp().listen(0,'127.0.0.1',()=>console.log('READY '+s.address().port));`;
    const restarted=spawn(process.execPath,['--import','tsx','--input-type','module','-e',launch],{cwd:process.cwd(),env:{...process.env,WORKSPACE_ROOT:f.storage},stdio:['ignore','pipe','pipe']});
    try{const restartPort=await new Promise<number>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Node restart timeout')),10000);restarted.once('error',e=>{clearTimeout(timer);reject(e);});restarted.once('exit',()=>{clearTimeout(timer);reject(new Error('Node restart exited'));});createInterface({input:restarted.stdout}).on('line',line=>{if(line.startsWith('READY ')){clearTimeout(timer);resolve(Number(line.slice(6)));}});});
    const persisted=`http://127.0.0.1:${restartPort}/api/projects/${imported.projectId}/analysis/${analysis.analysisId}/search`;
    assert.deepEqual(await(await fetch(persisted)).json(),indexed);assert.deepEqual(await post(persisted+'/query',exactRequest),exact);assert.deepEqual(await post(persisted+'/query',repeated),page);assert.deepEqual(await post(persisted+'/index'),indexed);
    assert.deepEqual(await(await fetch(persisted+'?schemaVersion=2')).json(),advancedIndex);assert.deepEqual(await post(persisted+'/query',tokenRequest),tokenResult);assert.deepEqual(await post(persisted+'/query',textRequest),textResult);assert.deepEqual(await post(persisted+'/query',fileRequest),fileResult);assert.deepEqual(await post(persisted+'/query',structuralRequest),structuralResult);assert.deepEqual(await post(persisted+'/index',{schemaVersion:2}),advancedIndex);
    }finally{restarted.kill('SIGTERM');await once(restarted,'exit');}
    console.log(JSON.stringify({result:'PASS',workflow:'import -> AST -> live Python metadata -> symbols -> relationships -> graph -> unchanged Phase 1 -> positional/token/text/file/structural/graph conjunctions -> UTF16/CRLF/parallel edges -> source mutation rejection -> separate Node process restart -> offline persisted queries',phase:2,positions:advancedIndex.positionCount,files:indexed.coverage.length,documents:indexed.documentCount,unsupportedFiles:1,sourceExecuted:false,deterministicQueries:true}));
} finally {
    if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await once(child,'exit');}
    if(server.listening){server.closeAllConnections();server.close();await once(server,'close');}await f.cleanup();
}
