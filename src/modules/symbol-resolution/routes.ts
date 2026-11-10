import { Router } from "express";
import { WorkspaceManagerService } from "../respository/services/workspace-manager.service.js";
import { FileAnalysisStore } from "../analysis/summary-store.js";
import { FileAstStore } from "../ast-management/store.js";
import { DataValidationError, StorageError, projectId, analysisId, hash } from "../../shared/validation.js";
import { FileResolutionStore } from "./storage.js";
import { MetadataClient, type MetadataProvider } from "./integration/MetadataClient.js";
import { ResolutionCoordinator } from "./integration/ResolutionCoordinator.js";
import { ResolutionError } from "./model.js";
export function resolutionRoutes(workspaces: WorkspaceManagerService, metadata: MetadataProvider = new MetadataClient()) {
    const router = Router(), store = new FileResolutionStore(workspaces);
    const coordinator = new ResolutionCoordinator(new FileAnalysisStore(workspaces), new FileAstStore(workspaces), metadata, store);
    router.use((req, res, next) => {
        if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "")) { res.status(403).json({ code: "LOCAL_ONLY" }); return; } next();
    });
    for (const [key, validate] of [["projectId", projectId], ["analysisId", analysisId], ["artifactId", hash]] as const) router.param(key, (_req, res, next, id: string) => {
        try { validate(id); next(); } catch { res.status(400).json({ code: "INVALID_RESOLUTION_ID" }); }
    });
    const failure = (res: import("express").Response, error: unknown) => {
        const status = error instanceof ResolutionError ? error.httpStatus : error instanceof DataValidationError ? 400 : error instanceof StorageError ? 500 : (error as NodeJS.ErrnoException).code === "ENOENT" ? 404 : 500;
        const code = error instanceof ResolutionError ? error.code : error instanceof DataValidationError ? "INVALID_RESOLUTION_REQUEST" : error instanceof StorageError ? "INPUT_STORAGE_CORRUPT" : status === 404 ? "RESOLUTION_OR_INPUT_MISSING" : "RESOLUTION_STORAGE_FAILED";
        res.status(status).json({ code });
    };
    const base = "/:projectId/analysis/:analysisId";
    router.post(`${base}/resolve`, async (req, res) => {
        if (req.body !== undefined && (req.body === null || typeof req.body !== "object" || Array.isArray(req.body) || Object.keys(req.body).length)) { res.status(400).json({ code: "INVALID_RESOLUTION_REQUEST" }); return; }
        try { const { files, ...summary } = await coordinator.resolve(String(req.params.projectId), String(req.params.analysisId)); res.json({ ...summary, fileCount: files.length }); } catch (error) { failure(res, error); }
    });
    router.get(`${base}/resolution`, async (req, res) => {
        try { const { files, ...summary } = await coordinator.get(String(req.params.projectId), String(req.params.analysisId)); res.json({ ...summary, fileCount: files.length }); } catch (error) { failure(res, error); }
    });
    router.get(`${base}/resolution/files`, async (req, res) => {
        try { const summary = await coordinator.get(String(req.params.projectId), String(req.params.analysisId)); res.json({ projectId: summary.projectId, analysisId: summary.analysisId, files: summary.files }); } catch (error) { failure(res, error); }
    });
    router.get(`${base}/resolution/files/:artifactId`, async (req, res) => {
        try {
            const project = String(req.params.projectId), analysis = String(req.params.analysisId), id = String(req.params.artifactId);
            const summary = await coordinator.get(project, analysis);
            if (!summary.files.some(f => f.artifact?.artifactId === id)) { res.status(404).json({ code: "RESOLUTION_FILE_MISSING" }); return; }
            res.json(await store.getFile(project, analysis, id));
        } catch (error) { failure(res, error); }
    });
    return router;
}
