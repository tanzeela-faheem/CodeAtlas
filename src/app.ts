import "./config.js";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import { WorkspaceManagerService } from "./modules/respository/services/workspace-manager.service.js";
import { repositoryController } from "./modules/respository/controllers/repository.controller.js";
import { analysisRoutes } from "./modules/analysis/routes.js";
import { resolutionRoutes } from "./modules/symbol-resolution/routes.js";
import { relationshipRoutes } from "./modules/relationship-analysis/routes.js";
import { architectureRoutes } from "./modules/architecture-discovery/routes.js";
export function createApp(workspaces = new WorkspaceManagerService()) {
    const app = express();
    app.use(express.json({ limit: "128kb" }));
    app.post("/api/repository/import", repositoryController(workspaces));
    app.use("/api/projects", analysisRoutes(workspaces));
    app.use("/api/projects", resolutionRoutes(workspaces));
    app.use("/api/projects", relationshipRoutes(workspaces));
    app.use("/api/projects", architectureRoutes(workspaces));
    app.use((_error: unknown, _req: Request, res: Response, _next: NextFunction) => {
        res.status(400).json({ code: "INVALID_REQUEST" });
    });
    return app;
}
export default createApp();
