import { beforeEach, afterEach, describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import type { Server } from "node:http";
import express from "express";
import { createApp } from "../../app.js";
import { fixture } from "../../test/fixtures.js";
import { WorkspaceManagerService } from "./services/workspace-manager.service.js";
import { RepositoryImporterService } from "./services/repository-importer.service.js";
import { FileProjectStore } from "./services/project-store.js";
import { FileAnalysisStore } from "../analysis/summary-store.js";
import { emptyCounts, type AnalysisSummary } from "../analysis/model.js";
import { ProjectCatalog, CATALOG_LIMITS } from "./services/project-catalog.js";
import { projectRoutes } from "./project-routes.js";
let f: Awaited<ReturnType<typeof fixture>>,
  workspaces: WorkspaceManagerService,
  server: Server | undefined;
beforeEach(async () => {
  f = await fixture();
  workspaces = new WorkspaceManagerService(f.storage);
});
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server!.close((e) => (e ? reject(e) : resolve())),
    );
    server = undefined;
  }
  await f.cleanup();
});
async function serve(app = createApp(workspaces)) {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test address");
  return `http://127.0.0.1:${address.port}`;
}
async function imported() {
  return new RepositoryImporterService(
    workspaces,
    new FileProjectStore(workspaces),
  ).importRepository({ sourceType: "local", source: f.source });
}
function summary(
  projectId: string,
  index: number,
  status: AnalysisSummary["status"] = "completed",
): AnalysisSummary {
  return {
    schemaVersion: 1,
    projectId,
    analysisId: `AN-00000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
    status,
    startedAt: `2026-11-11T00:00:${String(index).padStart(2, "0")}.000Z`,
    counts: emptyCounts(),
    files: [],
    ...(["queued", "running"].includes(status)
      ? {}
      : {
          completedAt: `2026-11-11T00:01:${String(index).padStart(2, "0")}.000Z`,
        }),
    ...(["failed", "interrupted"].includes(status)
      ? { failureCode: "ANALYSIS_INTERRUPTED" }
      : {}),
  };
}
describe("persisted project retrieval", () => {
  it("returns an empty inventory without creating storage", async () => {
    const base = await serve();
    const r = await fetch(base + "/api/projects");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      projects: [],
      pagination: { offset: 0, limit: 20, total: 0, nextOffset: null },
      excludedCount: 0,
    });
    await expect(fs.stat(f.storage)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("lists multiple validated projects with deterministic pagination", async () => {
    const a = await imported(),
      b = await imported();
    const catalog = new ProjectCatalog(workspaces);
    const all = await catalog.list({ offset: 0, limit: 50 });
    const first = await catalog.list({ offset: 0, limit: 1 }),
      second = await catalog.list({ offset: 1, limit: 1 });
    expect(all.items).toHaveLength(2);
    expect(first.items[0]).toEqual(all.items[0]);
    expect(second.items[0]).toEqual(all.items[1]);
    expect(first.pagination).toEqual({
      offset: 0,
      limit: 1,
      total: 2,
      nextOffset: 1,
    });
    expect(second.pagination.nextOffset).toBeNull();
    expect(new Set(all.items.map((x) => x.projectId))).toEqual(
      new Set([a.projectId, b.projectId]),
    );
    expect(await catalog.list({ offset: 0, limit: 50 })).toEqual(all);
  });
  it("retrieves a public project and persisted profile without internal paths", async () => {
    const p = await imported(),
      base = await serve();
    const project = await (
      await fetch(base + `/api/projects/${p.projectId}`)
    ).json();
    expect(project).toMatchObject({
      projectId: p.projectId,
      projectName: p.projectName,
      status: "imported",
      hasProfile: true,
    });
    expect(JSON.stringify(project)).not.toContain(f.root);
    expect(project).not.toHaveProperty("provenance");
    const profile = await (
      await fetch(base + `/api/projects/${p.projectId}/profile`)
    ).json();
    expect(profile.languages.totalSourceFiles).toBe(1);
    expect(profile.languages.sourceFiles[0].relativePath).toBe("src/app.js");
    expect(profile.languages.sourceFiles[0]).not.toHaveProperty("absolutePath");
    expect(profile).not.toHaveProperty("repositoryPath");
    expect(profile.frameworks).toEqual(p.projectProfile!.frameworks);
    expect(JSON.stringify(profile)).not.toContain(f.root);
  });
  it("distinguishes missing project from corrupt project", async () => {
    const p = await imported(),
      base = await serve();
    expect((await fetch(base + "/api/projects/PRJ-ffffff")).status).toBe(404);
    await fs.writeFile(
      path.join(f.storage, p.projectId, "metadata/project.json"),
      "{corrupt",
    );
    const response = await fetch(base + `/api/projects/${p.projectId}`);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: "PROJECT_STORAGE_CORRUPT" });
  });
  it("rejects invalid project IDs and unexpected query parameters", async () => {
    const base = await serve();
    expect((await fetch(base + "/api/projects/bad")).status).toBe(400);
    expect(
      (await fetch(base + "/api/projects/PRJ-ffffff?secret=1")).status,
    ).toBe(400);
  });
  it.each([
    "offset=-1",
    "limit=0",
    "limit=51",
    "offset=1001",
    "limit=1&limit=2",
    "order=asc",
  ])("rejects invalid pagination %s", async (query) => {
    const base = await serve();
    const r = await fetch(base + "/api/projects?" + query);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ code: "INVALID_PAGINATION" });
  });
  it("returns a clear missing-profile outcome", async () => {
    const p = await imported(),
      store = new FileProjectStore(workspaces),
      state = await store.get(p.projectId);
    delete state.result.projectProfile;
    await store.save(state);
    const base = await serve();
    const r = await fetch(base + `/api/projects/${p.projectId}/profile`);
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ code: "PROJECT_PROFILE_UNAVAILABLE" });
  });
  it("rejects incompatible stored profiles without detection or writeback", async () => {
    const p = await imported(),
      file = path.join(f.storage, p.projectId, "metadata/project.json"),
      state = JSON.parse(await fs.readFile(file, "utf8"));
    state.result.projectProfile.languages.totalSourceFiles = 999;
    await fs.writeFile(file, JSON.stringify(state));
    const before = await fs.readFile(file, "utf8"),
      base = await serve();
    const r = await fetch(base + `/api/projects/${p.projectId}/profile`);
    expect(r.status).toBe(500);
    expect(await r.json()).toEqual({ code: "PROJECT_STORAGE_CORRUPT" });
    expect(await fs.readFile(file, "utf8")).toBe(before);
  });
  it("counts corrupt and unsafe project candidates but ignores unrelated directories", async () => {
    const p = await imported();
    await fs.mkdir(path.join(f.storage, "unrelated"));
    await fs.mkdir(path.join(f.storage, "PRJ-aaaaaa"));
    await fs.symlink(
      path.join(f.storage, p.projectId),
      path.join(f.storage, "PRJ-bbbbbb"),
    );
    const result = await new ProjectCatalog(workspaces).list({
      offset: 0,
      limit: 20,
    });
    expect(result.items).toHaveLength(1);
    expect(result.excludedCount).toBe(2);
  });
  it("rejects symlink storage components for direct retrieval", async () => {
    const p = await imported(),
      file = path.join(f.storage, p.projectId, "metadata/project.json"),
      copy = path.join(f.root, "copy.json");
    await fs.copyFile(file, copy);
    await fs.unlink(file);
    await fs.symlink(copy, file);
    await expect(
      new ProjectCatalog(workspaces).get(p.projectId),
    ).rejects.toMatchObject({ code: "PROJECT_STORAGE_UNSAFE" });
  });
  it("checks ownership and excludes records with changed identity", async () => {
    const p = await imported(),
      file = path.join(f.storage, p.projectId, "metadata/project.json"),
      state = JSON.parse(await fs.readFile(file, "utf8"));
    state.result.projectId = "PRJ-ffffff";
    await fs.writeFile(file, JSON.stringify(state));
    expect(
      (await new ProjectCatalog(workspaces).list({ offset: 0, limit: 20 }))
        .excludedCount,
    ).toBe(1);
  });
  it("bounds candidate enumeration and aggregate JSON reads", async () => {
    await imported();
    await imported();
    await expect(
      new ProjectCatalog(workspaces, { ...CATALOG_LIMITS, maxRecords: 1 }).list(
        { offset: 0, limit: 20 },
      ),
    ).rejects.toMatchObject({ code: "CATALOG_RESOURCE_LIMIT" });
    await expect(
      new ProjectCatalog(workspaces, {
        ...CATALOG_LIMITS,
        maxReadBytes: 1,
      }).list({ offset: 0, limit: 20 }),
    ).rejects.toMatchObject({ code: "CATALOG_RESOURCE_LIMIT" });
  });
  it("retains the trusted loopback restriction", async () => {
    const app = express();
    app.use((req, _res, next) => {
      Object.defineProperty(req.socket, "remoteAddress", {
        value: "192.0.2.1",
        configurable: true,
      });
      next();
    });
    app.use("/api/projects", projectRoutes(workspaces));
    const base = await serve(app);
    const r = await fetch(base + "/api/projects");
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ code: "LOCAL_ONLY" });
  });
});
describe("read-only source-analysis history", () => {
  it("returns an empty history and verifies the owning project", async () => {
    const p = await imported(),
      catalog = new ProjectCatalog(workspaces);
    expect(
      (await catalog.history(p.projectId, { offset: 0, limit: 20 })).items,
    ).toEqual([]);
    await expect(
      catalog.history("PRJ-ffffff", { offset: 0, limit: 20 }),
    ).rejects.toMatchObject({ code: "PROJECT_NOT_FOUND" });
  });
  it("lists newest first, paginates and preserves failed/interrupted/running records without mutation", async () => {
    const p = await imported(),
      store = new FileAnalysisStore(workspaces);
    for (const [i, status] of [
      "completed",
      "failed",
      "interrupted",
      "running",
    ].entries())
      await store.save(
        summary(p.projectId, i, status as AnalysisSummary["status"]),
      );
    const file = path.join(
        f.storage,
        p.projectId,
        "analysis",
        summary(p.projectId, 3).analysisId,
        "summary.json",
      ),
      before = await fs.readFile(file, "utf8"),
      base = await serve();
    const r = await fetch(
        base + `/api/projects/${p.projectId}/analyses?limit=2`,
      ),
      page = await r.json();
    expect(page.analyses.map((x: { status: string }) => x.status)).toEqual([
      "running",
      "interrupted",
    ]);
    expect(page.analyses[0]).not.toHaveProperty("files");
    expect(page.pagination.nextOffset).toBe(2);
    const next = await (
      await fetch(
        base + `/api/projects/${p.projectId}/analyses?offset=2&limit=2`,
      )
    ).json();
    expect(next.analyses.map((x: { status: string }) => x.status)).toEqual([
      "failed",
      "completed",
    ]);
    expect(await fs.readFile(file, "utf8")).toBe(before);
  });
  it("excludes corrupt, missing and wrong-owner summaries", async () => {
    const p = await imported(),
      store = new FileAnalysisStore(workspaces);
    await store.save(summary(p.projectId, 0));
    await store.save(summary(p.projectId, 1));
    await fs.writeFile(
      path.join(
        f.storage,
        p.projectId,
        "analysis",
        summary(p.projectId, 1).analysisId,
        "summary.json",
      ),
      "{}",
    );
    await fs.mkdir(
      path.join(
        f.storage,
        p.projectId,
        "analysis",
        summary(p.projectId, 2).analysisId,
      ),
    );
    const wrong = summary(p.projectId, 3);
    await store.save(wrong);
    wrong.projectId = "PRJ-ffffff";
    await fs.writeFile(
      path.join(
        f.storage,
        p.projectId,
        "analysis",
        wrong.analysisId,
        "summary.json",
      ),
      JSON.stringify(wrong),
    );
    const page = await new ProjectCatalog(workspaces).history(p.projectId, {
      offset: 0,
      limit: 20,
    });
    expect(page.items).toHaveLength(1);
    expect(page.excludedCount).toBe(3);
  });
  it("rejects an analysis directory symlink", async () => {
    const p = await imported(),
      store = new FileAnalysisStore(workspaces);
    await store.save(summary(p.projectId, 0));
    await fs.symlink(
      path.join(
        f.storage,
        p.projectId,
        "analysis",
        summary(p.projectId, 0).analysisId,
      ),
      path.join(
        f.storage,
        p.projectId,
        "analysis",
        summary(p.projectId, 1).analysisId,
      ),
    );
    const result = await new ProjectCatalog(workspaces).history(p.projectId, {
      offset: 0,
      limit: 20,
    });
    expect(result.items).toHaveLength(1);
    expect(result.excludedCount).toBe(1);
  });
  it("recovers persisted project/profile/history after service reconstruction", async () => {
    const p = await imported();
    await new FileAnalysisStore(workspaces).save(summary(p.projectId, 0));
    const reconstructed = new ProjectCatalog(
      new WorkspaceManagerService(f.storage),
    );
    expect((await reconstructed.get(p.projectId)).projectId).toBe(p.projectId);
    expect((await reconstructed.profile(p.projectId)).projectId).toBe(
      p.projectId,
    );
    expect(
      (await reconstructed.history(p.projectId, { offset: 0, limit: 20 }))
        .items[0]?.analysisId,
    ).toBe(summary(p.projectId, 0).analysisId);
  });
  it("keeps import and source-start routes compatible", async () => {
    const p = await imported(),
      base = await serve();
    const r = await fetch(base + `/api/projects/${p.projectId}/analysis`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    expect(r.status).toBe(202);
    const started = await r.json();
    for (let i = 0; i < 100; i++) {
      const s = await new FileAnalysisStore(workspaces).get(
        p.projectId,
        started.analysisId,
      );
      if (!["running", "queued"].includes(s.status)) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(
      (
        await new ProjectCatalog(workspaces).history(p.projectId, {
          offset: 0,
          limit: 20,
        })
      ).items[0]?.analysisId,
    ).toBe(started.analysisId);
  });
});
