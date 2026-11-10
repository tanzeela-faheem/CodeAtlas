import { expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { digest } from "../../symbol-resolution/integration/contracts.js";
import { JavascriptRelationshipAnalyzer } from "../languages/javascript.js";
import { FileRelationshipStore } from "../storage.js";
import { PROJECT, ANALYSIS, setup } from "./test-project.js";
import { evidence } from "./test-helpers.js";
const directory = (storage: string) => path.join(storage, PROJECT, 'analysis', ANALYSIS, 'relationships');
it('publishes immutable artifacts concurrently and rejects differing same-snapshot payloads', async () => {
    const s = await setup();
    try {
        const doc = new JavascriptRelationshipAnalyzer().analyze(evidence('calls'));
        const [a, b] = await Promise.all([s.store.saveFile(doc), s.store.saveFile(doc)]); expect(a).toEqual(b);
        expect(await new FileRelationshipStore(s.workspaces).getFile(PROJECT, ANALYSIS, a.artifactId)).toEqual(doc);
        const changed = structuredClone(doc); changed.diagnostics.push({ code: 'TEST_DIAGNOSTIC', astNodeId: null, message: 'different result' });
        await expect(s.store.saveFile(changed)).rejects.toMatchObject({ code: 'RELATIONSHIP_ARTIFACT_CONFLICT' });
        expect((await fs.readdir(directory(s.f.storage))).filter(f => f.endsWith('.tmp'))).toHaveLength(0);
        await expect(s.store.getFile(PROJECT, ANALYSIS, '../escape')).rejects.toThrow();
    } finally { await s.f.cleanup(); }
});
it('captures snapshots before I/O yields instead of persisting caller mutation', async () => {
    const s = await setup();
    try {
        const doc = new JavascriptRelationshipAnalyzer().analyze(evidence('calls')), before = structuredClone(doc);
        const saving = s.store.saveFile(doc); doc.diagnostics.push({ code: 'MUTATED', astNodeId: null, message: 'not persisted' });
        const ref = await saving; expect(await s.store.getFile(PROJECT, ANALYSIS, ref.artifactId)).toEqual(before);
    } finally { await s.f.cleanup(); }
});
it('detects malformed JSON, checksum tampering and forged input identity without overwriting corrupt artifacts', async () => {
    const s = await setup();
    try {
        const doc = new JavascriptRelationshipAnalyzer().analyze(evidence('calls')), ref = await s.store.saveFile(doc);
        const file = path.join(directory(s.f.storage), `${ref.artifactId}.relationships.json`), original = await fs.readFile(file, 'utf8');
        await fs.writeFile(file, '{'); await expect(s.store.getFile(PROJECT, ANALYSIS, ref.artifactId)).rejects.toMatchObject({ code: 'RELATIONSHIP_STORAGE_CORRUPT' });
        await expect(s.store.saveFile(doc)).rejects.toMatchObject({ code: 'RELATIONSHIP_STORAGE_CORRUPT' });
        const envelope = JSON.parse(original); envelope.document.diagnostics.push({ code: 'TAMPER', astNodeId: null, message: 'changed' }); await fs.writeFile(file, JSON.stringify(envelope));
        await expect(s.store.getFile(PROJECT, ANALYSIS, ref.artifactId)).rejects.toMatchObject({ code: 'RELATIONSHIP_STORAGE_CORRUPT' });
        const forged = JSON.parse(original); forged.document.inputs.resolutionArtifact.artifactId = 'a'.repeat(64); forged.documentHash = digest(forged.document); await fs.writeFile(file, JSON.stringify(forged));
        await expect(s.store.getFile(PROJECT, ANALYSIS, ref.artifactId)).rejects.toMatchObject({ code: 'RELATIONSHIP_STORAGE_CORRUPT' });
    } finally { await s.f.cleanup(); }
});
it('detects corrupt summary/checksums, wrong ownership and missing referenced artifacts', async () => {
    const s = await setup();
    try {
        const result = await s.coordinator.analyze(PROJECT, ANALYSIS), file = path.join(directory(s.f.storage), 'summary.json'), original = await fs.readFile(file, 'utf8');
        const envelope = JSON.parse(original); envelope.analysis.counts.complete++; await fs.writeFile(file, JSON.stringify(envelope));
        await expect(s.store.getAnalysis(PROJECT, ANALYSIS)).rejects.toMatchObject({ code: 'RELATIONSHIP_STORAGE_CORRUPT' });
        await fs.writeFile(file, original);
        const foreign = JSON.parse(original); foreign.analysis.projectId = 'PRJ-FFFFFF'; foreign.documentHash = digest(foreign.analysis); await fs.writeFile(file, JSON.stringify(foreign));
        await expect(s.store.getAnalysis(PROJECT, ANALYSIS)).rejects.toMatchObject({ code: 'RELATIONSHIP_STORAGE_CORRUPT' });
        await fs.writeFile(file, original); await fs.unlink(path.join(directory(s.f.storage), `${result.files[0]!.artifact!.artifactId}.relationships.json`));
        await expect(s.store.getAnalysis(PROJECT, ANALYSIS)).rejects.toMatchObject({ code: 'RELATIONSHIP_STORAGE_CORRUPT' });
    } finally { await s.f.cleanup(); }
});
it('rejects cross-snapshot summary replacement and corrupt referenced artifacts on save', async () => {
    const s = await setup();
    try {
        const result = await s.coordinator.analyze(PROJECT, ANALYSIS);
        const changed = structuredClone(result); changed.resolutionAnalysisHash = 'a'.repeat(64);
        await expect(s.store.saveAnalysis(changed)).rejects.toMatchObject({ code: 'RELATIONSHIP_SNAPSHOT_CONFLICT' });
        result.files[0]!.artifact!.documentHash = 'a'.repeat(64);
        await expect(s.store.saveAnalysis(result)).rejects.toMatchObject({ code: 'RELATIONSHIP_STORAGE_CORRUPT' });
    } finally { await s.f.cleanup(); }
});
