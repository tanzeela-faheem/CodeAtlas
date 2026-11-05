import { it, expect, vi } from "vitest";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import { createApp } from "../../app.js";
import { fixture } from "../../test/fixtures.js";
import { WorkspaceManagerService } from "../respository/services/workspace-manager.service.js";
import { RepositoryImporterService } from "../respository/services/repository-importer.service.js";
import type { AnalysisSummary } from "./model.js";

it("reports corruption explicitly instead of treating invalid project/summary/AST data as nonexistent", async () => {
    const f = await fixture();
    const wm = new WorkspaceManagerService(f.storage);
    const imported = await new RepositoryImporterService(wm).importRepository({
        sourceType: "local",
        source: f.source
    });
    const server = createApp(wm).listen(0, "127.0.0.1");
    try {
        await once(server, "listening");
        const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects/${imported.projectId}/analysis`;
        const start = await fetch(base, { method: "POST" });
        expect(start.status).toBe(202);
        const job = (await start.json()) as AnalysisSummary;
        let summary: AnalysisSummary = job;
        for (let i = 0; i < 100; i++) {
            summary = (await (await fetch(`${base}/${job.analysisId}`)).json()) as AnalysisSummary;
            if (summary.status === "completed") break;
            await new Promise((resolve) => setTimeout(resolve, 5));
        }
        expect(summary.status).toBe("completed");
        const metadata = path.join(imported.workspacePath, "metadata/project.json");
        const original = await fs.readFile(metadata, "utf8");
        await fs.writeFile(metadata, "{}");
        const invalidProject = await fetch(base, { method: "POST" });
        expect(invalidProject.status).toBe(500);
        expect(await invalidProject.json()).toEqual({ code: "STORAGE_CORRUPT" });
        await fs.writeFile(metadata, original);
        const dir = path.join(imported.workspacePath, "analysis", job.analysisId);
        await fs.writeFile(
            path.join(dir, "summary.json"),
            JSON.stringify({ ...summary, counts: { ...summary.counts, parsed: -1 } })
        );
        const invalidSummary = await fetch(`${base}/${job.analysisId}`);
        expect(invalidSummary.status).toBe(500);
        expect(await invalidSummary.json()).toEqual({ code: "STORAGE_CORRUPT" });
        const artifact = summary.files[0]!.artifact!;
        await fs.writeFile(path.join(dir, `${artifact.artifactId}.ast.json`), "{}");
        const invalidAst = await fetch(`${base}/${job.analysisId}/asts/${artifact.artifactId}`);
        expect(invalidAst.status).toBe(500);
        expect(await invalidAst.json()).toEqual({ code: "STORAGE_CORRUPT" });
    } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await f.cleanup();
        vi.unstubAllEnvs();
    }
});
