import { verifyAcquisition } from "./acquisition-policy.js";
import { FileProjectStore, type ProjectStore } from "./project-store.js";

import crypto from "crypto";
import path from "path";

import type { RepositoryImportRequest, RepositoryImportResult } from "../types/repository.types.js";

import { WorkspaceManagerService } from "./workspace-manager.service.js";
import { GitClonerService } from "./git-cloner.service.js";
import { ZipExtractorService } from "./zip-extractor.service.js";
import { LocalDirectoryImporterService } from "./local-directory-importer.service.js";
import { RepositoryValidatorService } from "./repository-validator.service.js";
import { RepositoryMetadataService } from "./repository-metadata.service.js";
import { ProjectDetectionOrchestratorService } from "../../project-detection/services/project-detection-orchestrator.service.js";

export class RepositoryImportError extends Error {
    constructor(readonly code: string) {
        super("Repository import failed");
    }
}
export class RepositoryImporterService {
    constructor(
        private readonly workspaceManager = new WorkspaceManagerService(),
        private readonly projectStore: ProjectStore = new FileProjectStore(workspaceManager),
        private readonly projectDetection = new ProjectDetectionOrchestratorService(),
        private readonly allocateId = () => `PRJ-${crypto.randomBytes(3).toString("hex").toUpperCase()}`
    ) {}
    private readonly gitCloner = new GitClonerService();
    private readonly zipExtractor = new ZipExtractorService();
    private readonly localDirectoryImporter = new LocalDirectoryImporterService();
    private readonly repositoryValidator = new RepositoryValidatorService();
    private readonly repositoryMetadataService = new RepositoryMetadataService();

