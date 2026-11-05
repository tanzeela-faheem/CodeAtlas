import { StorageError } from "../../shared/validation.js";
import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { WorkspaceManagerService } from "../respository/services/workspace-manager.service.js";
import { FileProjectStore } from "../respository/services/project-store.js";
import { FileAstStore } from "../ast-management/store.js";
import { FileAnalysisStore } from "./summary-store.js";
import { SourceReader } from "./source-reader.js";
import { AnalysisCoordinator } from "./coordinator.js";
import { validateAnalysisId } from "../../shared/workspace-artifacts.js";

export function analysisRoutes(workspaces = new WorkspaceManagerService()) {
    const router = Router();
    const asts = new FileAstStore(workspaces);
    const coordinator = new AnalysisCoordinator(
        new FileProjectStore(workspaces),
        new FileAnalysisStore(workspaces),
        asts,
        new SourceReader(workspaces)
    );
    router.use((req: Request, res: Response, next: NextFunction) => {
        // Loopback-only prototype: no multi-user authorization is claimed.
        if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "")) {
            res.status(403).json({ code: "LOCAL_ONLY" });
            return;
        }
        next();
    });
    router.param("projectId", (_req, res, next, id: string) => {
        if (!/^PRJ-[A-Fa-f0-9]{6}$/.test(id)) {
            res.status(400).json({ code: "INVALID_PROJECT_ID" });
            return;
        }
        next();
    });
    router.param("analysisId", (_req, res, next, id: string) => {
        try {
            validateAnalysisId(id);
            next();
        } catch {
            res.status(400).json({ code: "INVALID_ANALYSIS_ID" });
        }
    });
    router.post("/:projectId/analysis", async (req, res) => {
        try {
            res.status(202).json(await coordinator.start(String(req.params.projectId)));
        } catch (error) {
            if (error instanceof StorageError) {
                res.status(500).json({ code: error.code });
                return;
            }
            const code = error instanceof Error ? error.message : "";
            res.status(
                code === "ANALYSIS_BUSY"
                    ? 409
                    : code === "DETECTION_UNAVAILABLE"
                      ? 422
                      : code === "ANALYSIS_FILE_LIMIT"
                        ? 413
                        : 404
            ).json({
                code: ["ANALYSIS_BUSY", "DETECTION_UNAVAILABLE", "ANALYSIS_FILE_LIMIT"].includes(code)
                    ? code
                    : "PROJECT_UNAVAILABLE"
            });
        }
    });
    router.get("/:projectId/analysis/:analysisId", async (req, res) => {
        try {
            res.json(await coordinator.get(String(req.params.projectId), String(req.params.analysisId)));
        } catch (error) {
            res.status(error instanceof StorageError ? 500 : 404).json({
                code: error instanceof StorageError ? error.code : "ANALYSIS_UNAVAILABLE"
            });
        }
    });
    router.get("/:projectId/analysis/:analysisId/asts", async (req, res) => {
        try {
            const summary = await coordinator.get(String(req.params.projectId), String(req.params.analysisId));
            res.json({
                projectId: summary.projectId,
                analysisId: summary.analysisId,
                artifacts: await asts.list(summary.projectId, summary.analysisId)
            });
        } catch (error) {
            res.status(error instanceof StorageError ? 500 : 404).json({
                code: error instanceof StorageError ? error.code : "ANALYSIS_UNAVAILABLE"
            });
        }
    });
    router.get("/:projectId/analysis/:analysisId/asts/:artifactId", async (req, res) => {
        const artifactId = String(req.params.artifactId);
        if (!/^[a-f0-9]{64}$/.test(artifactId)) {
            res.status(400).json({ code: "INVALID_ARTIFACT_ID" });
            return;
        }
        try {
            res.json(await asts.get(String(req.params.projectId), String(req.params.analysisId), artifactId));
        } catch (error) {
            res.status(error instanceof StorageError ? 500 : 404).json({
                code: error instanceof StorageError ? error.code : "AST_UNAVAILABLE"
            });
        }
    });
    return router;
}
