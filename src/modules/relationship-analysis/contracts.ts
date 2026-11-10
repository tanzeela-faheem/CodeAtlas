import type { AstDocument } from "../ast-management/model.js";
import type { MetadataDocument, ResolutionDocument, ResolutionReference } from "../symbol-resolution/model.js";
import { digest, matchEvidence } from "../symbol-resolution/integration/contracts.js";
import { validateResolutionDocument, validateResolutionReference, resolutionReference } from "../symbol-resolution/validation.js";
import { check, hash } from "../../shared/validation.js";
import type { RelationshipInputs, RelationshipRecord } from "./model.js";
import { RelationshipError } from "./model.js";
export interface FileEvidence {
    ast: AstDocument; metadata: MetadataDocument; resolution: ResolutionDocument;
    resolutionArtifact: ResolutionReference; sourceAnalysisHash: string; metadataAnalysisHash: string; resolutionAnalysisHash: string;
}
export function inputsFor(e: FileEvidence): RelationshipInputs {
    return { sourceAst: e.resolution.sourceAst, astArtifactId: e.resolution.astArtifactId,
        metadataArtifact: e.resolution.metadataArtifact, resolutionArtifact: e.resolutionArtifact,
        resolverVersion: e.resolution.resolverVersion, sourceAnalysisHash: e.sourceAnalysisHash,
        metadataAnalysisHash: e.metadataAnalysisHash, resolutionAnalysisHash: e.resolutionAnalysisHash };
}
const same = (a: unknown, b: unknown) => digest(a) === digest(b);
/** Validate cross-module evidence, without building another symbol table or performing name lookup. */
export function matchInputs(e: FileEvidence): void {
    try {
        const { ast, metadata, resolution: r, resolutionArtifact: ref } = e;
        hash(e.sourceAnalysisHash); hash(e.metadataAnalysisHash); hash(e.resolutionAnalysisHash);
        matchEvidence(ast, metadata, r.metadataArtifact);
        validateResolutionDocument(r); validateResolutionReference(ref);
        check(same(resolutionReference(r), ref), "resolution artifact identity/checksum");
        check(same(r.sourceAst, metadata.sourceAst), "resolution AST provenance");
        check(same(r.astDiagnostics, ast.diagnostics) && same(r.metadataDiagnostics, metadata.diagnostics), "lost upstream diagnostics");
        const nodes = new Map(ast.nodes.map(n => [n.id, n])), entities = new Map(metadata.entities.map(m => [m.entityId, m]));
        const actualRange = (id: string, range: unknown) => { const n = nodes.get(id); check(n && same(range, { start: n.start, end: n.end }), "AST node/range mismatch"); return n; };
        for (const scope of r.scopes) actualRange(scope.astNodeId, scope.range);
        for (const s of r.symbols) {
            const binding = nodes.get(s.bindingNodeId); check(binding && binding.text === s.name, "binding node/name");
            for (const d of s.declarations) {
                const owner = actualRange(d.astNodeId, d.range);
                if (d.metadataEntityId !== null) {
                    const entity = entities.get(d.metadataEntityId);
                    check(entity && entity.sourceRange.start.offset >= owner.start.offset && entity.sourceRange.end.offset <= owner.end.offset, "declaration metadata mapping");
                    check(entity.name === s.name || entity.kind === "parameter", "declaration metadata name");
                } else check(s.kind === "catch", "unsupported AST-only evidence");
            }
        }
        const seen = new Set<string>();
        for (const reference of r.references) {
            const n = actualRange(reference.astNodeId, reference.range);
            check(n.text === reference.name && !seen.has(n.id), "reference occurrence/name"); seen.add(n.id);
        }
        for (const diagnostic of r.diagnostics) if (diagnostic.astNodeId !== null) check(nodes.has(diagnostic.astNodeId), "resolution diagnostic node");
        for (const ref of r.references) for (const diagnostic of ref.diagnostics) if (diagnostic.astNodeId !== null) check(nodes.has(diagnostic.astNodeId), "reference diagnostic node");
    } catch { throw new RelationshipError("RELATIONSHIP_INPUT_INCOMPATIBLE"); }
}
export function relationshipId(inputs: RelationshipInputs, record: Omit<RelationshipRecord, "relationshipId">): string {
    return `rel-${digest(["javascript-relationships-v1", inputs, record])}`;
}
