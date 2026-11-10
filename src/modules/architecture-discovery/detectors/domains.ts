import type { Context } from "../core/context.js";
export function detectDomains(c: Context): void {
    const groups=new Map<string,string[]>();
    for(const path of c.fileComponents.keys()){
        const m=/(?:^|\/)(?:modules|domains)\/([^/]+)\//.exec(path);
        if(!m||['shared','common','utils','infrastructure','integration','config'].includes(m[1]!.toLowerCase()))continue;
        groups.set(m[1]!,[...(groups.get(m[1]!)??[]),path]);
    }
    const components=[];
    for(const [name,files]of [...groups].sort(([a],[b])=>a.localeCompare(b))){
        const normalized=name.toLowerCase().replace(/[-_]/g,'');
        const declarations=[...c.entityComponents.values()].filter(e=>e.files.some(f=>files.includes(f))&&['class','function'].includes(e.entityKind??'')&&e.name.toLowerCase().startsWith(normalized));
        if(files.length<2||declarations.length<2)continue;
        const e=[c.hint(`Explicit module/domain group ${name}; business semantics unknown`,null,'languages.sourceFiles'),...declarations.flatMap(d=>d.evidenceIds)];
        components.push(c.component({name,kind:'domain_candidate',classification:'candidate',files:files.sort(),entityId:null,entityKind:null,parentId:null,roles:[],evidenceIds:e,limitations:['BUSINESS_CAPABILITY_UNVERIFIED','CROSS_FILE_COHESION_UNVERIFIED']}));
    }
    c.finding('domain_boundaries',components.length?'candidate':'insufficient_evidence',components,components.flatMap(c=>c.evidenceIds),'Groups require an explicit modules/domains path boundary, multiple files and matching declaration-name prefixes. Cross-cutting/unknown files remain unassigned.',['NO_BUSINESS_SEMANTICS_INFERRED','NO_VERIFIED_CROSS_FILE_COHESION']);
}
