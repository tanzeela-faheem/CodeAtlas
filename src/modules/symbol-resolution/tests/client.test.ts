import { expect, it } from "vitest";
import http from "node:http";
import { once } from "node:events";
import { MetadataClient } from "../integration/MetadataClient.js";
import { evidence, projectMetadata } from "./test-helpers.js";
async function serve(handler: http.RequestListener) {
    const server = http.createServer(handler); server.listen(0, "127.0.0.1"); await once(server, "listening");
    return { url: `http://127.0.0.1:${(server.address() as import('node:net').AddressInfo).port}`, close: async () => { server.closeAllConnections(); server.close(); await once(server, "close"); } };
}
const project = "PRJ-123ABC", analysis = "AN-00000000-0000-0000-0000-000000000001";
it("uses verified GET contracts and metadata artifact IDs over HTTP", async () => {
    const e = evidence("lexical"), paths: string[] = [];
    const server = await serve((req, res) => { paths.push(req.url!); res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(req.url!.includes('/files/') ? { status: "success", metadata: e.metadata } : projectMetadata())); });
    try {
        const c = new MetadataClient(server.url);
        expect((await c.analysis(project, analysis)).status).toBe("partial");
        expect(await c.document(project, analysis, e.reference.artifactId)).toEqual(e.metadata);
        expect(paths[1]).toContain(e.reference.artifactId); expect(paths[1]).not.toContain(e.reference.astArtifactId);
        await expect(c.document(project, analysis, "../escape")).rejects.toThrow();
    } finally { await server.close(); }
});
it("maps missing, upstream, invalid 200, bounds, timeouts and unavailable transport distinctly", async () => {
    for (const [kind, code] of [["missing", "METADATA_MISSING"], ["upstream", "METADATA_UPSTREAM_FAILED"], ["invalid", "METADATA_INVALID"], ["shape", "METADATA_INVALID"], ["limit", "METADATA_RESPONSE_LIMIT"], ["timeout", "METADATA_TIMEOUT"]]) {
        const server = await serve((_req, res) => {
            if (kind === "timeout") return;
            res.statusCode = kind === "missing" ? 404 : kind === "upstream" ? 500 : 200;
            res.end(kind === "invalid" ? "{" : kind === "limit" ? "x".repeat(1025) : "{}");
        });
        try { await expect(new MetadataClient(server.url, { connectMs: 100, operationMs: 150, maxBytes: 1024 }).analysis(project, analysis)).rejects.toMatchObject({ code }); }
        finally { await server.close(); }
    }
    const closed = await serve((_req, res) => res.end()); await closed.close();
    await expect(new MetadataClient(closed.url).analysis(project, analysis)).rejects.toMatchObject({ code: "METADATA_UNAVAILABLE" });
});
