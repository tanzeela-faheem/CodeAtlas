import { digest } from "../../symbol-resolution/integration/contracts.js";
import { DEFAULT_LIMITS, VERSION, ArchitectureError, type ArchitectureAnalysis, type Component, type DiscoveryInput, type Evidence, type Finding, type Limits, type Pattern } from "../model.js";
export const stableId = (prefix: string, seed: unknown, value: unknown): string => `${prefix}-${digest([VERSION, seed, value])}`;
export class Context {
    readonly components: Component[] = []; readonly evidence: Evidence[] = []; readonly findings: Finding[] = [];
    private readonly evidenceIds = new Set<string>();
    readonly fileComponents = new Map<string, Component>(); readonly entityComponents = new Map<string, Component>();
    constructor(readonly input: DiscoveryInput, readonly limits: Readonly<Limits> = DEFAULT_LIMITS, readonly deadline = Date.now() + limits.maxDurationMs) {}
    checkpoint(): void { if (Date.now() > this.deadline) throw new ArchitectureError("ARCHITECTURE_TIME_BUDGET", 503); }
    evidenceFor(data: Omit<Evidence, "id">): string {
        const id = stableId("ae", this.input.provenance, data);
        if (!this.evidenceIds.has(id)) { this.evidenceIds.add(id); this.evidence.push({ id, ...data }); }
        return id;
    }
    hint(detail: string, path: string | null, profileField: string | null = null): string { return this.evidenceFor({ strength: "structural", relativePath: path, profileField, entityId: null, relationshipId: null, symbolId: null, astNodeId: null, range: null, detail }); }
    component(data: Omit<Component, "id">): Component {
        if (this.components.length >= this.limits.maxComponents) throw new ArchitectureError("ARCHITECTURE_RESOURCE_LIMIT", 413);
        const c = { id: stableId("ac", this.input.provenance, [data.kind, data.name, data.files, data.entityId]), ...data }; this.components.push(c); return c;
    }
    finding(pattern: Pattern, classification: Finding["classification"], components: Component[], evidence: string[], explanation: string, limitations: string[], contradictions: string[] = []): Finding {
        if (this.findings.length >= this.limits.maxFindings) throw new ArchitectureError("ARCHITECTURE_RESOURCE_LIMIT", 413);
        const data = { pattern, classification, componentIds: [...new Set(components.map(c => c.id))].sort(), supportingEvidenceIds: [...new Set(evidence)].sort(), contradictingEvidenceIds: [...new Set(contradictions)].sort(), explanation, limitations: [...new Set(limitations)].sort(), detectorVersion: `${VERSION}/${pattern}` };
        const finding = { id: stableId("af", this.input.provenance, data), ...data }; this.findings.push(finding); return finding;
    }
    initialize(): void {
        for (const file of [...this.input.coverage].sort((a,b) => a.relativePath.localeCompare(b.relativePath))) {
            const e = this.hint("Source inventory membership", file.relativePath, "languages.sourceFiles");
            const c = this.component({ name: file.relativePath, kind: "file", classification: "established", files: [file.relativePath], entityId: null, entityKind: null, parentId: null, roles: [], evidenceIds: [e], limitations: file.status === "available" ? [] : ["SEMANTIC_EVIDENCE_UNAVAILABLE"] }); this.fileComponents.set(file.relativePath, c);
        }
        for (const file of this.input.files) for (const entity of file.metadata.entities) {
            const path = file.inputs.sourceAst.relativePath;
            const evidence = this.evidenceFor({ strength: "syntactic", relativePath: path, profileField: null, entityId: entity.entityId, relationshipId: null, symbolId: null, astNodeId: entity.astNodeId, range: entity.sourceRange, detail: `${entity.kind} declaration${entity.name ? ': ' + entity.name : ''}` });
            const c = this.component({ name: entity.name ?? entity.kind, kind: "entity", classification: "established", files: [path], entityId: entity.entityId, entityKind: entity.kind, parentId: null, roles: [], evidenceIds: [evidence], limitations: [] }); this.entityComponents.set(entity.entityId, c);
        }
        for (const file of this.input.files) for (const e of file.metadata.entities) {
            const c = this.entityComponents.get(e.entityId)!; c.parentId = e.parentEntityId ? this.entityComponents.get(e.parentEntityId)!.id : this.fileComponents.get(e.relativePath)!.id;
        }
    }
}
export function portableProfile(profile: DiscoveryInput["profile"]): unknown {
    const { repositoryPath: _, ...p } = profile;
    return { ...p, languages: { ...p.languages, sourceFiles: p.languages.sourceFiles.map(({ absolutePath: __, ...file }) => file) } };
}
