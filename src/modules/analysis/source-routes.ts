import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { WorkspaceManagerService } from "../respository/services/workspace-manager.service.js";
import { FileProjectStore } from "../respository/services/project-store.js";
import { FileAnalysisStore } from "./summary-store.js";
import { FileAstStore } from "../ast-management/store.js";
import { SourceReader } from "./source-reader.js";
import {
  projectId,
  analysisId,
  sourcePath,
  StorageError,
} from "../../shared/validation.js";
import { COORDINATES } from "../ast-management/model.js";
import { MAX_SOURCE_BYTES } from "../../config.js";
class SourceError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}
async function noLinks(root: string, parts: string[]) {
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    if ((await fs.lstat(current)).isSymbolicLink())
      throw new SourceError("SOURCE_UNSAFE", 403);
  }
}
/** Verified current bytes, never a reconstructed or silently substituted historical source. */
export function sourceRoutes(
  workspaces = new WorkspaceManagerService(),
  reader = new SourceReader(workspaces),
) {
  const router = Router(),
    projects = new FileProjectStore(workspaces),
    analyses = new FileAnalysisStore(workspaces),
    asts = new FileAstStore(workspaces);
  router.use((req, res, next) => {
    if (
      !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
        req.socket.remoteAddress ?? "",
      )
    ) {
      res.status(403).json({ code: "LOCAL_ONLY" });
      return;
    }
    next();
  });
  router.get("/:projectId/analysis/:analysisId/source", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const project = String(req.params.projectId),
        analysis = String(req.params.analysisId);
      try {
        projectId(project);
        analysisId(analysis);
      } catch {
        throw new SourceError("INVALID_SOURCE_ID", 400);
      }
      if (
        Object.keys(req.query).some((k) => k !== "path") ||
        typeof req.query.path !== "string"
      )
        throw new SourceError("INVALID_SOURCE_PATH", 400);
      const relative = req.query.path;
      try {
        sourcePath(relative);
      } catch {
        throw new SourceError("INVALID_SOURCE_PATH", 400);
      }
      const workspace = await workspaces.resolveWorkspace(project).catch(() => {
        throw new SourceError("PROJECT_UNAVAILABLE", 404);
      });
      await noLinks(workspace, ["metadata", "project.json"]);
      await noLinks(workspace, ["repository"]);
      const state = await projects.get(project);
      await noLinks(workspace, ["analysis", analysis, "summary.json"]).catch(
        (error) => {
          if (error instanceof SourceError) throw error;
          throw new SourceError("ANALYSIS_UNAVAILABLE", 404);
        },
      );
      const summary = await analyses.get(project, analysis);
      const outcome = summary.files.find((f) => f.relativePath === relative);
      if (!outcome) throw new SourceError("SOURCE_NOT_IN_ANALYSIS", 404);
      const inventory = state.result.projectProfile?.languages.sourceFiles.find(
        (f) => f.relativePath === relative,
      );
      if (!inventory) throw new SourceError("SOURCE_PROFILE_UNAVAILABLE", 409);
      if (!outcome.artifact)
        throw new SourceError("SOURCE_SNAPSHOT_UNAVAILABLE", 422);
      const ref = outcome.artifact;
      if (inventory.contentHash && inventory.contentHash !== ref.contentHash)
        throw new SourceError("SOURCE_SNAPSHOT_MISMATCH", 409);
      await noLinks(workspace, [
        "analysis",
        analysis,
        `${ref.artifactId}.ast.json`,
      ]);
      const ast = await asts.get(
        project,
        analysis,
        ref.artifactId,
        ref.contentHash,
      );
      const file = { ...inventory, contentHash: ref.contentHash };
      // A missing current source is distinct from a missing analysis or snapshot.
      try {
        await noLinks(workspace, ["repository", ...relative.split("/")]);
      } catch (error) {
        if (error instanceof SourceError) throw error;
        throw new SourceError("SOURCE_UNAVAILABLE", 404);
      }
      const read = await reader.read(project, file, analysis);
      if (read.status === "read_failed") {
        const code =
          read.code === "SOURCE_CHANGED"
            ? "SOURCE_SNAPSHOT_MISMATCH"
            : read.code;
        throw new SourceError(
          code,
          code === "SOURCE_SNAPSHOT_MISMATCH"
            ? 409
            : code === "FILE_TOO_LARGE"
              ? 413
              : code === "SYMLINK"
                ? 403
                : 422,
        );
      }
      if (
        read.contentHash !== ref.contentHash ||
        read.language !== ast.language ||
        ast.relativePath !== relative
      )
        throw new SourceError("SOURCE_SNAPSHOT_MISMATCH", 409);
      const byteLength = Buffer.byteLength(read.sourceCode, "utf8");
      if (byteLength > MAX_SOURCE_BYTES)
        throw new SourceError("FILE_TOO_LARGE", 413);
      res.json({
        schemaVersion: 1,
        projectId: project,
        analysisId: analysis,
        relativePath: relative,
        language: read.language,
        sourceCode: read.sourceCode,
        contentHash: read.contentHash,
        contentLength: read.sourceCode.length,
        byteLength,
        encoding: "utf-8",
        coordinates: COORDINATES,
        snapshot: {
          astArtifactId: ref.artifactId,
          contentHash: ref.contentHash,
          parserId: ast.parserId,
          normalizationVersion:
            ast.normalizationVersion ?? "syntax-preorder-v1",
        },
      });
    } catch (error) {
      const status =
        error instanceof SourceError
          ? error.status
          : error instanceof StorageError
            ? 500
            : 404;
      res
        .status(status)
        .json({
          code:
            error instanceof SourceError
              ? error.code
              : error instanceof StorageError
                ? "SOURCE_STORAGE_CORRUPT"
                : "SOURCE_UNAVAILABLE",
        });
    }
  });
  return router;
}
