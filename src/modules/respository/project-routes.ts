import { Router, type Response } from "express";
import { WorkspaceManagerService } from "./services/workspace-manager.service.js";
import {
  ProjectCatalog,
  CatalogError,
  type PageRequest,
} from "./services/project-catalog.js";
import {
  projectId,
  StorageError,
  DataValidationError,
} from "../../shared/validation.js";
export function projectRoutes(workspaces: WorkspaceManagerService) {
  const router = Router(),
    catalog = new ProjectCatalog(workspaces);
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
  router.param("projectId", (_req, res, next, id: string) => {
    try {
      projectId(id);
      next();
    } catch {
      res.status(400).json({ code: "INVALID_PROJECT_ID" });
    }
  });
  function pagination(query: Record<string, unknown>): PageRequest {
    if (Object.keys(query).some((k) => !["offset", "limit"].includes(k)))
      throw new CatalogError("INVALID_PAGINATION", 400);
    const integer = (
      value: unknown,
      fallback: number,
      min: number,
      max: number,
    ) => {
      if (value === undefined) return fallback;
      if (
        typeof value !== "string" ||
        !/^\d{1,4}$/.test(value) ||
        Number(value) < min ||
        Number(value) > max
      )
        throw new CatalogError("INVALID_PAGINATION", 400);
      return Number(value);
    };
    return {
      offset: integer(query.offset, 0, 0, 1000),
      limit: integer(query.limit, 20, 1, 50),
    };
  }
  function failure(res: Response, error: unknown) {
    if (error instanceof CatalogError) {
      res.status(error.httpStatus).json({ code: error.code });
      return;
    }
    if (error instanceof StorageError || error instanceof DataValidationError) {
      res.status(500).json({ code: "PROJECT_STORAGE_CORRUPT" });
      return;
    }
    const code = (error as NodeJS.ErrnoException)?.code;
    res
      .status(code === "ENOENT" ? 404 : 503)
      .json({
        code:
          code === "ENOENT"
            ? "PROJECT_NOT_FOUND"
            : "PROJECT_CATALOG_UNAVAILABLE",
      });
  }
  router.get("/", async (req, res) => {
    try {
      const { items, ...page } = await catalog.list(pagination(req.query));
      res.json({ projects: items, ...page });
    } catch (error) {
      failure(res, error);
    }
  });
  router.get("/:projectId/analyses", async (req, res) => {
    try {
      const { items, ...page } = await catalog.history(
        String(req.params.projectId),
        pagination(req.query),
      );
      res.json({ projectId: req.params.projectId, analyses: items, ...page });
    } catch (error) {
      failure(res, error);
    }
  });
  for (const suffix of ["", "/profile"])
    router.get("/:projectId" + suffix, async (req, res) => {
      try {
        if (Object.keys(req.query).length)
          throw new CatalogError("INVALID_PROJECT_QUERY", 400);
        res.json(
          suffix
            ? await catalog.profile(String(req.params.projectId))
            : await catalog.get(String(req.params.projectId)),
        );
      } catch (error) {
        failure(res, error);
      }
    });
  return router;
}
