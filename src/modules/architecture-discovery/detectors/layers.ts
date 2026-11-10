import type { Context } from "../core/context.js";
import type { Role } from "../model.js";
const segments: Record<Role, string[]> = { presentation: ["controllers", "controller", "views", "view", "routes", "ui"], application: ["services", "service", "application", "usecases"], domain: ["domain", "models", "entities"], infrastructure: ["infrastructure", "adapters"], persistence: ["repositories", "repository", "persistence"], integration: ["integration", "clients", "ports"] };
const names: Record<Role, RegExp> = { presentation: /(Controller|View|Router)$/, application: /(Service|UseCase)$/, domain: /(Model|Entity)$/, infrastructure: /Adapter$/, persistence: /Repository$/, integration: /(Client|Port)$/ };
export function detectLayers(c: Context): void {
    for (const [path, component] of c.fileComponents) {
        const parts = path.split('/').slice(0,-1).map(p => p.toLowerCase());
        for (const role of Object.keys(segments) as Role[]) {
            const evidence: string[] = [];
            if (parts.some(p => segments[role].includes(p))) evidence.push(c.hint(`Directory naming suggests ${role}`, path));
            for (const file of c.input.files.filter(f => f.inputs.sourceAst.relativePath === path)) for (const e of file.metadata.entities) if (e.name && ['class','function','method'].includes(e.kind) && names[role].test(e.name)) evidence.push(c.entityComponents.get(e.entityId)!.evidenceIds[0]!);
            if (evidence.length) component.roles.push({ role, classification: 'candidate', evidenceIds: [...new Set(evidence)].sort() });
        }
        component.limitations.push(...(component.roles.length > 1 ? ['MIXED_ROLE_SIGNALS'] : component.roles.length ? ['NAMING_DOES_NOT_ESTABLISH_LAYER'] : ['UNKNOWN_LAYER_ROLE']));
    }
    const layers = [];
    for (const role of Object.keys(segments) as Role[]) {
        const members = [...c.fileComponents.values()].filter(f => f.roles.some(r => r.role === role));
        if (members.length) layers.push(c.component({ name: role, kind: 'layer', classification: 'candidate', files: members.flatMap(m => m.files).sort(), entityId: null, entityKind: null, parentId: null, roles: [], evidenceIds: [...new Set(members.flatMap(m => m.roles.filter(r => r.role === role).flatMap(r => r.evidenceIds)))].sort(), limitations: ['LAYER_MEMBERSHIP_HEURISTIC'] }));
    }
    c.finding('layers', layers.length ? 'candidate' : 'insufficient_evidence', layers, layers.flatMap(l => l.evidenceIds), layers.length ? 'Naming and declaration signals suggest candidate layers; dependency enforcement is not established.' : 'No supported layer-role signals were found in available evidence.', ['NO_VERIFIED_CROSS_FILE_DIRECTION', ...(c.input.coverage.some(f => f.status !== 'available') ? ['PARTIAL_COVERAGE'] : [])], [...c.fileComponents.values()].filter(f => f.roles.length > 1).flatMap(f => f.roles.flatMap(r => r.evidenceIds)));
}
