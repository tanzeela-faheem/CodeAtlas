/** Optional controlled live check. Requires existing Python environment; no installation.
 * CODEATLAS_PYTHON_EXECUTABLE and CODEATLAS_PYTHON_REPOSITORY specify read-only producer code.
 */
import { FileGraphStore } from "../storage/GraphStore.js";
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
const f = await fixture({ 'app.js': "import {value as imported} from './other.js'; function helper(p) { return p; } export class Local {} function nested() { class Child extends Local {} return new Child(); } export function run(p) { let local = p; local++; helper(local); helper(local); new Local(); return imported; } run(1);", 'other.js': 'export const value = 1;', 'views/View.jsx': 'const label = 1; export default <Thing value={label} />;', 'unsupported.ts': 'const n: number = 1;', 'controllers/UserController.js': 'export function UserController() {}', 'services/BillingService.js': 'export function BillingService() {}', 'repositories/StoreRepository.js': 'export class StoreRepository {}', 'domain/BillingModel.js': 'export class BillingModel {}', 'events.js': `import EventEmitter from 'node:events'; const bus = new EventEmitter(); bus.emit('work'); bus.on('work', () => {});` });
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
    const architecture = await post(`${base}/architecture`); assert.equal(architecture.status, 'partial'); assert.equal(architecture.executionStatus, 'completed'); assert.equal(architecture.counts.files, 9); assert.equal(architecture.counts.availableFiles, 8);
    assert.deepEqual(await (await fetch(`${base}/architecture`)).json(), architecture);
    const discovered = await (await fetch(`${base}/architecture/findings`)).json() as any;
    assert.equal(discovered.findings.length, 7);
    assert.equal(discovered.findings.find((f: any) => f.pattern === 'layers').classification, 'candidate');
    assert.equal(discovered.findings.find((f: any) => f.pattern === 'mvc').classification, 'candidate');
    assert.equal(discovered.findings.find((f: any) => f.pattern === 'event_driven').classification, 'candidate');
    assert(discovered.dependencies.filter((d: any) => d.kind === 'imports_syntax').every((d: any) => d.to === null));
    assert.equal(discovered.cycleCoverage, 'observed_local_only');
    assert(!JSON.stringify(discovered).includes(f.root));
    assert.deepEqual(await post(`${base}/architecture`), architecture);
    assert.equal((await fetch(`${base}/relationships/files/${file.artifact.artifactId}`)).status, 200);
    assert.equal((await fetch(`${base}/architecture/violations`)).status, 200);
    // A new immutable source analysis gets a new graph, preserving the first one.
    const revisionResponse=await fetch(`${nodeUrl}/api/projects/${imported.projectId}/analysis`,{method:'POST'});assert.equal(revisionResponse.status,202);
    const revision=await revisionResponse.json() as any,revisionBase=`${nodeUrl}/api/projects/${imported.projectId}/analysis/${revision.analysisId}`;
    for(let i=0;i<200;i++){const status=await(await fetch(revisionBase)).json() as any;if(status.status==='completed')break;await new Promise(r=>setTimeout(r,10));}
    await post(`${pythonUrl}/api/v2/metadata/projects/${imported.projectId}/analyses/${revision.analysisId}/extract`);
    await post(`${revisionBase}/resolve`);await post(`${revisionBase}/relationships`);
    const revisionGraph=await post(`${revisionBase}/graph`);assert.notEqual(revisionGraph.snapshotId,graph.snapshotId);
    const revisionStored=await new FileGraphStore(new WorkspaceManagerService(f.storage)).get(imported.projectId,revision.analysisId);
    const oldIds=new Set(stored.nodes.map(n=>n.graphNodeId));assert(revisionStored.nodes.every(n=>!oldIds.has(n.graphNodeId)));
    assert.deepEqual(await(await fetch(`${base}/graph`)).json(),graph);
    child.kill('SIGTERM'); await once(child,'exit');
    // Retrieval and cached POST do not need a running Python service.
    assert.deepEqual(await (await fetch(`${base}/graph`)).json(),graph);
    assert.deepEqual(await post(`${base}/graph`),graph);
    console.log(JSON.stringify({result:'PASS',workflow:'HTTP import -> detection -> AST -> live Python metadata -> symbols -> relationships -> graph -> bounded query/traversal -> reconstructed/offline retrieval; optional architecture remains compatible',files:graph.coverage.length,nodes:graph.nodeCount,edges:graph.edgeCount,candidates:graph.candidateCount,unsupportedFiles:1,newAnalysisPreservesPriorGraph:true,sourceCodeExecuted:false}));
} finally {
    if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await once(child,'exit');}
    server.closeAllConnections(); server.close(); await once(server, 'close'); await f.cleanup();
}
