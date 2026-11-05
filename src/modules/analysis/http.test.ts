import { it, expect, vi } from "vitest";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { createApp } from "../../app.js";
import { fixture } from "../../test/fixtures.js";
import { WorkspaceManagerService } from "../respository/services/workspace-manager.service.js";

it("HTTP import -> asynchronous analysis -> persisted status/list/document, with safe errors", async () => {
    const f = await fixture({
        "app.js": 'export const greeting = "😀";',
        "App.jsx": "export default <h1>Hello</h1>;",
        "other.ts": "const n: number = 1;"
    });
    const server = createApp(new WorkspaceManagerService(f.storage)).listen(0, "127.0.0.1");
    try {
        await once(server, "listening");
        const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        const post = (route: string, body: unknown) =>
            fetch(url + route, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body)
            });
        vi.stubEnv("CODEATLAS_TRUSTED_IMPORTS", "false");
        expect((await post("/api/repository/import", { sourceType: "local", source: f.source })).status).toBe(403);
        vi.stubEnv("CODEATLAS_TRUSTED_IMPORTS", "true");
        const imported = await post("/api/repository/import", { sourceType: "local", source: f.source });
        expect(imported.status).toBe(200);
        const project = (await imported.json()) as { projectId: string; status: string };
        const root = `/api/projects/${project.projectId}/analysis`;
        const response = await post(root, {});
        expect(response.status).toBe(202);
        const job = (await response.json()) as { analysisId: string; status: string };
        expect(job.status).toBe("queued");
        let summary: { status: string; counts: { parsed: number; unsupported: number } } | undefined;
        for (let i = 0; i < 100; i++) {
            summary = (await (await fetch(`${url}${root}/${job.analysisId}`)).json()) as typeof summary;
            if (summary?.status === "completed") break;
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        expect(summary?.status).toBe("completed");
        expect(summary?.counts).toMatchObject({ parsed: 2, unsupported: 1 });
        const listing = (await (await fetch(`${url}${root}/${job.analysisId}/asts`)).json()) as {
            artifacts: { artifactId: string }[];
        };
        expect(listing.artifacts).toHaveLength(2);
        const ast = await fetch(`${url}${root}/${job.analysisId}/asts/${listing.artifacts[0]!.artifactId}`);
        expect(ast.status).toBe(200);
        const body = await ast.text();
        expect(body).not.toContain(f.root);
        expect(body).not.toContain("rootNode");
        expect((await fetch(`${url}/api/projects/not-an-id/analysis/${job.analysisId}`)).status).toBe(400);
        expect((await fetch(`${url}${root}/invalid`)).status).toBe(400);
        expect((await fetch(`${url}${root}/${job.analysisId}/asts/${"a".repeat(64)}`)).status).toBe(404);
        expect((await post("/api/projects/PRJ-000000/analysis", {})).status).toBe(404);
    } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await f.cleanup();
        vi.unstubAllEnvs();
    }
});
