import { expect, it } from "vitest";
import { matchInputs, relationshipId } from "../contracts.js";
import { JavascriptRelationshipAnalyzer } from "../languages/javascript.js";
import { validateRelationshipDocument } from "../validation.js";
import { evidence } from "./test-helpers.js";
it('matches complete AST, metadata and resolution snapshots and rejects changed provenance/node evidence', () => {
    expect(() => matchInputs(evidence('calls'))).not.toThrow();
    for (const mutate of [
        (e: any) => e.metadata.sourceAst.contentHash = 'a'.repeat(64),
        (e: any) => e.resolution.sourceAst.projectId = 'PRJ-FFFFFF',
        (e: any) => e.resolution.sourceAst.grammarVersion = 'other',
        (e: any) => e.resolution.resolverVersion = 'other',
        (e: any) => e.resolutionArtifact.documentHash = 'a'.repeat(64),
        (e: any) => e.resolution.references[0].range.start.offset++,
        (e: any) => e.resolution.references[0].name = 'invented',
        (e: any) => e.resolution.symbols[0].declarations[0].metadataEntityId = 'meta-' + 'a'.repeat(64),
        (e: any) => e.resolution.symbols[0].bindingNodeId = 'n999999',
        (e: any) => e.resolution.scopes[0].range.end.offset++,
        (e: any) => e.resolution.references.push(e.resolution.references[0])
    ]) { const e = structuredClone(evidence('calls')); mutate(e); expect(() => matchInputs(e)).toThrow('RELATIONSHIP_INPUT_INCOMPATIBLE'); }
});
it('rejects fabricated targets, wrong categories, IDs/counts and containment cycles at the output boundary', () => {
    for (const mutate of [
        (d: any) => d.relationships[0].relationshipId = 'rel-' + 'a'.repeat(64),
        (d: any) => d.relationships[0].target.meaning = 'lexical_binding',
        (d: any) => d.counts.kinds.calls++,
        (d: any) => d.relationships.push(d.relationships[0]),
        (d: any) => d.status = 'complete',
        (d: any) => d.inputs.metadataArtifact.projectId = 'PRJ-FFFFFF',
        (d: any) => { const r = d.relationships.find((r: any) => r.target.status !== 'established'); r.target.symbolId = 'symbol-' + 'a'.repeat(64); },
        (d: any) => { const r = d.relationships.find((r: any) => r.kind === 'contains'); r.source.entityId = r.target.entityId; r.relationshipId = relationshipId(d.inputs, (({ relationshipId: _, ...rest }) => rest)(r)); }
    ]) { const d = new JavascriptRelationshipAnalyzer().analyze(evidence('calls')); mutate(d); expect(() => validateRelationshipDocument(d)).toThrow(); }
});
it('snapshot identities change for different upstream evidence and stay separate from entity/symbol/reference IDs', () => {
    const analyzer = new JavascriptRelationshipAnalyzer(), e = evidence('calls'), a = analyzer.analyze(e);
    const b = analyzer.analyze({ ...e, resolutionAnalysisHash: 'a'.repeat(64) });
    expect(a.relationships.map(r => r.relationshipId)).not.toEqual(b.relationships.map(r => r.relationshipId));
    expect(a.relationships.every(r => !r.evidence.referenceIds.includes(r.relationshipId) && r.relationshipId !== r.source.entityId && r.relationshipId !== r.target.symbolId)).toBe(true);
});
