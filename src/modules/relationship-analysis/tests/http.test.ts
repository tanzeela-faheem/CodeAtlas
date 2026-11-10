import { expect, it, vi } from "vitest";
import http from "node:http";
import { once } from "node:events";
import { createApp } from "../../../app.js";
import { PROJECT, ANALYSIS, setup } from "./test-project.js";
it('serves bounded relationship status/list/artifacts while preserving analysis and resolution endpoints', async () => {
    const s = await setup();
    const upstream = http.createServer(async (req, res) => {
        try {
            const value = req.url!.includes('/files/') ? { status: 'success', metadata: await s.provider.document(PROJECT, ANALYSIS, req.url!.split('/').at(-1)!) } : await s.provider.analysis();
            res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value));
        } catch { res.statusCode = 500; res.end('{}'); }
    });
    upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
    const upUrl = `http://127.0.0.1:${(upstream.address() as import('node:net').AddressInfo).port}`;
    vi.stubEnv('CODEATLAS_METADATA_BASE_URL', upUrl);
    const server = createApp(s.workspaces).listen(0, '127.0.0.1'); await once(server, 'listening');
    const host = `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`, base = `${host}/api/projects/${PROJECT}/analysis/${ANALYSIS}`;
    const post = (body: unknown = {}) => fetch(`${base}/relationships`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    try {
        expect((await fetch(`${base}/relationships`)).status).toBe(404);
        const response = await post(); expect(response.status).toBe(200); const summary = await response.json() as any;
        expect(summary.fileCount).toBe(9); expect(summary.files).toBeUndefined(); expect(summary.relationships).toBeUndefined();
        expect((await fetch(base)).status).toBe(200); expect((await fetch(`${base}/resolution`)).status).toBe(200); expect((await fetch(`${base}/asts`)).status).toBe(200);
        const listed = await (await fetch(`${base}/relationships/files`)).json() as any; expect(listed.files).toHaveLength(9);
        const artifact = listed.files[0].artifact.artifactId;
        const doc = await (await fetch(`${base}/relationships/files/${artifact}`)).json() as any; expect(doc.schemaVersion).toBe(1); expect(doc.relationships.length).toBeGreaterThan(0);
        expect((await fetch(`${base}/relationships/files/${'a'.repeat(64)}`)).status).toBe(404);
        expect((await fetch(`${base}/relationships/files/bad`)).status).toBe(400);
        expect((await fetch(`${host}/api/projects/invalid/analysis/${ANALYSIS}/relationships`)).status).toBe(400);
        expect((await post({ path: '/private' })).status).toBe(400); expect((await post([])).status).toBe(400);
        expect(await (await post()).json()).toEqual(summary); expect(s.calls.document).toBe(9);
        upstream.closeAllConnections(); upstream.close(); await once(upstream, 'close');
        const unavailable = await post(); expect(unavailable.status).toBe(503); expect(await unavailable.json()).toEqual({ code: 'METADATA_UNAVAILABLE' });
        expect((await fetch(`${base}/relationships`)).status).toBe(200);
    } finally {
        server.closeAllConnections(); server.close(); await once(server, 'close');
        if (upstream.listening) { upstream.closeAllConnections(); upstream.close(); await once(upstream, 'close'); }
        vi.unstubAllEnvs(); await s.f.cleanup();
    }
});
