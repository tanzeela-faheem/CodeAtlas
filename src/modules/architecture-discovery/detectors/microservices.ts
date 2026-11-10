import type { Context } from "../core/context.js";
export function detectMicroservices(c: Context): void {
    const manifests=c.input.profile.packageManagers.packageManagers.flatMap((p,i)=>p.manifestFiles.map((path,j)=>({path,field:`packageManagers.packageManagers[${i}].manifestFiles[${j}]`,root:path.includes('/')?path.slice(0,path.lastIndexOf('/')):'.'})));
    const roots=[...new Set(manifests.map(m=>m.root))].sort((a,b)=>b.length-a.length||a.localeCompare(b));
    const applications=[];
    for(const root of roots){
        const members=[...c.fileComponents.values()].filter(f=>roots.find(r=>r==='.'||f.name.startsWith(r+'/'))===root);
        const entry=members.filter(f=>/(^|\/)(server|main|app|index)\.(js|jsx|mjs|cjs)$/.test(f.name));
        if(!entry.length)continue;
        const manifest=manifests.find(m=>m.root===root)!;
        const e=[c.hint(`Package root ${root}`,manifest.path,manifest.field),...entry.map(f=>c.hint('Conventional application entry filename; not a proven executable entry point',f.name))];
        applications.push(c.component({name:root,kind:'application_candidate',classification:'candidate',files:members.map(m=>m.name).sort(),entityId:null,entityKind:null,parentId:null,roles:[],evidenceIds:e,limitations:['DEPLOYABILITY_UNVERIFIED','ENTRYPOINT_NAMING_ONLY']}));
    }
    const profile=c.hint(`Monorepo hint: ${c.input.profile.multiLanguage.isMonorepo}`,null,'multiLanguage.isMonorepo');
    const deployments=c.input.profile.structure.configurationFiles.filter(p=>/(^|\/)(Dockerfile|docker-compose\.[^/]+|compose\.[^/]+)$/.test(p)).map(p=>c.hint(`Deployment descriptor path ${p}; content/topology unavailable`,p,'structure.configurationFiles'));
    c.finding('microservices',applications.length>=2?'candidate':'insufficient_evidence',applications,[profile,...applications.flatMap(a=>a.evidenceIds),...deployments],`${roots.length} package roots and ${applications.length} application candidates observed. Packages and monorepo markers do not establish independent deployment.`,['NO_RUNNING_TOPOLOGY','DEPLOYMENT_CONTENT_UNAVAILABLE','MULTIPLE_PACKAGES_NOT_MICROSERVICES']);
}
