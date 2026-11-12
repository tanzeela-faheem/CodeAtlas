import { it, expect, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { setImmediate as eventTurn } from 'node:timers/promises';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../app.js';
import { fixture } from '../../test/fixtures.js';
import { WorkspaceManagerService } from '../respository/services/workspace-manager.service.js';
import { RepositoryImporterService } from '../respository/services/repository-importer.service.js';
import { FileProjectStore } from '../respository/services/project-store.js';
import { FileAstStore } from '../ast-management/store.js';
import { SourceReader } from './source-reader.js';
import { AnalysisCoordinator } from './coordinator.js';
import { FileAnalysisStore, type AnalysisStore } from './summary-store.js';
import type { AnalysisSummary } from './model.js';
function deferred() { let release!: () => void; const promise = new Promise<void>(resolve => release = resolve); return { promise, release }; }
async function setup() { const f = await fixture(), wm = new WorkspaceManagerService(f.storage), projects = new FileProjectStore(wm), store = new FileAnalysisStore(wm), asts = new FileAstStore(wm), reader = new SourceReader(wm), project = await new RepositoryImporterService(wm, projects).importRepository({ sourceType: 'local', source: f.source }); return { f, wm, projects, store, asts, reader, project }; }
it('does not expose terminal HTTP status until publication cleanup releases ownership; corruption still returns 500', async () => {
    const s = await setup(), published = deferred(), finish = deferred(), read = deferred(), retryFinished = deferred(), save = FileAnalysisStore.prototype.save, get = FileAnalysisStore.prototype.get;
    let hold = true;
    const saveSpy = vi.spyOn(FileAnalysisStore.prototype, 'save').mockImplementation(async function (this: FileAnalysisStore, summary) { await save.call(this, summary); if (hold && summary.projectId === s.project.projectId && summary.status === 'completed') {
        published.release();
        await finish.promise;
    }
    else if (!hold && summary.projectId === s.project.projectId && summary.status === 'completed')
        retryFinished.release(); });
    const readSpy = vi.spyOn(FileAnalysisStore.prototype, 'get').mockImplementation(async function (this: FileAnalysisStore, p, a) { const value = await get.call(this, p, a); if (value.projectId === s.project.projectId && value.status === 'completed')
        read.release(); return value; });
    const server = createApp(s.wm).listen(0, '127.0.0.1');
    let terminalSent = false;
    server.on('request', (req, res) => { if (req.method === 'GET')
        res.once('finish', () => { terminalSent = true; }); });
    await once(server, 'listening');
    let pending: Promise<Response> | undefined;
    try {
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/${s.project.projectId}/analysis`, response = await fetch(base, { method: 'POST' });
        expect(response.status).toBe(202);
        const job = await response.json() as AnalysisSummary;
        await published.promise;
        const conflict = await fetch(base, { method: 'POST' });
        expect(conflict.status).toBe(409);
        expect(await conflict.json()).toEqual({ code: 'ANALYSIS_BUSY' });
        pending = fetch(base + '/' + job.analysisId);
        await read.promise;
        await eventTurn();
        expect(terminalSent).toBe(false);
        hold = false;
        finish.release();
        const status = await pending;
        expect(status.status).toBe(200);
        expect((await status.json() as AnalysisSummary).status).toBe('completed');
        const file = path.join(s.project.workspacePath, 'metadata/project.json'), original = await fs.readFile(file, 'utf8');
        await fs.writeFile(file, '{}');
        const corrupt = await fetch(base, { method: 'POST' });
        expect(corrupt.status).toBe(500);
        expect(await corrupt.json()).toEqual({ code: 'STORAGE_CORRUPT' });
        await fs.writeFile(file, original);
        const retry = await fetch(base, { method: 'POST' });
        expect(retry.status).toBe(202);
        const next = await retry.json() as AnalysisSummary;
        await retryFinished.promise;
        expect((await (await fetch(base + '/' + next.analysisId)).json() as AnalysisSummary).status).toBe('completed');
    }
    finally {
        hold = false;
        finish.release();
        await pending?.catch(() => { });
        await eventTurn();
        saveSpy.mockRestore();
        readSpy.mockRestore();
        server.closeAllConnections();
        await new Promise<void>(resolve => server.close(() => resolve()));
        await s.f.cleanup();
    }
});
it('rereads a stale running result after execution finishes, never overwriting completed artifacts as interrupted', async () => {
    const s = await setup(), running = deferred(), continueJob = deferred(), captured = deferred(), returnRead = deferred();
    let capture = false;
    const written: string[] = [];
    const store: AnalysisStore = { async save(summary) { await s.store.save(summary); written.push(summary.status); if (summary.status === 'running' && !summary.files.length) {
            running.release();
            await continueJob.promise;
        } }, async get(p, a) { const value = await s.store.get(p, a); if (capture && value.status === 'running') {
            capture = false;
            captured.release();
            await returnRead.promise;
        } return value; } };
    const c = new AnalysisCoordinator(s.projects, store, s.asts, s.reader);
    let id = '', pending: Promise<AnalysisSummary> | undefined;
    try {
        const job = await c.start(s.project.projectId);
        id = job.analysisId;
        await running.promise;
        capture = true;
        pending = c.get(s.project.projectId, id);
        await captured.promise;
        continueJob.release();
        await c.wait(id);
        const final = await s.store.get(s.project.projectId, id);
        expect(final.status).toBe('completed');
        returnRead.release();
        expect(await pending).toEqual(final);
        expect(await s.store.get(s.project.projectId, id)).toEqual(final);
        expect(written).not.toContain('interrupted');
        expect((await s.asts.list(s.project.projectId, id)).length).toBe(1);
    }
    finally {
        continueJob.release();
        returnRead.release();
        await pending?.catch(() => { });
        await c.wait(id);
        await s.f.cleanup();
    }
});
it('registers queued ownership before initial publication is visible and still rejects conflicting starts', async () => {
    const s = await setup(), published = deferred(), continueQueue = deferred();
    let id = '';
    const store: AnalysisStore = { async save(summary) { await s.store.save(summary); if (summary.status === 'queued') {
            id = summary.analysisId;
            published.release();
            await continueQueue.promise;
        } }, get: s.store.get.bind(s.store) };
    const c = new AnalysisCoordinator(s.projects, store, s.asts, s.reader);
    let starting: Promise<AnalysisSummary> | undefined;
    try {
        starting = c.start(s.project.projectId);
        await published.promise;
        expect((await c.get(s.project.projectId, id)).status).toBe('queued');
        await expect(c.start(s.project.projectId)).rejects.toThrow('ANALYSIS_BUSY');
        let waited = false;
        const waiting = c.wait(id).then(() => { waited = true; });
        await eventTurn();
        expect(waited).toBe(false);
        continueQueue.release();
        expect((await starting).status).toBe('queued');
        await waiting;
        expect((await c.get(s.project.projectId, id)).status).toBe('completed');
    }
    finally {
        continueQueue.release();
        await starting?.catch(() => { });
        await c.wait(id);
        await s.f.cleanup();
    }
});
it('cleans reservation on initial publication failure and recovers only genuinely orphaned queued state', async () => {
    const s = await setup();
    let fail = true, id = '';
    const store: AnalysisStore = { async save(summary) { await s.store.save(summary); if (fail && summary.status === 'queued') {
            fail = false;
            id = summary.analysisId;
            throw Error('controlled initial publication failure');
        } }, get: s.store.get.bind(s.store) };
    const c = new AnalysisCoordinator(s.projects, store, s.asts, s.reader);
    try {
        await expect(c.start(s.project.projectId)).rejects.toThrow('controlled initial publication failure');
        await c.wait(id);
        expect((await c.get(s.project.projectId, id)).status).toBe('interrupted');
        const retry = await c.start(s.project.projectId);
        await c.wait(retry.analysisId);
        expect((await c.get(s.project.projectId, retry.analysisId)).status).toBe('completed');
    }
    finally {
        await s.f.cleanup();
    }
});
it('waits for failed fallback publication and exposes failed status only after ownership cleanup', async () => {
    const s = await setup(), failed = deferred(), release = deferred(), read = deferred();
    let inject = true;
    const store: AnalysisStore = { async save(summary) { if (inject && summary.status === 'completed') {
            inject = false;
            throw Error('controlled terminal write failure');
        } await s.store.save(summary); if (summary.status === 'failed') {
            failed.release();
            await release.promise;
        } }, async get(p, a) { const value = await s.store.get(p, a); if (value.status === 'failed')
            read.release(); return value; } };
    const c = new AnalysisCoordinator(s.projects, store, s.asts, s.reader);
    let id = '', pending: Promise<AnalysisSummary> | undefined;
    try {
        const job = await c.start(s.project.projectId);
        id = job.analysisId;
        await failed.promise;
        let returned = false;
        pending = c.get(s.project.projectId, id).then(v => { returned = true; return v; });
        await read.promise;
        await eventTurn();
        expect(returned).toBe(false);
        release.release();
        expect(await pending).toMatchObject({ status: 'failed', failureCode: 'ANALYSIS_OR_SUMMARY_STORAGE_FAILED' });
        const retry = await c.start(s.project.projectId);
        await c.wait(retry.analysisId);
        expect((await c.get(s.project.projectId, retry.analysisId)).status).toBe('completed');
    }
    finally {
        release.release();
        await pending?.catch(() => { });
        await c.wait(id);
        await s.f.cleanup();
    }
});
it('releases ownership if both terminal and fallback writes fail, without inventing successful completion', async () => {
    const s = await setup();
    let fail = true;
    const store: AnalysisStore = { async save(summary) { if (fail && ['completed', 'failed'].includes(summary.status))
            throw Error('controlled storage outage'); await s.store.save(summary); }, get: s.store.get.bind(s.store) };
    const c = new AnalysisCoordinator(s.projects, store, s.asts, s.reader);
    try {
        const job = await c.start(s.project.projectId);
        await c.wait(job.analysisId);
        fail = false;
        expect((await c.get(s.project.projectId, job.analysisId)).status).toBe('interrupted');
        const retry = await c.start(s.project.projectId);
        await c.wait(retry.analysisId);
        expect((await c.get(s.project.projectId, retry.analysisId)).status).toBe('completed');
    }
    finally {
        fail = false;
        await s.f.cleanup();
    }
});
it('preserves corrupt summary errors and restart recovery rather than accepting or repairing corrupt state', async () => {
    const s = await setup(), c = new AnalysisCoordinator(s.projects, s.store, s.asts, s.reader);
    try {
        const job = await c.start(s.project.projectId);
        await c.wait(job.analysisId);
        const final = await s.store.get(s.project.projectId, job.analysisId), { completedAt: _, ...running } = final;
        void _;
        await s.store.save({ ...running, status: 'running' });
        const restart = new AnalysisCoordinator(s.projects, s.store, s.asts, s.reader);
        expect(await restart.get(s.project.projectId, job.analysisId)).toMatchObject({ status: 'interrupted', failureCode: 'PROCESS_RESTARTED' });
        const file = path.join(s.project.workspacePath, 'analysis', job.analysisId, 'summary.json');
        await fs.writeFile(file, '{}');
        await expect(restart.get(s.project.projectId, job.analysisId)).rejects.toMatchObject({ code: 'STORAGE_CORRUPT' });
        expect(await fs.readFile(file, 'utf8')).toBe('{}');
    }
    finally {
        await s.f.cleanup();
    }
});
