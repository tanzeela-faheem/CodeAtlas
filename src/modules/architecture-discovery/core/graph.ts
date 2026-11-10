import { ArchitectureError, type Cycle, type Dependency } from "../model.js";
import { stableId, type Context } from "./context.js";
/** Iterative Kosaraju SCC over established dependency edges only; no recursion or guessed targets. */
export function detectCycles(nodes: string[], dependencies: Dependency[], seed: unknown, maxNodes=25000, maxEdges=50000): Cycle[] {
    if(nodes.length>maxNodes||dependencies.length>maxEdges)throw new ArchitectureError('ARCHITECTURE_GRAPH_LIMIT',413);
    const vertices=[...new Set(nodes)].sort(); if(vertices.length!==nodes.length)throw new ArchitectureError('ARCHITECTURE_INPUT_INCOMPATIBLE');
    const forward=new Map(vertices.map(n=>[n,[] as string[]])),reverse=new Map(vertices.map(n=>[n,[] as string[]]));
    const edges=dependencies.filter(d=>d.classification==='established');
    for(const e of edges){if(e.kind==='imports_syntax'||e.targetStatus!=='established')throw new ArchitectureError('ARCHITECTURE_INPUT_INCOMPATIBLE');if(!e.to||!forward.has(e.from)||!forward.has(e.to))throw new ArchitectureError('ARCHITECTURE_INPUT_INCOMPATIBLE');forward.get(e.from)!.push(e.to);reverse.get(e.to)!.push(e.from);}
    for(const map of [forward,reverse])for(const adjacency of map.values())adjacency.sort();
    const seen=new Set<string>(),order:string[]=[];
    for(const root of vertices){if(seen.has(root))continue;seen.add(root);const stack=[{node:root,index:0}];while(stack.length){const top=stack.at(-1)!,next=forward.get(top.node)![top.index++];if(next===undefined){order.push(top.node);stack.pop();}else if(!seen.has(next)){seen.add(next);stack.push({node:next,index:0});}}}
    const assigned=new Set<string>(),groups:string[][]=[];
    for(const root of order.reverse()){if(assigned.has(root))continue;const group:string[]=[],stack=[root];assigned.add(root);while(stack.length){const current=stack.pop()!;group.push(current);for(const next of reverse.get(current)!)if(!assigned.has(next)){assigned.add(next);stack.push(next);}}groups.push(group.sort());}
    const groupOf=new Map(groups.flatMap((g,i)=>g.map(n=>[n,i] as const))),internal=new Map<number,Dependency[]>();
    for(const edge of edges)if(groupOf.get(edge.from)===groupOf.get(edge.to!)){const g=groupOf.get(edge.from)!;let group=internal.get(g);if(!group)internal.set(g,group=[]);group.push(edge);}
    return groups.flatMap((group,i)=>{const supporting=internal.get(i)??[];if(group.length===1&&!supporting.some(e=>e.from===e.to))return[];const data={componentIds:group,dependencyIds:supporting.map(e=>e.id).sort(),selfLoop:group.length===1,scope:'established_local_declarations' as const};return[{id:stableId('acy',seed,data),...data}];}).sort((a,b)=>a.componentIds.join().localeCompare(b.componentIds.join()));
}
export function buildDependencies(c:Context):Dependency[]{
    const result:Dependency[]=[];
    for(const file of c.input.files)for(const r of file.relationships){
        if(!['calls','constructs','imports_syntax'].includes(r.kind))continue;
        const from=c.entityComponents.get(r.source.entityId);if(!from)throw new ArchitectureError('ARCHITECTURE_INPUT_INCOMPATIBLE');
        const target=r.target.entityId?c.entityComponents.get(r.target.entityId):undefined;
        const established=r.kind!=='imports_syntax'&&r.target.status==='established'&&r.classification==='verified_local'&&!!target;
        const e=c.evidenceFor({strength:established?'semantic':'unresolved',relativePath:file.inputs.sourceAst.relativePath,profileField:null,entityId:r.source.entityId,relationshipId:r.relationshipId,symbolId:r.target.symbolId??r.evidence.bindingSymbolId,astNodeId:r.astNodeId,range:r.range,detail:established?'Established local declaration target; execution is not proven':'Unestablished target; no module path linking performed'});
        const data:Omit<Dependency,'id'>={from:from.id,to:established?target!.id:null,kind:r.kind as Dependency['kind'],classification:established?'established':r.target.status==='unresolved'||r.target.status==='ambiguous'?'unresolved':r.target.status==='unsupported'||r.target.status==='invalid'?'unsupported':'candidate',targetStatus:r.target.status,evidenceIds:[e]};
        result.push({id:stableId('ad',c.input.provenance,[r.relationshipId,data]),...data});if(result.length>c.limits.maxDependencies)throw new ArchitectureError('ARCHITECTURE_GRAPH_LIMIT',413);
    }
    return result.sort((a,b)=>a.id.localeCompare(b.id));
}