    async importRepository(request: RepositoryImportRequest): Promise<RepositoryImportResult> {
        let workspace: Awaited<ReturnType<WorkspaceManagerService["createWorkspace"]>> | undefined;

        let workspaceCreated = false;
        let stage = "INVALID_IMPORT_REQUEST";
        let gitInfo: { defaultBranch?: string; commitHash?: string } | undefined;

        try {
            // 1. Validate the request before creating anything.
            if (!request || typeof request.source !== "string" || !request.source.trim()) {
                throw new Error("A non-empty repository source is required.");
            }

            if (!["git", "zip", "local"].includes(request.sourceType)) {
                throw new Error(`Unsupported source type: ${request.sourceType}`);
            }

            for (const key of ["branch", "tag", "commit"] as const)
                if (request[key] !== undefined && typeof request[key] !== "string")
                    throw new Error("Invalid Git option");
            if (request.shallow !== undefined && typeof request.shallow !== "boolean")
                throw new Error("Invalid shallow option");
            const source = request.source.trim();

            if (request.sourceType === "git" && !this.isGitUrl(source)) {
                throw new Error("Invalid Git source. Provide an HTTPS, HTTP, SSH, or Git SSH URL.");
            }

            // 2. Generate the project ID and name.
            let projectId = this.allocateId();
            const projectName = this.getProjectName(source);

            stage = "WORKSPACE_CREATION_FAILED";
            // 3. Create the workspace.
            for (let attempt = 0; ; attempt++) {
                try {
                    workspace = await this.workspaceManager.createWorkspace(projectId);
                    break;
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== "EEXIST" || attempt >= 9) throw error;
                    projectId = this.allocateId();
                }
            }
            workspaceCreated = true;

            stage = "ACQUISITION_FAILED";
            // 4. Route the source to its importer.
            switch (request.sourceType) {
                case "git": {
                    const cloneOptions: Record<string, unknown> = {};

                    if (request.branch !== undefined) {
                        cloneOptions.branch = request.branch;
                    }
                    if (request.tag !== undefined) {
                        cloneOptions.tag = request.tag;
                    }
                    if (request.commit !== undefined) {
                        cloneOptions.commit = request.commit;
                    }
                    if (request.shallow !== undefined) {
                        cloneOptions.shallow = request.shallow;
                    }

                    const cloned = await this.gitCloner.cloneRepository(
                        source,
                        workspace.repositoryPath,
                        cloneOptions as Parameters<GitClonerService["cloneRepository"]>[2]
                    );
                    gitInfo = { ...(cloned.branch ? { defaultBranch: cloned.branch } : {}), commitHash: cloned.commit };
                    break;
                }

                case "zip":
                    await this.zipExtractor.extractZip(source, workspace.repositoryPath);
                    break;

                case "local":
                    await this.localDirectoryImporter.importDirectory(source, workspace.repositoryPath);
                    break;
            }

            await verifyAcquisition(workspace.repositoryPath);

            stage = "VALIDATION_FAILED";
            // 5. Validate the imported repository.

            const validationReport = await this.repositoryValidator.validateRepository(workspace.repositoryPath);

            // 6. Generate metadata.
            const metadata = this.repositoryMetadataService.createMetadata(
                projectId,
                projectName,
                request,
                validationReport,
                gitInfo
            );

            const validationFailed = validationReport.status === "invalid";

            // 7. Detect project technologies only after validation succeeds.
            // Detection is optional: its failure must not fail the import.
            let projectProfile: Awaited<ReturnType<ProjectDetectionOrchestratorService["detectProject"]>> | undefined;

            let detectionError: string | undefined;

            if (!validationFailed) {
                try {
                    projectProfile = await this.projectDetection.detectProject(
                        projectId,
                        workspace.repositoryPath,
                        projectName
                    );
                } catch (error) {
                    detectionError = error instanceof Error ? error.message : "Project detection failed.";
                }
            }

            const result: RepositoryImportResult = {
                projectId,
                projectName,
                sourceType: request.sourceType,
                status: validationFailed ? "failed" : "imported",
                workspacePath: workspace.workspacePath,
                repositoryPath: workspace.repositoryPath,
                importedAt: new Date().toISOString(),
                message: validationFailed
                    ? "Import completed, but repository validation failed."
                    : validationReport.status === "warning"
                      ? "Repository imported with validation warnings."
                      : "Repository imported and validated successfully.",
                validation: validationReport,
                metadata,
                ...(projectProfile ? { projectProfile } : {}),
                ...(detectionError ? { detectionError } : {})
            };

            if (validationFailed) {
                await this.workspaceManager.deleteWorkspace(projectId);
                workspaceCreated = false;
            }

            stage = "PROJECT_STORAGE_FAILED";
            if (!validationFailed)
                await this.projectStore.save({
                    schemaVersion: 1,
                    createdAt: result.importedAt,
                    updatedAt: result.importedAt,
                    result,
                    provenance: {
                        sourceType: request.sourceType,
                        source,
                        ...(request.branch !== undefined ? { branch: request.branch } : {}),
                        ...(request.tag !== undefined ? { tag: request.tag } : {}),
                        ...(request.commit !== undefined ? { commit: request.commit } : {}),
                        ...(request.shallow !== undefined ? { shallow: request.shallow } : {})
                    }
                });
            return result;
        } catch (error) {
            // Remove partially imported data if a stage throws.
            if (workspaceCreated && workspace) {
                try {
                    await this.workspaceManager.deleteWorkspace(workspace.projectId);
                } catch (cleanupError) {
                    const cleanupMessage =
                        cleanupError instanceof Error ? cleanupError.message : "Unknown cleanup error";
                }
            }

            throw new RepositoryImportError(stage);
        }
    }

    private getProjectName(source: string): string {
        const cleanSource = source
            .replace(/\\/g, "/")
            .replace(/\.zip$/i, "")
            .replace(/\/+$/, "");

        const name = path.posix.basename(cleanSource).replace(/\.git$/i, "");

        return name || "Imported Project";
    }

    private isGitUrl(source: string): boolean {
        // Supports regular HTTP(S) URLs and SSH-style Git URLs.
        if (/^git@[^:\s]+:.+/.test(source)) {
            return true;
        }

        try {
            const url = new URL(source);

            return (
                ["http:", "https:", "ssh:", "git:"].includes(url.protocol) &&
                Boolean(url.hostname) &&
                !url.password &&
                (url.protocol === "ssh:" || !url.username)
            );
        } catch {
            return false;
        }
    }
}
