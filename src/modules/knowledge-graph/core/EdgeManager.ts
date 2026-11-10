import { check } from '../../../shared/validation.js';
import { graphId } from '../contracts.js';
import { reference } from '../../relationship-analysis/validation.js';
import { GRAPH_LIMITS, GraphError, type GraphFile, type GraphEdge, type GraphCandidate, type GraphProvenance, type GraphLimits, type EdgeKind } from '../model.js';
import type { NodeManager } from './NodeManager.js';

const mapping={calls:'CALLS',constructs:'CREATES',reads:'READS',writes:'WRITES',contains:'CONTAINS',extends_syntax:'EXTENDS'} as const;
/** Occurrence preserving mapping. Syntax ownership/heritage guarantees stay explicit. */
export class EdgeManager {
    private readonly edgesById=new Map<string,GraphEdge>();
    private readonly candidatesById=new Map<string,GraphCandidate>();
    constructor(private readonly provenance:GraphProvenance,private readonly nodes:NodeManager,private readonly limits:Readonly<GraphLimits>=GRAPH_LIMITS){}
    addFile(f:GraphFile):void {
        if(!f.relationships)return;
        const artifact=reference(f.relationships).artifactId;
        for(const r of [...f.relationships.relationships].sort((a,b)=>a.relationshipId.localeCompare(b.relationshipId))){
            const source=this.nodes.byEntity.get(r.source.entityId);check(source,'missing relationship source');
            const kind=mapping[r.kind as keyof typeof mapping] as EdgeKind|undefined;
            const target=r.target.entityId?this.nodes.byEntity.get(r.target.entityId):r.target.symbolId?this.nodes.bySymbol.get(r.target.symbolId):undefined;
            const classInitializer=r.source.context==='initializer'&&source.nodeKind==='class';
            const reason=!kind?'UNMAPPED_RELATIONSHIP':r.target.status!=='established'?'TARGET_NOT_ESTABLISHED':classInitializer?'CLASS_INITIALIZER_CONTEXT_UNMODELED':null;
            if(reason){
                const data:Omit<GraphCandidate,'candidateId'>={projectId:this.provenance.projectId,analysisId:this.provenance.analysisId,sourceGraphNodeId:source.graphNodeId,relativePath:f.ast.relativePath,relationshipArtifactId:artifact,relationship:r,reason};
                const candidate={candidateId:graphId('gc',this.provenance,data),...data};
                if(!this.candidatesById.has(candidate.candidateId)&&this.candidatesById.size>=this.limits.maxCandidates)throw new GraphError('GRAPH_CANDIDATE_LIMIT',413);
                this.candidatesById.set(candidate.candidateId,candidate);continue;
            }
            check(target&&kind,'missing established endpoint');
            const guarantee=r.kind==='contains'?'syntactic_ownership':r.kind==='extends_syntax'?'heritage_syntax':'local_semantic';
            const data:Omit<GraphEdge,'graphEdgeId'>={projectId:this.provenance.projectId,analysisId:this.provenance.analysisId,sourceGraphNodeId:source.graphNodeId,targetGraphNodeId:target.graphNodeId,edgeKind:kind,classification:'established',guarantee,relationshipId:r.relationshipId,relationshipArtifactId:artifact,relativePath:f.ast.relativePath,astNodeId:r.astNodeId,range:r.range,sourceContext:r.source,limitations:[...r.limitations].sort()};
            const edge={graphEdgeId:graphId('ge',this.provenance,data),...data};
            if(!this.edgesById.has(edge.graphEdgeId)&&this.edgesById.size>=this.limits.maxEdges)throw new GraphError('GRAPH_EDGE_LIMIT',413);
            this.edgesById.set(edge.graphEdgeId,edge);
        }
    }
    edges():GraphEdge[]{return [...this.edgesById.values()].sort((a,b)=>a.graphEdgeId.localeCompare(b.graphEdgeId));}
    candidates():GraphCandidate[]{return [...this.candidatesById.values()].sort((a,b)=>a.candidateId.localeCompare(b.candidateId));}
}
