import { expect, it } from "vitest";
import { canonical, cleanSource, digest, matchEvidence, validateMetadataAnalysis, validateMetadataDocument } from "../integration/contracts.js";
import { evidence, projectMetadata } from "./test-helpers.js";
it("accepts producer project analysis and verifies every producer document/hash/range", () => {
    const m = projectMetadata();
    expect(m.files).toHaveLength(12);
    for (const file of m.files) {
        const e = evidence(file.relativePath.replace('.jsx', ''));
        expect(() => matchEvidence(e.ast, e.metadata, file.metadataArtifact!)).not.toThrow();
        expect(digest(e.metadata, true)).toBe(file.metadataArtifact!.documentHash);
    }
});
it("rejects incompatible versions, corrupt counts, changed outcomes and lost partial status", () => {
    for (const mutate of [
        (m: any) => m.schemaVersion = 2,
        (m: any) => m.extractionVersion = "future",
        (m: any) => m.entityCounts.function++,
        (m: any) => m.outcomeCounts.complete++,
        (m: any) => m.sourceAnalysisHash = "a".repeat(64),
        (m: any) => m.files[0].metadataArtifact.astArtifactId = "a".repeat(64),
        (m: any) => m.files.push(m.files[0]),
        (m: any) => m.files[0].metadataArtifact.projectId = "PRJ-FFFFFF"
    ]) { const m = structuredClone(projectMetadata()); mutate(m); expect(() => validateMetadataAnalysis(m)).toThrow(); }
    const e = evidence("errors"); e.metadata.extractionStatus = "complete"; expect(() => validateMetadataDocument(e.metadata)).toThrow();
});
it("rejects source and provenance mismatches rather than matching filenames", () => {
    for (const mutate of [
        (e: any) => e.metadata.sourceAst.projectId = "PRJ-FFFFFF",
        (e: any) => e.metadata.sourceAst.contentHash = "a".repeat(64),
        (e: any) => e.metadata.sourceAst.grammarVersion = "new",
        (e: any) => e.metadata.sourceAst.normalizationVersion = null,
        (e: any) => e.metadata.entities[0].sourceRange.start.offset++,
        (e: any) => e.metadata.entities[1].astNodeId = "n999999",
        (e: any) => e.metadata.entities[1].parentEntityId = e.metadata.entities[1].entityId,
        (e: any) => e.reference.documentHash = "a".repeat(64),
        (e: any) => e.reference.artifactId = "a".repeat(64)
    ]) { const e = evidence("lexical"); mutate(e); expect(() => matchEvidence(e.ast, e.metadata, e.reference)).toThrow(); }
});
it("canonical producer hashing handles Unicode and preserves explicit nullable parser provenance", () => {
    expect(canonical({ b: "é😀", a: 1 }, true)).toBe('{"a":1,"b":"\\u00e9\\ud83d\\ude00"}');
    expect(cleanSource({ parserVersion: null, grammarVersion: null, code: null })).toEqual({ parserVersion: null, grammarVersion: null });
    expect(cleanSource({ artifactId: "a", projectId: null, analysisId: null, parserId: null, parserVersion: null, grammarVersion: null, normalizationVersion: null })).toEqual({ artifactId: "a" });
});
