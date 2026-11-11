import { it, expect, beforeEach, afterEach, describe } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Server } from "node:http";
import express from "express";
import { createApp } from "../../app.js";
import { fixture } from "../../test/fixtures.js";
import { WorkspaceManagerService } from "../respository/services/workspace-manager.service.js";
import { FileProjectStore } from "../respository/services/project-store.js";
import { RepositoryImporterService } from "../respository/services/repository-importer.service.js";
import { FileAnalysisStore } from "./summary-store.js";
import { sourceRoutes } from "./source-routes.js";
let f: Awaited<ReturnType<typeof fixture>>,
  workspaces: WorkspaceManagerService,
  server: Server | undefined;
beforeEach(async () => {
  f = await fixture({
    "src/app.js": 'export const greeting = "😀 café";\r\n// retained\r\n',
    "unsupported.ts": "export const typed: number = 1;",
  });
  workspaces = new WorkspaceManagerService(f.storage);
});
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
  }
  await f.cleanup();
});
async function listen(app = createApp(workspaces)) {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server!.once("listening", r));
  const a = server.address();
  if (!a || typeof a === "string") throw Error("address");
  return `http://127.0.0.1:${a.port}`;
}
async function prepared() {
  const imported = await new RepositoryImporterService(
      workspaces,
      new FileProjectStore(workspaces),
    ).importRepository({ sourceType: "local", source: f.source }),
    base = await listen();
  const started = await (
    await fetch(base + `/api/projects/${imported.projectId}/analysis`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
  ).json();
  const store = new FileAnalysisStore(workspaces);
  for (let i = 0; i < 100; i++) {
    const s = await store.get(imported.projectId, started.analysisId);
    if (!["queued", "running"].includes(s.status))
      return {
        imported,
        base,
        summary: s,
        url:
          base +
          `/api/projects/${imported.projectId}/analysis/${s.analysisId}/source`,
        file: path.join(f.storage, imported.projectId, "repository/src/app.js"),
      };
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error("analysis timeout");
}
async function source(url: string, relative = "src/app.js") {
  const response = await fetch(url + "?path=" + encodeURIComponent(relative));
  return {
    status: response.status,
    body: await response.json(),
    headers: response.headers,
  };
}
describe("snapshot-aware source endpoint", () => {
  it("returns exact nested UTF-8/Unicode/CRLF text and UTF-16 length", async () => {
    const p = await prepared(),
      text = await fs.readFile(p.file, "utf8"),
      r = await source(p.url);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      schemaVersion: 1,
      projectId: p.imported.projectId,
      analysisId: p.summary.analysisId,
      relativePath: "src/app.js",
      sourceCode: text,
      contentLength: text.length,
      byteLength: Buffer.byteLength(text),
      contentHash: createHash("sha256").update(text).digest("hex"),
      coordinates: "utf16-code-units; zero-based rows/columns; end-exclusive",
    });
    expect(r.body.snapshot.astArtifactId).toBe(
      p.summary.files.find((f) => f.relativePath === "src/app.js")!.artifact!
        .artifactId,
    );
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(r.body)).not.toContain(f.root);
  });
  it.each([
    "../secret.js",
    "/etc/passwd",
    "C:/secret.js",
    "a\\b.js",
    "src/./app.js",
    "src//app.js",
  ])("rejects unsafe source path %s", async (relative) => {
    const p = await prepared();
    expect((await source(p.url, relative)).status).toBe(400);
  });
  it("requires a single allowed path query", async () => {
    const p = await prepared();
    for (const q of [
      "",
      "?path=src/app.js&path=other.js",
      "?path=src/app.js&other=1",
    ])
      expect((await fetch(p.url + q)).status).toBe(400);
  });
  it("validates project and analysis IDs", async () => {
    const base = await listen();
    for (const [project, analysis] of [
      ["bad", "bad"],
      ["PRJ-abcdef", "bad"],
    ])
      expect(
        (
          await source(
            base + `/api/projects/${project}/analysis/${analysis}/source`,
          )
        ).status,
      ).toBe(400);
  });
  it("distinguishes absent project, analysis, inventory and current file", async () => {
    const p = await prepared();
    expect(
      (await source(p.url.replace(p.imported.projectId, "PRJ-ffffff"))).body
        .code,
    ).toBe("PROJECT_UNAVAILABLE");
    expect(
      (
        await source(
          p.url.replace(
            p.summary.analysisId,
            "AN-ffffffff-ffff-ffff-ffff-ffffffffffff",
          ),
        )
      ).body.code,
    ).toBe("ANALYSIS_UNAVAILABLE");
    expect((await source(p.url, "not-in-inventory.js")).body.code).toBe(
      "SOURCE_NOT_IN_ANALYSIS",
    );
    await fs.unlink(p.file);
    expect((await source(p.url)).body.code).toBe("SOURCE_UNAVAILABLE");
  });
  it("rejects changed bytes even with original length and restored mtime", async () => {
    const p = await prepared(),
      stat = await fs.stat(p.file),
      before = await fs.readFile(p.file, "utf8");
    await fs.writeFile(p.file, before.replace("café", "cafè"));
    await fs.utimes(p.file, stat.atime, stat.mtime);
    const r = await source(p.url);
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("SOURCE_SNAPSHOT_MISMATCH");
  });
  it("rejects profile/snapshot hash disagreement", async () => {
    const p = await prepared(),
      store = new FileProjectStore(workspaces),
      state = await store.get(p.imported.projectId);
    state.result.projectProfile!.languages.sourceFiles.find(
      (f) => f.relativePath === "src/app.js",
    )!.contentHash = "f".repeat(64);
    await store.save(state);
    expect((await source(p.url)).body.code).toBe("SOURCE_SNAPSHOT_MISMATCH");
  });
  it("rejects source-file and repository symlinks", async () => {
    const p = await prepared();
    await fs.rename(p.file, p.file + ".saved");
    await fs.symlink(p.file + ".saved", p.file);
    expect((await source(p.url)).status).toBe(403);
    await fs.unlink(p.file);
    await fs.rename(p.file + ".saved", p.file);
    const repo = path.dirname(path.dirname(p.file));
    await fs.rename(repo, repo + ".saved");
    await fs.symlink(repo + ".saved", repo);
    expect((await source(p.url)).status).toBe(403);
  });
  it.each([
    [Buffer.from([0]), "BINARY_SOURCE", 422],
    [Buffer.from([255]), "UNSUPPORTED_ENCODING", 422],
    [Buffer.alloc(2000001, 65), "FILE_TOO_LARGE", 413],
  ] as const)("rejects unsafe bytes %s", async (bytes, code, status) => {
    const p = await prepared();
    await fs.writeFile(p.file, bytes);
    const r = await source(p.url);
    expect(r.status).toBe(status);
    expect(r.body.code).toBe(code);
  });
  it("reports unsupported source without fabricating a snapshot", async () => {
    const p = await prepared(),
      r = await source(p.url, "unsupported.ts");
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("SOURCE_SNAPSHOT_UNAVAILABLE");
  });
  it("does not modify source/project/analysis documents", async () => {
    const p = await prepared(),
      projectFile = path.join(
        f.storage,
        p.imported.projectId,
        "metadata/project.json",
      ),
      summaryFile = path.join(
        f.storage,
        p.imported.projectId,
        "analysis",
        p.summary.analysisId,
        "summary.json",
      ),
      before = await Promise.all(
        [p.file, projectFile, summaryFile].map((x) => fs.readFile(x, "utf8")),
      );
    await source(p.url);
    expect(
      await Promise.all(
        [p.file, projectFile, summaryFile].map((x) => fs.readFile(x, "utf8")),
      ),
    ).toEqual(before);
  });
  it("retrieves the same snapshot after server reconstruction", async () => {
    const p = await prepared(),
      first = await source(p.url);
    server!.closeAllConnections();
    await new Promise<void>((r) => server!.close(() => r()));
    server = undefined;
    const base = await listen(
      createApp(new WorkspaceManagerService(f.storage)),
    );
    expect((await source(p.url.replace(p.base, base))).body).toEqual(
      first.body,
    );
  });
  it("preserves empty files and a UTF-8 BOM", async () => {
    await fs.writeFile(path.join(f.source, "empty.js"), "");
    await fs.writeFile(
      path.join(f.source, "bom.js"),
      "\ufeffexport const x=1;\r\n",
    );
    const p = await prepared();
    expect((await source(p.url, "empty.js")).body.sourceCode).toBe("");
    expect((await source(p.url, "bom.js")).body.sourceCode).toBe(
      "\ufeffexport const x=1;\r\n",
    );
  });
  it("preserves AST endpoint compatibility", async () => {
    const p = await prepared(),
      ref = p.summary.files.find((f) => f.artifact)!.artifact!,
      r = await fetch(p.url.replace("/source", "/asts/" + ref.artifactId));
    expect(r.status).toBe(200);
    expect((await r.json()).contentHash).toBe(
      (await source(p.url)).body.contentHash,
    );
  });
  it("preserves loopback access restrictions", async () => {
    const app = express();
    app.use((req, _res, next) => {
      Object.defineProperty(req.socket, "remoteAddress", {
        value: "192.0.2.1",
      });
      next();
    });
    app.use("/api/projects", sourceRoutes(workspaces));
    const base = await listen(app);
    expect(
      (
        await source(
          base +
            "/api/projects/PRJ-abcdef/analysis/AN-00000000-0000-0000-0000-000000000001/source",
        )
      ).status,
    ).toBe(403);
  });
});
