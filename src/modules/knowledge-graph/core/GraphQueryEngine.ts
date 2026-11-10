import * as v from '../../../shared/validation.js';
import { graphIdentity } from '../contracts.js';
import { QUERY_LIMIT, NODE_KINDS, EDGE_KINDS, GraphError, type Direction, type EdgeKind, type NodeKind } from '../model.js';
import { GraphIndex } from './GraphIndex.js';
export interface Page {offset:number;limit:number}
export function pagination(o:Record<string,unknown>):Page {
    const offset=o.offset??0,limit=o.limit??50;v.integer(offset,'offset');v.integer(limit,'limit');v.check(offset<=100000&&limit>0&&limit<=QUERY_LIMIT,'pagination bound');return{offset,limit};
}
export function page<T>(items:readonly T[],p:Page){return{items:items.slice(p.offset,p.offset+p.limit),total:items.length,offset:p.offset,limit:p.limit,nextOffset:p.offset+p.limit<items.length?p.offset+p.limit:null};}
const sourceId=(value:unknown,prefix:'meta'|'symbol')=>{v.string(value,'source identity');v.check(new RegExp(`^${prefix}-[a-f0-9]{64}$`).test(value),'source identity');};
export class GraphQueryEngine {
    constructor(readonly index:GraphIndex){}
    node(id:unknown){graphIdentity(id,'gn');const node=this.index.node(id);if(!node)throw new GraphError('GRAPH_NODE_NOT_FOUND',404);return node;}
    nodes(raw:unknown={}){
        const q=v.object(raw,'node query',[],['nodeKind','relativePath','metadataEntityId','symbolId','offset','limit']),p=pagination(q);
        if(q.nodeKind!==undefined)v.member(q.nodeKind,NODE_KINDS,'node kind');if(q.relativePath!==undefined)v.sourcePath(q.relativePath);
        if(q.metadataEntityId!==undefined)sourceId(q.metadataEntityId,'meta');if(q.symbolId!==undefined)sourceId(q.symbolId,'symbol');
        const identity=q.metadataEntityId!==undefined?this.index.entity(q.metadataEntityId as string):q.symbolId!==undefined?this.index.symbol(q.symbolId as string):undefined;
        const pool=q.metadataEntityId!==undefined||q.symbolId!==undefined?identity?[identity]:[]:q.relativePath!==undefined?this.index.source(q.relativePath as string):q.nodeKind!==undefined?this.index.kind(q.nodeKind as NodeKind):this.index.nodes;
        return page(pool.filter(n=>(q.nodeKind===undefined||n.nodeKind===q.nodeKind)&&(q.relativePath===undefined||n.relativePath===q.relativePath)&&(q.metadataEntityId===undefined||n.metadataEntityId===q.metadataEntityId)&&(q.symbolId===undefined||n.symbolId===q.symbolId)),p);
    }
    edges(raw:unknown={}){
        const q=v.object(raw,'edge query',[],['nodeId','direction','edgeKind','offset','limit']),p=pagination(q);
        if(q.direction!==undefined)v.member(q.direction,['incoming','outgoing','both'],'direction');if(q.edgeKind!==undefined)v.member(q.edgeKind,EDGE_KINDS,'edge kind');
        if(q.direction!==undefined)v.check(q.nodeId!==undefined,'direction requires node');
        const pool=q.nodeId!==undefined?this.index.connected(this.node(q.nodeId).graphNodeId,(q.direction??'both') as Direction,q.edgeKind?[q.edgeKind as EdgeKind]:undefined):q.edgeKind?this.index.edgeKind(q.edgeKind as EdgeKind):this.index.edges;
        return page(pool,p);
    }
    neighbors(id:unknown,raw:unknown={}){
        const node=this.node(id),q=v.object(raw,'neighbor query',[],['direction','edgeKind','offset','limit']),p=pagination(q);
        if(q.direction!==undefined)v.member(q.direction,['incoming','outgoing','both'],'direction');if(q.edgeKind!==undefined)v.member(q.edgeKind,EDGE_KINDS,'edge kind');
        const edges=this.index.connected(node.graphNodeId,(q.direction??'outgoing') as Direction,q.edgeKind?[q.edgeKind as EdgeKind]:undefined);
        const result=page(edges,p);return{...result,items:result.items.map(edge=>({edge,node:this.index.node(edge.sourceGraphNodeId===node.graphNodeId?edge.targetGraphNodeId:edge.sourceGraphNodeId)!}))};
    }
    candidates(raw:unknown={}){
        const q=v.object(raw,'candidate query',[],['nodeId','relativePath','targetStatus','offset','limit']),p=pagination(q);
        if(q.nodeId!==undefined)this.node(q.nodeId);if(q.relativePath!==undefined)v.sourcePath(q.relativePath);if(q.targetStatus!==undefined)v.member(q.targetStatus,['established','unresolved','ambiguous','deferred','unsupported','invalid'],'candidate target status');
        return page(this.index.candidates.filter(c=>(q.nodeId===undefined||c.sourceGraphNodeId===q.nodeId)&&(q.relativePath===undefined||c.relativePath===q.relativePath)&&(q.targetStatus===undefined||c.relationship.target.status===q.targetStatus)),p);
    }
}
