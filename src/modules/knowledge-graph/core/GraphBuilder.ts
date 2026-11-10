import { graphId, graphProvenance, validateGraphInput, contractContext } from '../contracts.js';
import { GRAPH_VERSION, GRAPH_LIMITS, GraphError, graphCheckpoint, type GraphInput, type GraphDocument, type GraphCoverage, type GraphLimits } from '../model.js';
import { NodeManager } from './NodeManager.js';
import { EdgeManager } from './EdgeManager.js';

export function buildGraph(input:GraphInput,limits:Readonly<GraphLimits>=GRAPH_LIMITS,deadline=Date.now()+limits.maxDurationMs):GraphDocument {
    validateGraphInput(input,limits,deadline);graphCheckpoint(deadline);
    // Normalize arrays whose upstream order is not identity, without mutating authoritative snapshots.
    const evidence:GraphInput={...input,files:[...input.files].sort((a,b)=>a.ast.relativePath.localeCompare(b.ast.relativePath)),gaps:[...input.gaps].sort((a,b)=>(a.relativePath+':'+a.stage).localeCompare(b.relativePath+':'+b.stage))};
    const context=contractContext(input),provenance=context.provenance,snapshotId=graphId('gs',provenance,null);
    const nodes=new NodeManager(provenance,limits);for(const f of evidence.files){graphCheckpoint(deadline);nodes.addFile(f,context.source.get(f.ast.relativePath)!.artifact!.artifactId);}
    const edges=new EdgeManager(provenance,nodes,limits);for(const f of evidence.files){graphCheckpoint(deadline);edges.addFile(f);}
    const nodeList=nodes.nodes(),edgeList=edges.edges(),candidates=edges.candidates(),files=new Map(input.files.map(f=>[f.ast.relativePath,f]));
    const coverage:GraphCoverage[]=[...input.source.files].sort((a,b)=>a.relativePath.localeCompare(b.relativePath)).map(s=>{
        const path=s.relativePath,f=files.get(path),m=context.metadata.get(path)!,r=context.resolution.get(path)!,a=context.relationships.get(path)!;
        const gaps=input.gaps.filter(g=>g.relativePath===path);
        return {relativePath:path,sourceStatus:s.status,metadataStatus:m.status,resolutionStatus:r.status,relationshipStatus:a.status,status:gaps.some(g=>g.code==='GRAPH_INPUT_INCOMPATIBLE')?'failed':!f?(m.status==='unsupported'||r.status==='unsupported'||a.status==='unsupported'?'unsupported':'unavailable'):gaps.length||!f.resolution||!f.relationships||m.status!=='complete'||r.status!=='complete'||a.status!=='complete'?'partial':'available',codes:[...new Set([...(s.code?[s.code]:[]),...m.diagnostics.map(d=>d.code),...(r.code?[r.code]:[]),...(a.code?[a.code]:[]),...gaps.map(g=>g.code)])].sort()};
    });
    const countsByNodeKind:GraphDocument['snapshot']['countsByNodeKind']=Object.create(null),countsByEdgeKind:GraphDocument['snapshot']['countsByEdgeKind']=Object.create(null);
    for(const n of nodeList)countsByNodeKind[n.nodeKind]=(countsByNodeKind[n.nodeKind]??0)+1;
    for(const e of edgeList)countsByEdgeKind[e.edgeKind]=(countsByEdgeKind[e.edgeKind]??0)+1;
    const doc:GraphDocument={snapshot:{schemaVersion:1,graphBuilderVersion:GRAPH_VERSION,snapshotId,...provenance,createdAt:input.relationshipAnalysis.completedAt??input.source.completedAt??input.source.startedAt,executionStatus:input.gaps.length?'completed_with_errors':'completed',evidenceCoverage:coverage.length&&!nodeList.length?'insufficient':coverage.some(c=>c.status!=='available')||candidates.length?'partial':'supported_subset',nodeCount:nodeList.length,edgeCount:edgeList.length,candidateCount:candidates.length,countsByNodeKind,countsByEdgeKind,coverage,diagnostics:[{code:'OBSERVED_STATIC_GRAPH_ONLY',relativePath:null,message:'Local semantic and qualified syntactic edges only. No cross-file linking, runtime execution, inferred types or established architecture patterns.'},...input.gaps.map(g=>({code:g.code,relativePath:g.relativePath,message:`Unavailable or invalid ${g.stage} input; unaffected verified evidence retained.`})).sort((a,b)=>(a.relativePath+a.message).localeCompare(b.relativePath+b.message))],storage:{artifact:`${snapshotId}.graph.json`,index:'derived_in_memory'}},nodes:nodeList,edges:edgeList,candidates,evidence};
    if(Buffer.byteLength(JSON.stringify(doc))>limits.maxBytes)throw new GraphError('GRAPH_STORAGE_LIMIT',413);
    graphCheckpoint(deadline);return doc;
}
