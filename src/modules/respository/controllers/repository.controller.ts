import type { Request, Response } from "express";
import { RepositoryImporterService, RepositoryImportError } from "../services/repository-importer.service.js";
import { WorkspaceManagerService } from "../services/workspace-manager.service.js";
import { FileProjectStore } from "../services/project-store.js";

export function repositoryController(workspaces = new WorkspaceManagerService()) {
    const importer = new RepositoryImporterService(workspaces, new FileProjectStore(workspaces));
    return async (req: Request, res: Response) => {
        // Path imports and generic Git transport are trusted development facilities.
        // Public/untrusted deployments have no acquisition endpoint until browser upload
        // and an egress-controlled remote importer are implemented.
        if (
            process.env.CODEATLAS_TRUSTED_IMPORTS !== "true" ||
            !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "")
        ) {
            res.status(403).json({
                status: "failed",
                code: "TRUSTED_IMPORTS_DISABLED",
                message: "Repository acquisition is restricted to explicitly enabled trusted local development."
            });
            return;
        }
        try {
            const result = await importer.importRepository(req.body);
            // Preserve the legacy trusted-development response fields.
            res.status(200).json(result);
        } catch (error) {
            res.status(400).json({
                status: "failed",
                code: error instanceof RepositoryImportError ? error.code : "IMPORT_FAILED",
                message: "Repository import failed. Check source and import options."
            });
        }
    };
}

export const importRepository = repositoryController();
