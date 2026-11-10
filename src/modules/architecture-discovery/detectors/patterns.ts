import type { Context } from "../core/context.js";
import type { Component, Role } from "../model.js";
const withRole = (c: Context, role: Role) => [...c.fileComponents.values()].filter(f=>f.roles.some(r=>r.role===role));
const evidence = (files: Component[]) => files.flatMap(f=>f.roles.flatMap(r=>r.evidenceIds));
export function detectMvc(c: Context): void {
    const controllers = [...c.fileComponents.values()].filter(f=>/(^|\/)controllers?\//i.test(f.name) || f.roles.some(r=>r.role==='presentation' && r.evidenceIds.some(id=>c.evidence.find(e=>e.id===id)?.strength==='syntactic')));
    const models = withRole(c,'domain');
    const views = [...c.fileComponents.values()].filter(f=>/(^|\/)(views?|templates?|ui)\//i.test(f.name));
    const members=[...controllers,...models,...views], complete=controllers.length>0&&models.length>0&&views.length>0;
    const framework = c.input.profile.frameworks.frameworks.map((f,i)=>c.hint(`Framework marker ${f.name} is not proof of MVC`,null,`frameworks.frameworks[${i}]`));
    c.finding('mvc',complete?'candidate':'insufficient_evidence',members,[...evidence(members),...framework],complete?'Controller/model/view-like groups coexist; verified MVC interactions are unavailable.':'Controller, model and view evidence is incomplete; a framework or one role alone does not establish MVC.',['MVC_INTERACTIONS_UNVERIFIED','FRAMEWORK_NOT_ARCHITECTURE'],members.filter(m=>m.roles.length>1).flatMap(m=>m.roles.flatMap(r=>r.evidenceIds)));
}
export function detectClean(c: Context): void {
    const domain=withRole(c,'domain'),application=withRole(c,'application'),infra=[...withRole(c,'infrastructure'),...withRole(c,'persistence')];
    const members=[...domain,...application,...infra];
    c.finding('clean',domain.length&&application.length&&infra.length?'candidate':'insufficient_evidence',members,evidence(members),'Conceptual boundary hints are evaluated independently from explicit dependency rules; directory layout cannot validate the Dependency Rule.',['CROSS_FILE_DEPENDENCY_RULE_INDETERMINATE','NO_DEFAULT_UNIVERSAL_RULES'],members.filter(m=>m.roles.length>1).flatMap(m=>m.roles.flatMap(r=>r.evidenceIds)));
}
export function detectHexagonal(c: Context): void {
    const core=[...withRole(c,'domain'),...withRole(c,'application')],ports=[...c.fileComponents.values()].filter(f=>/(^|\/)ports?\//i.test(f.name)),adapters=[...c.fileComponents.values()].filter(f=>/(^|\/)adapters?\//i.test(f.name));
    const members=[...core,...ports,...adapters];
    const hints=[...evidence(core),...ports.map(p=>c.hint('Port-like structural boundary',p.name)),...adapters.map(p=>c.hint('Adapter-like structural boundary',p.name))];
    c.finding('hexagonal',core.length&&ports.length&&adapters.length?'candidate':'insufficient_evidence',members,hints,'Core/port/adapter groups are structural candidates; JavaScript metadata does not prove port contracts or dependency inversion.',['INTERFACE_CONFORMANCE_UNSUPPORTED','DEPENDENCY_INVERSION_UNVERIFIED']);
}
