import { validateGraph } from '../validation.js';
import type { GraphDocument, GraphNode, GraphEdge, GraphCandidate, GraphSnapshot, NodeKind, EdgeKind, Direction } from '../model.js';
function freeze<T>(value:T):T {
    if(value!==null&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const item of Object.values(value))freeze(item);}
    return value;
}
const add=<T>(map:Map<string,T[]>,key:string,item:T)=>{const values=map.get(key);if(values)values.push(item);else map.set(key,[item]);};
/** Captured immutable records prevent stale entries when callers mutate their original document. */
export class GraphIndex {
    readonly snapshot:GraphSnapshot;
    readonly nodes:readonly GraphNode[];
    readonly edges:readonly GraphEdge[];
    readonly candidates:readonly GraphCandidate[];
    private readonly byId=new Map<string,GraphNode>();
    private readonly byEntity=new Map<string,GraphNode>();
    private readonly bySymbol=new Map<string,GraphNode>();
    private readonly byKind=new Map<string,GraphNode[]>();
    private readonly bySource=new Map<string,GraphNode[]>();
    private readonly outgoing=new Map<string,GraphEdge[]>();
    private readonly incoming=new Map<string,GraphEdge[]>();
    private readonly edgesByKind=new Map<string,GraphEdge[]>();
    constructor(document:GraphDocument){
        validateGraph(document);
        const copy=freeze(structuredClone({snapshot:document.snapshot,nodes:document.nodes,edges:document.edges,candidates:document.candidates}));
        this.snapshot=copy.snapshot;this.nodes=copy.nodes;this.edges=copy.edges;this.candidates=copy.candidates;
        for(const n of this.nodes){this.byId.set(n.graphNodeId,n);if(n.metadataEntityId)this.byEntity.set(n.metadataEntityId,n);if(n.symbolId)this.bySymbol.set(n.symbolId,n);add(this.byKind,n.nodeKind,n);add(this.bySource,n.relativePath,n);}
        for(const e of this.edges){add(this.outgoing,e.sourceGraphNodeId,e);add(this.incoming,e.targetGraphNodeId,e);add(this.edgesByKind,e.edgeKind,e);}
        for(const map of [this.byKind,this.bySource,this.outgoing,this.incoming,this.edgesByKind])for(const values of map.values())Object.freeze(values);
    }
    node(id:string):GraphNode|undefined{return this.byId.get(id);}
    entity(id:string):GraphNode|undefined{return this.byEntity.get(id);}
    symbol(id:string):GraphNode|undefined{return this.bySymbol.get(id);}
    kind(kind:NodeKind):readonly GraphNode[]{return this.byKind.get(kind)??[];}
    source(path:string):readonly GraphNode[]{return this.bySource.get(path)??[];}
    edgeKind(kind:EdgeKind):readonly GraphEdge[]{return this.edgesByKind.get(kind)??[];}
    connected(id:string,direction:Direction='outgoing',kinds?:readonly EdgeKind[]):GraphEdge[]{
        const selected=direction==='outgoing'?[...(this.outgoing.get(id)??[])]:direction==='incoming'?[...(this.incoming.get(id)??[])]:[...new Map([...(this.outgoing.get(id)??[]),...(this.incoming.get(id)??[])].map(e=>[e.graphEdgeId,e])).values()];
        return selected.filter(e=>!kinds||kinds.includes(e.edgeKind)).sort((a,b)=>a.graphEdgeId.localeCompare(b.graphEdgeId));
    }
}
