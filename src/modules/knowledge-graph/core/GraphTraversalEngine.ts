import * as v from '../../../shared/validation.js';
import { graphIdentity } from '../contracts.js';
import { TRAVERSAL_LIMITS, EDGE_KINDS, GraphError, type GraphEdge, type Direction, type EdgeKind } from '../model.js';
import type { GraphIndex } from './GraphIndex.js';
export interface TraversalOptions {startNodeId:string;algorithm:'bfs'|'dfs';direction:Direction;edgeKinds:EdgeKind[];maxDepth:number;maxNodes:number;maxEdges:number}
export function traversalOptions(raw:unknown):TraversalOptions {
    const q=v.object(raw,'traversal',['startNodeId'],['algorithm','direction','edgeKinds','maxDepth','maxNodes','maxEdges']);graphIdentity(q.startNodeId,'gn');
    const result={startNodeId:q.startNodeId,algorithm:q.algorithm??'bfs',direction:q.direction??'outgoing',edgeKinds:q.edgeKinds??[...EDGE_KINDS],maxDepth:q.maxDepth??10,maxNodes:q.maxNodes??1000,maxEdges:q.maxEdges??2000};
    v.member(result.algorithm,['bfs','dfs'],'algorithm');v.member(result.direction,['incoming','outgoing','both'],'direction');v.array(result.edgeKinds,'edge kinds',EDGE_KINDS.length);v.check(result.edgeKinds.length>0&&new Set(result.edgeKinds).size===result.edgeKinds.length,'traversal edge kinds');result.edgeKinds.forEach(k=>v.member(k,EDGE_KINDS,'edge kind'));
    for(const key of ['maxDepth','maxNodes','maxEdges'] as const){v.integer(result[key],key);v.check(result[key]<=TRAVERSAL_LIMITS[key]&&(key==='maxDepth'||result[key]>0),'traversal bounds');}
    return result as TraversalOptions;
}
export class GraphTraversalEngine {
    constructor(private readonly index:GraphIndex){}
    traverse(raw:unknown){
        const q=traversalOptions(raw);if(!this.index.node(q.startNodeId))throw new GraphError('GRAPH_NODE_NOT_FOUND',404);
        const visited=new Map<string,number>([[q.startNodeId,0]]),edges=new Map<string,GraphEdge>(),reached=new Set<'maxDepth'|'maxNodes'|'maxEdges'>();
        const adjacent=(id:string)=>this.index.connected(id,q.direction,q.edgeKinds).map(edge=>({edge,id:edge.sourceGraphNodeId===id?edge.targetGraphNodeId:edge.sourceGraphNodeId})).sort((a,b)=>a.id.localeCompare(b.id)||a.edge.graphEdgeId.localeCompare(b.edge.graphEdgeId));
        type Neighbor=ReturnType<typeof adjacent>[number];
        const inspect=(next:Neighbor,depth:number):'stop'|'skip'|'visit'=>{
            if(depth>=q.maxDepth){if(!visited.has(next.id))reached.add('maxDepth');return 'skip';}
            if(!edges.has(next.edge.graphEdgeId)&&edges.size>=q.maxEdges){reached.add('maxEdges');return 'stop';}
            if(!visited.has(next.id)&&visited.size>=q.maxNodes){reached.add('maxNodes');return 'stop';}
            edges.set(next.edge.graphEdgeId,next.edge);
            if(visited.has(next.id))return 'skip';
            visited.set(next.id,depth+1);return 'visit';
        };
        if(q.algorithm==='bfs'){
            const queue=[q.startNodeId];let stop=false;
            for(let head=0;head<queue.length&&!stop;head++){const id=queue[head]!,depth=visited.get(id)!;for(const next of adjacent(id)){const action=inspect(next,depth);if(action==='stop'){stop=true;break;}if(action==='visit')queue.push(next.id);}}
        }else{
            const stack=[{id:q.startNodeId,depth:0,neighbors:adjacent(q.startNodeId),position:0}];
            while(stack.length){const top=stack.at(-1)!,next=top.neighbors[top.position++];if(!next){stack.pop();continue;}const action=inspect(next,top.depth);if(action==='stop')break;if(action==='visit')stack.push({id:next.id,depth:top.depth+1,neighbors:adjacent(next.id),position:0});}
        }
        return{snapshotId:this.index.snapshot.snapshotId,algorithm:q.algorithm,startNodeId:q.startNodeId,direction:q.direction,nodeIds:[...visited.keys()],depths:[...visited].map(([nodeId,depth])=>({nodeId,depth})),edges:[...edges.values()],truncated:reached.size>0,limitsReached:[...reached].sort()};
    }
}
