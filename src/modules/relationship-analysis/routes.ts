import { Router } from "express";
import type { Response } from "express";
import { projectId, analysisId, hash, DataValidationError, StorageError } from "../../shared/validation.js";
import { WorkspaceManagerService } from "../respository/services/workspace-manager.service.js";
import { FileAnalysisStore } from "../analysis/summary-store.js";
import { FileAstStore } from "../ast-management/store.js";
import { FileResolutionStore } from "../symbol-resolution/storage.js";
import { MetadataClient, type MetadataProvider } from "../symbol-resolution/integration/MetadataClient.js";
import { ResolutionError } from "../symbol-resolution/model.js";
import { FileRelationshipStore } from "./storage.js";
import { RelationshipCoordinator } from "./integration/RelationshipCoordinator.js";
import { RelationshipError } from "./model.js";
export function relationshipRoutes(workspaces: WorkspaceManagerService, metadata: MetadataProvider = new MetadataClient()) {
    const router = Router(), store = new FileRelationshipStore(workspaces);
    const coordinator = new RelationshipCoordinator(new FileAnalysisStore(workspaces), new FileAstStore(workspaces), new FileResolutionStore(workspaces), metadata, store);
    router.use((req, res, next) => { if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')) { res.status(403).json({ code: 'LOCAL_ONLY' }); return; } next(); });
    for (const [key, validate] of [['projectId', projectId], ['analysisId', analysisId], ['artifactId', hash]] as const) router.param(key, (_req, res, next, id: string) => {
        try { validate(id); next(); } catch { res.status(400).json({ code: 'INVALID_RELATIONSHIP_ID' }); }
    });
    const fail = (res: Response, error: unknown) => {
        const specific = error instanceof RelationshipError || error instanceof ResolutionError;
        const status = specific ? error.httpStatus : error instanceof StorageError ? 500 : error instanceof DataValidationError ? 422 : (error as NodeJS.ErrnoException)?.code === 'ENOENT' ? 404 : 500;
        const code = specific ? error.code : error instanceof StorageError || error instanceof DataValidationError ? 'RELATIONSHIP_INPUT_CORRUPT' : status === 404 ? 'RELATIONSHIP_NOT_FOUND' : 'RELATIONSHIP_STORAGE_FAILED';
        res.status(status).json({ code });
    };
    const base = '/:projectId/analysis/:analysisId/relationships';
    router.post(base, async (req, res) => {
        if (req.body !== undefined && (req.body === null || typeof req.body !== 'object' || Array.isArray(req.body) || Object.keys(req.body).length)) { res.status(400).json({ code: 'INVALID_RELATIONSHIP_REQUEST' }); return; }
        try { const { files, ...summary } = await coordinator.analyze(String(req.params.projectId), String(req.params.analysisId)); res.json({ ...summary, fileCount: files.length }); } catch (error) { fail(res, error); }
    });
    router.get(base, async (req, res) => {
        try { const { files, ...summary } = await coordinator.get(String(req.params.projectId), String(req.params.analysisId)); res.json({ ...summary, fileCount: files.length }); } catch (error) { fail(res, error); }
    });
    router.get(`${base}/files`, async (req, res) => {
        try { const s = await coordinator.get(String(req.params.projectId), String(req.params.analysisId)); res.json({ projectId: s.projectId, analysisId: s.analysisId, files: s.files }); } catch (error) { fail(res, error); }
    });
    router.get(`${base}/files/:artifactId`, async (req, res) => {
        try {
            const project = String(req.params.projectId), analysis = String(req.params.analysisId), id = String(req.params.artifactId), s = await coordinator.get(project, analysis);
            if (!s.files.some(f => f.artifact?.artifactId === id)) { res.status(404).json({ code: 'RELATIONSHIP_FILE_MISSING' }); return; }
            res.json(await store.getFile(project, analysis, id));
        } catch (error) { fail(res, error); }
    });
    return router;
}
