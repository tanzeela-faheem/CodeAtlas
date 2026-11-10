import type { Context } from "../core/context.js";
export function detectEvents(c: Context): void {
    const members=[], evidence: string[]=[];
    for(const file of c.input.files){
        const imports=file.relationships.filter(r=>r.kind==='imports_syntax'&&r.syntax.moduleSpecifier&&!r.syntax.moduleSpecifier.truncated&&["'node:events'",'"node:events"',"'events'",'"events"'].includes(r.syntax.moduleSpecifier.tokens.map(t=>t.text).join('')));
        const receivers=new Map<string,{publish:string[];subscribe:string[]}>();
        for(const r of file.relationships.filter(r=>r.kind==='calls')){
            const s=r.syntax.expression;if(!s||s.truncated)continue;const tokens=s.tokens.map(t=>t.text);
            if(tokens.length!==3||tokens[1]!=='.'||!['emit','on','once','addListener'].includes(tokens[2]!))continue;
            const signals=receivers.get(tokens[0]!)??{publish:[],subscribe:[]};receivers.set(tokens[0]!,signals);
            const id=c.evidenceFor({strength:'unresolved',relativePath:file.inputs.sourceAst.relativePath,profileField:null,entityId:r.source.entityId,relationshipId:r.relationshipId,symbolId:r.evidence.bindingSymbolId,astNodeId:r.astNodeId,range:r.range,detail:'Event-like property call; receiver/API identity unresolved'});
            (tokens[2]==='emit'?signals.publish:signals.subscribe).push(id);
        }
        const paired=[...receivers.values()].filter(s=>s.publish.length&&s.subscribe.length);
        if(imports.length&&paired.length){members.push(c.fileComponents.get(file.inputs.sourceAst.relativePath)!);evidence.push(...paired.flatMap(p=>[...p.publish,...p.subscribe]),...imports.map(r=>c.evidenceFor({strength:'unresolved',relativePath:file.inputs.sourceAst.relativePath,profileField:null,entityId:r.source.entityId,relationshipId:r.relationshipId,symbolId:r.evidence.bindingSymbolId,astNodeId:r.astNodeId,range:r.range,detail:'node:events import syntax; import/receiver value flow unverified'})));}
    }
    c.finding('event_driven',members.length?'candidate':'insufficient_evidence',members,evidence,'A node:events import plus publisher/subscriber property syntax on the same textual receiver is a limited candidate signature, not resolved messaging behavior.',['RECEIVER_VALUE_FLOW_UNVERIFIED','DYNAMIC_PROPERTY_API_NOT_RESOLVED','NO_RUNTIME_EVENT_TOPOLOGY']);
}
