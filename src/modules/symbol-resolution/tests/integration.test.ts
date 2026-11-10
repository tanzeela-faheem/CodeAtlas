import { expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { once } from "node:events";
import express from "express";
import { fixture } from "../../../test/fixtures.js";
import { WorkspaceManagerService } from "../../respository/services/workspace-manager.service.js";
import { FileAstStore } from "../../ast-management/store.js";
import { FileAnalysisStore } from "../../analysis/summary-store.js";
import { validateAnalysisSummary } from "../../analysis/summary-validation.js";
import { FileResolutionStore } from "../storage.js";
import { ResolutionCoordinator } from "../integration/ResolutionCoordinator.js";
import { JavascriptResolver } from "../languages/javascript.js";
import { resolutionRoutes } from "../routes.js";
import { ResolutionError } from "../model.js";
import { evidence, fixtureJson, projectMetadata } from "./test-helpers.js";
const project = "PRJ-123ABC", analysis = "AN-00000000-0000-0000-0000-000000000001";
async function setup() {
    const f = await fixture(), workspaces = new WorkspaceManagerService(f.storage);
    await workspaces.createWorkspace(project);
    const asts = new FileAstStore(workspaces), analyses = new FileAnalysisStore(workspaces), store = new FileResolutionStore(workspaces);
    const source = fixtureJson("source-analysis"); validateAnalysisSummary(source); await analyses.save(source);
    for (const file of source.files) await asts.save(evidence(file.relativePath.replace('.jsx', '')).ast);
    const provider = { analysis: async () => projectMetadata(), document: async (_p: string, _a: string, id: string) => { const file = projectMetadata().files.find(f => f.metadataArtifact?.artifactId === id)!; return evidence(file.relativePath.replace('.jsx', '')).metadata; } };
    return { f, workspaces, asts, analyses, store, provider, coordinator: new ResolutionCoordinator(analyses, asts, provider, store) };
}
it("coordinates verified producer fixtures, persists, reloads and returns identical immutable artifacts on retry", async () => {
    const s = await setup();
    try {
        const result = await s.coordinator.resolve(project, analysis);
        expect(result.status).toBe("partial"); expect(result.files).toHaveLength(12); expect(result.files.every(f => f.artifact)).toBe(true);
        const restarted = new ResolutionCoordinator(s.analyses, s.asts, s.provider, new FileResolutionStore(s.workspaces));
        expect(await restarted.get(project, analysis)).toEqual(result);
        expect(await restarted.resolve(project, analysis)).toEqual(result);
        const ref = result.files[0]!.artifact!;
        const doc = await s.store.getFile(project, analysis, ref.artifactId);
        expect(await s.store.saveFile(doc)).toEqual(ref);
        const changed = structuredClone(doc); changed.symbols[0]!.modifiers.push("changed");
        await expect(s.store.saveFile(changed)).rejects.toMatchObject({ code: "RESOLUTION_ARTIFACT_CONFLICT" });
        const file = path.join(s.f.storage, project, 'analysis', analysis, 'resolution', `${ref.artifactId}.resolution.json`);
        await fs.writeFile(file, '{}');
        await expect(s.store.getFile(project, analysis, ref.artifactId)).rejects.toMatchObject({ code: "RESOLUTION_STORAGE_CORRUPT" });
        await expect(s.store.getAnalysis(project, analysis)).rejects.toMatchObject({ code: "RESOLUTION_STORAGE_CORRUPT" });
    } finally { await s.f.cleanup(); }
});
it("isolates per-file failures, rejects changed snapshots and records restart interruption", async () => {
    const s = await setup();
    try {
        const provider = { ...s.provider, document: async (p: string, a: string, id: string) => {
            const file = projectMetadata().files.find(f => f.metadataArtifact?.artifactId === id)!;
            if (file.relativePath === 'lexical.jsx') { const m = await s.provider.document(p, a, id); return { ...m, sourceAst: { ...m.sourceAst, contentHash: "a".repeat(64) } }; }
            if (file.relativePath === 'patterns.jsx') throw new ResolutionError("METADATA_UNAVAILABLE", 503);
            return s.provider.document(p, a, id);
        } };
        const c = new ResolutionCoordinator(s.analyses, s.asts, provider, s.store);
        const result = await c.resolve(project, analysis);
        expect(result.files.find(f => f.relativePath === 'lexical.jsx')!.code).toBe("AST_PROVENANCE_INCOMPATIBLE");
        expect(result.files.find(f => f.relativePath === 'patterns.jsx')!.code).toBe("METADATA_UNAVAILABLE");
        expect(result.files.find(f => f.relativePath === 'imports.jsx')!.artifact).not.toBeNull();
        const changed = { ...s.provider, analysis: async () => { const m = projectMetadata(); m.createdAt = "2026-11-09T00:00:01.000Z"; return m; } };
        await expect(new ResolutionCoordinator(s.analyses, s.asts, changed, s.store).resolve(project, analysis)).rejects.toMatchObject({ code: "RESOLUTION_SNAPSHOT_CONFLICT" });
        result.status = "running"; result.completedAt = null; await s.store.saveAnalysis(result);
        expect((await new ResolutionCoordinator(s.analyses, s.asts, provider, s.store).get(project, analysis)).status).toBe("interrupted");
    } finally { await s.f.cleanup(); }
});
it("rejects missing upstream, incomplete analyses, unsupported adapters and invalid stored shapes", async () => {
    const s = await setup();
    try {
        const unavailable = { ...s.provider, analysis: async () => { throw new ResolutionError("METADATA_MISSING", 424); } };
        await expect(new ResolutionCoordinator(s.analyses, s.asts, unavailable, s.store).resolve(project, analysis)).rejects.toMatchObject({ code: "METADATA_MISSING" });
        const result = await new ResolutionCoordinator(s.analyses, s.asts, s.provider, s.store, []).resolve(project, analysis);
        expect(result.status).toBe("failed"); expect(result.files.every(f => f.code === "UNSUPPORTED_LANGUAGE")).toBe(true);
        const source = fixtureJson("source-analysis"); validateAnalysisSummary(source); source.status = "running"; delete source.completedAt; await s.analyses.save(source);
        await expect(s.coordinator.resolve(project, analysis)).rejects.toMatchObject({ code: "ANALYSIS_NOT_READY" });
        const e = evidence("lexical"), d = new JavascriptResolver().resolve(e.ast, e.metadata, e.reference);
        const invalid = structuredClone(d); invalid.references[0]!.symbolId = "symbol-" + "a".repeat(64);
        await expect(s.store.saveFile(invalid)).rejects.toThrow();
    } finally { await s.f.cleanup(); }
});
it("exposes bounded status, file list and owned file endpoints with safe validation", async () => {
    const s = await setup(), app = express();
    app.use(express.json()); app.use('/api/projects', resolutionRoutes(s.workspaces, s.provider));
    const server = http.createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}/api/projects/${project}/analysis/${analysis}`;
    try {
        const start = await fetch(`${base}/resolve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        expect(start.status).toBe(200); const status = await start.json() as any; expect(status.fileCount).toBe(12); expect(status.files).toBeUndefined(); expect(status.symbols).toBeUndefined();
        expect((await fetch(`${base}/resolution`)).status).toBe(200);
        const listed = await (await fetch(`${base}/resolution/files`)).json() as any;
        expect(listed.files).toHaveLength(12);
        const id = listed.files[0].artifact.artifactId;
        expect((await fetch(`${base}/resolution/files/${id}`)).status).toBe(200);
        expect((await fetch(`${base}/resolution/files/${'a'.repeat(64)}`)).status).toBe(404);
        expect((await fetch(`${base}/resolution/files/invalid`)).status).toBe(400);
        expect((await fetch(`${base}/resolve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"path":"/private"}' })).status).toBe(400);
    } finally { server.closeAllConnections(); server.close(); await once(server, 'close'); await s.f.cleanup(); }
});
it("detects checksum tampering, missing artifact references and corrupt summaries", async () => {
    const s = await setup();
    try {
        const result = await s.coordinator.resolve(project, analysis), ref = result.files[0]!.artifact!;
        const directory = path.join(s.f.storage, project, 'analysis', analysis, 'resolution');
        const file = path.join(directory, `${ref.artifactId}.resolution.json`), original = await fs.readFile(file, 'utf8');
        const tampered = JSON.parse(original); tampered.document.symbols[0].modifiers.push('tampered'); await fs.writeFile(file, JSON.stringify(tampered));
        await expect(s.store.getFile(project, analysis, ref.artifactId)).rejects.toMatchObject({ code: "RESOLUTION_STORAGE_CORRUPT" });
        await fs.writeFile(file, original);
        const summary = path.join(directory, 'summary.json'), text = await fs.readFile(summary, 'utf8');
        const changed = JSON.parse(text); changed.counts.complete++; await fs.writeFile(summary, JSON.stringify(changed));
        await expect(s.store.getAnalysis(project, analysis)).rejects.toMatchObject({ code: "RESOLUTION_STORAGE_CORRUPT" });
        await fs.writeFile(summary, text); await fs.unlink(file);
        await expect(s.store.getAnalysis(project, analysis)).rejects.toMatchObject({ code: "RESOLUTION_STORAGE_CORRUPT" });
    } finally { await s.f.cleanup(); }
});
it("enforces capacity/file bounds and unsupported grammar/language boundaries", async () => {
    const s = await setup();
    try {
        const first = s.coordinator.resolve(project, analysis);
        await expect(s.coordinator.resolve(project, analysis)).rejects.toMatchObject({ code: "RESOLUTION_BUSY" }); await first;
        await expect(new ResolutionCoordinator(s.analyses, s.asts, s.provider, s.store, [], { maxFiles: 1, maxDurationMs: 60000 }).resolve(project, analysis)).rejects.toMatchObject({ code: "RESOLUTION_RESOURCE_LIMIT" });
        const e = evidence("lexical");
        expect(new JavascriptResolver().supports({ ...e.ast, language: 'TypeScript' })).toBe(false);
        expect(new JavascriptResolver().supports({ ...e.ast, grammarVersion: 'unknown' })).toBe(false);
    } finally { await s.f.cleanup(); }
});

it("isolates storage and corrupt-AST failures using explicit per-file codes", async () => {
    const s = await setup();
    try {
        const failingStore = { saveFile: async () => { throw new Error("private disk path"); }, getFile: s.store.getFile.bind(s.store), saveAnalysis: s.store.saveAnalysis.bind(s.store), getAnalysis: s.store.getAnalysis.bind(s.store) };
        const result = await new ResolutionCoordinator(s.analyses, s.asts, s.provider, failingStore).resolve(project, analysis);
        expect(result.files.every(f => f.code === "RESOLUTION_STORAGE_FAILED")).toBe(true);
        const { StorageError } = await import("../../../shared/validation.js");
        const corruptAsts = { save: s.asts.save.bind(s.asts), list: s.asts.list.bind(s.asts), get: async () => { throw new StorageError("STORAGE_CORRUPT"); } };
        const failed = await new ResolutionCoordinator(s.analyses, corruptAsts, s.provider, s.store).resolve(project, analysis);
        expect(failed.files.every(f => f.code === "INPUT_STORAGE_CORRUPT")).toBe(true);
    } finally { await s.f.cleanup(); }
});

it("bounds aggregate metadata/result bytes and leaves later files with explicit resource outcomes", async () => {
    const s = await setup();
    try {
        const result = await new ResolutionCoordinator(s.analyses, s.asts, s.provider, s.store, [new JavascriptResolver()], { maxFiles: 1000, maxDurationMs: 60000, maxTotalBytes: 1 }).resolve(project, analysis);
        expect(result.status).toBe("failed"); expect(result.files.every(f => f.code === "RESOLUTION_RESOURCE_LIMIT")).toBe(true);
        expect(result.files.every(f => f.artifact === null)).toBe(true);
    } finally { await s.f.cleanup(); }
});
