import fs from "node:fs/promises";
import path from "node:path";
import { contained, MAX_JSON_BYTES } from "../../../shared/storage.js";
import {
  projectId,
  analysisId,
  StorageError,
} from "../../../shared/validation.js";
import { WorkspaceManagerService } from "./workspace-manager.service.js";
import { FileProjectStore, type ProjectState } from "./project-store.js";
import { FileAnalysisStore } from "../../analysis/summary-store.js";
import type { ProjectProfile } from "../../project-detection/types/project-detection.types.js";
import type { AnalysisSummary } from "../../analysis/model.js";

export class CatalogError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
  ) {
    super(code);
  }
}
export interface PageRequest {
  offset: number;
  limit: number;
}
export interface Page<T> {
  items: T[];
  pagination: PageRequest & { total: number; nextOffset: number | null };
  excludedCount: number;
}
export const CATALOG_LIMITS = {
  maxEntries: 10000,
  maxRecords: 1000,
  maxReadBytes: 128 * 1024 * 1024,
};
const missing = (error: unknown) =>
  (error as NodeJS.ErrnoException)?.code === "ENOENT";
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export function publicProject(state: ProjectState) {
  const r = state.result,
    p = r.projectProfile,
    m = r.metadata,
    v = r.validation;
  return {
    schemaVersion: 1 as const,
    projectId: r.projectId,
    projectName: r.projectName,
    sourceType: r.sourceType,
    status: r.status,
    importedAt: r.importedAt,
    updatedAt: state.updatedAt,
    hasProfile: !!p,
    languages: p?.languages.languages.map((l) => l.language) ?? [],
    frameworks: p?.frameworks.frameworks.map((f) => f.name) ?? [],
    ...(p
      ? {
          profileSummary: {
            dominantLanguage: p.languages.dominantLanguage,
            totalSourceFiles: p.languages.totalSourceFiles,
            totalLinesOfCode: p.languages.totalLinesOfCode,
            isMonorepo: p.multiLanguage.isMonorepo,
          },
        }
      : {}),
    ...(v
      ? {
          validation: {
            status: v.status,
            totalFiles: v.totalFiles,
            totalDirectories: v.totalDirectories,
            totalSize: v.totalSize,
          },
        }
      : {}),
    ...(m
      ? {
          metadata: {
            repositorySize: m.repositorySize,
            numberOfFiles: m.numberOfFiles,
            numberOfDirectories: m.numberOfDirectories,
            ...(m.defaultBranch ? { defaultBranch: m.defaultBranch } : {}),
            ...(m.commitHash ? { commitHash: m.commitHash } : {}),
          },
        }
      : {}),
  };
}
export function publicProfile(profile: ProjectProfile) {
  const { repositoryPath: _repositoryPath, languages, ...rest } = profile;
  const { sourceFiles, ...detection } = languages;
  return {
    ...rest,
    languages: {
      ...detection,
      sourceFiles: sourceFiles.map(
        ({ absolutePath: _absolutePath, ...file }) => file,
      ),
    },
  };
}
export function publicAnalysis(summary: AnalysisSummary) {
  const { files: _files, ...entry } = summary;
  return entry;
}
/** Read-only catalog. Never calls AnalysisCoordinator.get(), repairs storage, or runs detection. */
export class ProjectCatalog {
  private readonly projects: FileProjectStore;
  private readonly analyses: FileAnalysisStore;
  constructor(
    private readonly workspaces = new WorkspaceManagerService(),
    private readonly limits = CATALOG_LIMITS,
  ) {
    this.projects = new FileProjectStore(workspaces);
    this.analyses = new FileAnalysisStore(workspaces);
  }
  private async guard(
    root: string,
    segments: string[],
    file = false,
  ): Promise<number> {
    let current = root;
    for (let i = 0; i < segments.length; i++) {
      current = path.join(current, segments[i]!);
      const stat = await fs.lstat(current);
      if (
        stat.isSymbolicLink() ||
        (i === segments.length - 1 && file
          ? !stat.isFile()
          : !stat.isDirectory())
      )
        throw new CatalogError("PROJECT_STORAGE_UNSAFE", 500);
      await contained(root, current);
      if (i === segments.length - 1 && file) {
        if (stat.size > MAX_JSON_BYTES)
          throw new StorageError("STORAGE_CORRUPT");
        return stat.size;
      }
    }
    return 0;
  }
  private async workspace(id: string) {
    projectId(id);
    // resolveWorkspace rejects symlink workspaces and verifies direct-child containment.
    try {
      return await this.workspaces.resolveWorkspace(id);
    } catch (error) {
      if (missing(error)) throw new CatalogError("PROJECT_NOT_FOUND", 404);
      throw new CatalogError("PROJECT_STORAGE_UNSAFE", 500);
    }
  }
  private async state(id: string) {
    const root = await this.workspace(id);
    await this.guard(root, ["metadata", "project.json"], true);
    await this.guard(root, ["repository"]);
    return this.projects.get(id);
  }
  async get(id: string) {
    return publicProject(await this.state(id));
  }
  async profile(id: string) {
    const p = (await this.state(id)).result.projectProfile;
    if (!p) throw new CatalogError("PROJECT_PROFILE_UNAVAILABLE", 404);
    return publicProfile(p);
  }
  private async candidates(
    directory: string,
    pattern: RegExp,
  ): Promise<string[]> {
    const names: string[] = [];
    let scanned = 0;
    let stream;
    try {
      stream = await fs.opendir(directory);
    } catch (error) {
      if (missing(error)) return [];
      throw error;
    }
    for await (const item of stream) {
      if (++scanned > this.limits.maxEntries)
        throw new CatalogError("CATALOG_RESOURCE_LIMIT", 413);
      if (pattern.test(item.name)) names.push(item.name);
      if (names.length > this.limits.maxRecords)
        throw new CatalogError("CATALOG_RESOURCE_LIMIT", 413);
    }
    return names.sort(compare);
  }
  private page<T>(
    items: T[],
    page: PageRequest,
    excludedCount: number,
  ): Page<T> {
    return {
      items: items.slice(page.offset, page.offset + page.limit),
      pagination: {
        ...page,
        total: items.length,
        nextOffset:
          page.offset + page.limit < items.length
            ? page.offset + page.limit
            : null,
      },
      excludedCount,
    };
  }
  private account(size: number, budget: { bytes: number }) {
    budget.bytes += size;
    if (budget.bytes > this.limits.maxReadBytes)
      throw new CatalogError("CATALOG_RESOURCE_LIMIT", 413);
  }
  private exclude(error: unknown) {
    if (
      error instanceof CatalogError &&
      error.code === "CATALOG_RESOURCE_LIMIT"
    )
      throw error;
    // Invalid, missing, unsafe, inaccessible or corrupt individual records are
    // excluded and counted. No record or storage path is exposed in diagnostics.
  }
  async list(page: PageRequest) {
    const ids = await this.candidates(
      this.workspaces.workspacesRoot,
      /^PRJ-[A-Fa-f0-9]{6}$/,
    );
    const items: ReturnType<typeof publicProject>[] = [],
      budget = { bytes: 0 };
    let excluded = 0;
    for (const id of ids) {
      try {
        const root = await this.workspace(id);
        this.account(
          await this.guard(root, ["metadata", "project.json"], true),
          budget,
        );
        items.push(publicProject(await this.state(id)));
      } catch (error) {
        this.exclude(error);
        excluded++;
      }
    }
    items.sort(
      (a, b) =>
        compare(b.importedAt, a.importedAt) ||
        compare(a.projectId, b.projectId),
    );
    return this.page(items, page, excluded);
  }
  async history(id: string, page: PageRequest) {
    await this.state(id); // Require a valid persisted owning project.
    const root = await this.workspace(id),
      base = path.join(root, "analysis");
    try {
      await this.guard(root, ["analysis"]);
    } catch (error) {
      if (!missing(error)) throw error;
    }
    const ids = await this.candidates(
      base,
      /^AN-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
    );
    const items: ReturnType<typeof publicAnalysis>[] = [],
      budget = { bytes: 0 };
    let excluded = 0;
    for (const analysis of ids) {
      try {
        analysisId(analysis);
        this.account(
          await this.guard(root, ["analysis", analysis, "summary.json"], true),
          budget,
        );
        items.push(publicAnalysis(await this.analyses.get(id, analysis)));
      } catch (error) {
        this.exclude(error);
        excluded++;
      }
    }
    items.sort(
      (a, b) =>
        compare(b.startedAt, a.startedAt) ||
        compare(a.analysisId, b.analysisId),
    );
    return this.page(items, page, excluded);
  }
}
