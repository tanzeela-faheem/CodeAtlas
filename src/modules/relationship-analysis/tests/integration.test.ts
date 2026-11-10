import { expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { RelationshipCoordinator } from "../integration/RelationshipCoordinator.js";
import { FileRelationshipStore } from "../storage.js";
import { DEFAULT_LIMITS } from "../model.js";
import { ResolutionError } from "../../symbol-resolution/model.js";
import { JavascriptRelationshipAnalyzer } from "../languages/javascript.js";
import { metadataAnalysis, resolutionAnalysis, evidence, json } from "./test-helpers.js";
import { PROJECT, ANALYSIS, setup } from "./test-project.js";
const relDir = (root: string) => path.join(root, PROJECT, 'analysis', ANALYSIS, 'relationships');
it('coordinates all files, persists aggregate counts, reconstructs and avoids repeated metadata-file requests', async () => {
    const s = await setup();
    try {
        const result = await s.coordinator.analyze(PROJECT, ANALYSIS);
        expect(result.status).toBe('partial'); expect(result.files).toHaveLength(9); expect(result.files.every(f => f.artifact)).toBe(true);
        expect(result.relationshipCounts.kinds.calls).toBeGreaterThan(20); expect(s.calls).toEqual({ analysis: 1, document: 9 });
        const rebuilt = new RelationshipCoordinator(s.analyses, s.asts, s.resolutions, s.provider, new FileRelationshipStore(s.workspaces));
        expect(await rebuilt.get(PROJECT, ANALYSIS)).toEqual(result);
        expect(await rebuilt.analyze(PROJECT, ANALYSIS)).toEqual(result); expect(s.calls).toEqual({ analysis: 2, document: 9 });
        const artifact = result.files[0]!.artifact!; expect(await s.store.saveFile(await s.store.getFile(PROJECT, ANALYSIS, artifact.artifactId))).toEqual(artifact);
    } finally { await s.f.cleanup(); }
});
it('isolates unavailable metadata and incompatible per-file evidence while preserving unaffected outputs', async () => {
    const s = await setup();
    try {
        const provider = { ...s.provider, document: async (p: string, a: string, id: string) => {
            const file = metadataAnalysis().files.find(f => f.metadataArtifact?.artifactId === id)!;
            if (file.relativePath === 'calls.jsx') throw new ResolutionError('METADATA_UNAVAILABLE', 503);
            const m = await s.provider.document(p, a, id);
            return file.relativePath === 'constructors.jsx' ? { ...m, sourceAst: { ...m.sourceAst, contentHash: 'a'.repeat(64) } } : m;
        } };
        const result = await new RelationshipCoordinator(s.analyses, s.asts, s.resolutions, provider, s.store).analyze(PROJECT, ANALYSIS);
        expect(result.files.find(f => f.relativePath === 'calls.jsx')).toMatchObject({ status: 'unavailable', code: 'METADATA_UNAVAILABLE' });
        expect(result.files.find(f => f.relativePath === 'constructors.jsx')).toMatchObject({ status: 'failed', code: 'RELATIONSHIP_INPUT_INCOMPATIBLE' });
        expect(result.files.find(f => f.relativePath === 'modules.jsx')!.artifact).not.toBeNull();
    } finally { await s.f.cleanup(); }
});
it('isolates missing/corrupt resolution artifacts using the validated manifest, preserving default store integrity behavior', async () => {
    const s = await setup();
    try {
        const files = resolutionAnalysis().files;
        const file = (name: string) => path.join(s.f.storage, PROJECT, 'analysis', ANALYSIS, 'resolution', `${files.find(f => f.relativePath === name)!.artifact!.artifactId}.resolution.json`);
        await fs.unlink(file('calls.jsx')); await fs.writeFile(file('modules.jsx'), '{');
        await expect(s.resolutions.getAnalysis(PROJECT, ANALYSIS)).rejects.toMatchObject({ code: 'RESOLUTION_STORAGE_CORRUPT' });
        expect((await s.resolutions.getAnalysisManifest(PROJECT, ANALYSIS)).files).toHaveLength(9);
        const result = await s.coordinator.analyze(PROJECT, ANALYSIS);
        expect(result.files.find(f => f.relativePath === 'calls.jsx')!.code).toBe('RELATIONSHIP_RESOLUTION_FILE_MISSING');
        expect(result.files.find(f => f.relativePath === 'modules.jsx')!.code).toBe('RESOLUTION_STORAGE_CORRUPT');
        expect(result.files.find(f => f.relativePath === 'constructors.jsx')!.artifact).not.toBeNull();
    } finally { await s.f.cleanup(); }
});
it('rejects incompatible upstream snapshots and conflicts with already published analysis snapshots', async () => {
    const s = await setup();
    try {
        await s.coordinator.analyze(PROJECT, ANALYSIS);
        const changedMetadata = { ...s.provider, analysis: async () => ({ ...metadataAnalysis(), createdAt: '2026-11-09T00:00:01.000Z' }) };
        await expect(new RelationshipCoordinator(s.analyses, s.asts, s.resolutions, changedMetadata, s.store).analyze(PROJECT, ANALYSIS)).rejects.toMatchObject({ code: 'RELATIONSHIP_UPSTREAM_SNAPSHOT_CONFLICT' });
        const changed = resolutionAnalysis(); changed.startedAt = '2026-11-09T00:00:03.000Z'; await s.resolutions.saveAnalysis(changed);
        await expect(s.coordinator.analyze(PROJECT, ANALYSIS)).rejects.toMatchObject({ code: 'RELATIONSHIP_SNAPSHOT_CONFLICT' });
    } finally { await s.f.cleanup(); }
});
it('recovers running summaries as interrupted and reruns failed/interrupted snapshots idempotently', async () => {
    const s = await setup();
    try {
        const result = await s.coordinator.analyze(PROJECT, ANALYSIS); result.status = 'running'; result.completedAt = null; await s.store.saveAnalysis(result);
        const rebuilt = new RelationshipCoordinator(s.analyses, s.asts, s.resolutions, s.provider, s.store);
        expect((await rebuilt.get(PROJECT, ANALYSIS)).status).toBe('interrupted');
        expect((await rebuilt.analyze(PROJECT, ANALYSIS)).files).toEqual(result.files);
    } finally { await s.f.cleanup(); }
});
it('enforces concurrent capacity, file/input/output/relationship bounds and keeps unsupported adapters explicit', async () => {
    const s = await setup();
    try {
        const first = s.coordinator.analyze(PROJECT, ANALYSIS); await expect(s.coordinator.analyze(PROJECT, ANALYSIS)).rejects.toMatchObject({ code: 'RELATIONSHIP_BUSY' }); await first;
        await expect(new RelationshipCoordinator(s.analyses, s.asts, s.resolutions, s.provider, s.store, [], { ...DEFAULT_LIMITS, maxFiles: 1 }).analyze(PROJECT, ANALYSIS)).rejects.toMatchObject({ code: 'RELATIONSHIP_RESOURCE_LIMIT' });
    } finally { await s.f.cleanup(); }
    for (const policy of [{ maxTotalBytes: 1 }, { maxArtifactBytes: 1 }, { maxRelationships: 1 }]) {
        const s = await setup();
        try { const result = await new RelationshipCoordinator(s.analyses, s.asts, s.resolutions, s.provider, s.store, [new JavascriptRelationshipAnalyzer()], { ...DEFAULT_LIMITS, ...policy }).analyze(PROJECT, ANALYSIS); expect(result.files.every(f => f.code === 'RELATIONSHIP_RESOURCE_LIMIT')).toBe(true); }
        finally { await s.f.cleanup(); }
    }
    const u = await setup();
    try { const result = await new RelationshipCoordinator(u.analyses, u.asts, u.resolutions, u.provider, u.store, []).analyze(PROJECT, ANALYSIS); expect(result.files.every(f => f.status === 'unsupported')).toBe(true); }
    finally { await u.f.cleanup(); }
});
it('reports missing/unready analysis or resolution and upstream metadata transport failures distinctly', async () => {
    const s = await setup();
    try {
        await expect(s.coordinator.analyze('PRJ-FFFFFF', ANALYSIS)).rejects.toMatchObject({ code: 'RELATIONSHIP_ANALYSIS_MISSING' });
        const unavailable = { ...s.provider, analysis: async () => { throw new ResolutionError('METADATA_UNAVAILABLE', 503); } };
        await expect(new RelationshipCoordinator(s.analyses, s.asts, s.resolutions, unavailable, s.store).analyze(PROJECT, ANALYSIS)).rejects.toMatchObject({ code: 'METADATA_UNAVAILABLE' });
        const manifest = path.join(s.f.storage, PROJECT, 'analysis', ANALYSIS, 'resolution', 'summary.json');
        const text = await fs.readFile(manifest, 'utf8'); await fs.unlink(manifest);
        await expect(s.coordinator.analyze(PROJECT, ANALYSIS)).rejects.toMatchObject({ code: 'RELATIONSHIP_RESOLUTION_MISSING' });
        await fs.writeFile(manifest, text);
        const pending = resolutionAnalysis(); pending.status = 'running'; pending.completedAt = null; await s.resolutions.saveAnalysis(pending);
        await expect(s.coordinator.analyze(PROJECT, ANALYSIS)).rejects.toMatchObject({ code: 'RELATIONSHIP_RESOLUTION_NOT_READY' });
    } finally { await s.f.cleanup(); }
});
it('preserves prior valid artifacts on storage failure and rejects corrupt AST input per file', async () => {
    const s = await setup();
    try {
        let calls = 0;
        const store = { saveFile: async (d: Parameters<typeof s.store.saveFile>[0]) => { if (++calls === 2) throw new Error('private disk path'); return s.store.saveFile(d); }, getFile: s.store.getFile.bind(s.store), saveAnalysis: s.store.saveAnalysis.bind(s.store), getAnalysis: s.store.getAnalysis.bind(s.store) };
        const result = await new RelationshipCoordinator(s.analyses, s.asts, s.resolutions, s.provider, store).analyze(PROJECT, ANALYSIS);
        expect(result.files[0]!.artifact).not.toBeNull(); expect(result.files[1]!.code).toBe('RELATIONSHIP_STORAGE_FAILED');
        expect((await s.store.getAnalysis(PROJECT, ANALYSIS)).files[0]!.artifact).not.toBeNull();
    } finally { await s.f.cleanup(); }
    const a = await setup();
    try {
        const ast = evidence('calls'); await fs.writeFile(path.join(a.f.storage, PROJECT, 'analysis', ANALYSIS, `${ast.resolution.astArtifactId}.ast.json`), '{}');
        const result = await a.coordinator.analyze(PROJECT, ANALYSIS);
        expect(result.files.find(f => f.relativePath === 'calls.jsx')!.code).toBe('RELATIONSHIP_INPUT_CORRUPT'); expect(result.files.find(f => f.relativePath === 'modules.jsx')!.artifact).not.toBeNull();
    } finally { await a.f.cleanup(); }
});
it('checks the cooperative deadline between files without claiming CPU cancellation', async () => {
    const s = await setup();
    try {
        const provider = { ...s.provider, analysis: async () => { await new Promise(r => setTimeout(r, 10)); return metadataAnalysis(); } };
        const result = await new RelationshipCoordinator(s.analyses, s.asts, s.resolutions, provider, s.store, [new JavascriptRelationshipAnalyzer()], { ...DEFAULT_LIMITS, maxDurationMs: 1 }).analyze(PROJECT, ANALYSIS);
        expect(result.files.every(f => f.code === 'RELATIONSHIP_TIME_BUDGET')).toBe(true);
    } finally { await s.f.cleanup(); }
});
