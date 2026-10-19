
import crypto from "crypto";
import path from "path";

import type {
    RepositoryImportRequest,
    RepositoryImportResult
} from "../types/repository.types.js";

import { WorkspaceManagerService } from "./workspace-manager.service.js";
import { GitClonerService } from "./git-cloner.service.js";
import { ZipExtractorService } from "./zip-extractor.service.js";
import { LocalDirectoryImporterService } from "./local-directory-importer.service.js";
import { RepositoryValidatorService } from "./repository-validator.service.js";
import { RepositoryMetadataService } from "./repository-metadata.service.js";
import { ProjectDetectionOrchestratorService } from "../../project-detection/services/project-detection-orchestrator.service.js";

export class RepositoryImporterService {
    private readonly workspaceManager = new WorkspaceManagerService();
    private readonly gitCloner = new GitClonerService();
    private readonly zipExtractor = new ZipExtractorService();
    private readonly localDirectoryImporter = new LocalDirectoryImporterService();
    private readonly repositoryValidator = new RepositoryValidatorService();
    private readonly repositoryMetadataService = new RepositoryMetadataService();
    private readonly projectDetection =new ProjectDetectionOrchestratorService();

    async importRepository(
        request: RepositoryImportRequest
    ): Promise<RepositoryImportResult> {
        let workspace:
            Awaited<ReturnType<WorkspaceManagerService["createWorkspace"]>>
            | undefined;

        let workspaceCreated = false;

        console.log("\n========== REPOSITORY IMPORT ==========");

        try {
            // 1. Validate the request before creating anything.
            if (
                !request ||
                typeof request.source !== "string" ||
                !request.source.trim()
            ) {
                throw new Error("A non-empty repository source is required.");
            }

            if (!["git", "zip", "local"].includes(request.sourceType)) {
                throw new Error(
                    `Unsupported source type: ${request.sourceType}`
                );
            }

            const source = request.source.trim();

            if (request.sourceType === "git" && !this.isGitUrl(source)) {
                throw new Error(
                    "Invalid Git source. Provide an HTTPS, HTTP, SSH, or Git SSH URL."
                );
            }

            console.log("[1/6] Request validated.");
            console.log(`Source type: ${request.sourceType}`);

            // 2. Generate the project ID and name.
            const projectId = this.generateProjectId();
            const projectName = this.getProjectName(source);

            console.log("[2/6] Project details generated.");
            console.log(`Project ID: ${projectId}`);
            console.log(`Project name: ${projectName}`);

            // 3. Create the workspace.
            workspace = await this.workspaceManager.createWorkspace(projectId);
            workspaceCreated = true;

            console.log("[3/6] Workspace created.");

            // 4. Route the source to its importer.
            switch (request.sourceType) {
                case "git": {
                    console.log("[4/6] Cloning Git repository...");

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

                    await this.gitCloner.cloneRepository(
                        source,
                        workspace.repositoryPath,
                        cloneOptions as Parameters<
                            GitClonerService["cloneRepository"]
                        >[2]
                    );
                    break;
                }

                case "zip":
                    console.log("[4/6] Extracting ZIP archive...");

                    await this.zipExtractor.extractZip(
                        source,
                        workspace.repositoryPath
                    );
                    break;

                case "local":
                    console.log("[4/6] Importing local directory...");

                    await this.localDirectoryImporter.importDirectory(
                        source,
                        workspace.repositoryPath
                    );
                    break;
            }

            // 5. Validate the imported repository.
            console.log("[5/6] Validating repository...");

            const validationReport =
                await this.repositoryValidator.validateRepository(
                    workspace.repositoryPath
                );

            console.log(`Validation status: ${validationReport.status}`);
            console.log(`Files found: ${validationReport.totalFiles}`);
            console.log(`Directories found: ${validationReport.totalDirectories}`);
            console.log(`Issues found: ${validationReport.issues.length}`);

            // 6. Generate metadata.
            
            // 6. Generate metadata.
            const metadata = this.repositoryMetadataService.createMetadata(
                projectId,
                projectName,
                request,
                validationReport
            );

            const validationFailed = validationReport.status === "invalid";

            // 7. Detect project technologies only after validation succeeds.
            // Detection is optional: its failure must not fail the import.
            let projectProfile:
                Awaited<ReturnType<ProjectDetectionOrchestratorService["detectProject"]>>
                | undefined;

            let detectionError: string | undefined;

            if (!validationFailed) {
                try {
                    projectProfile = await this.projectDetection.detectProject(
                        projectId,
                        workspace.repositoryPath,
                        projectName
                    );
                } catch (error) {
                    detectionError =
                        error instanceof Error
                            ? error.message
                            : "Project detection failed.";

                    console.error("Project detection failed:", detectionError);
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
                ...(detectionError ? { detectionError } : {}),
            };

            if (validationFailed) {
                console.error(
                    "Repository validation failed. Removing the invalid workspace."
                );

                await this.workspaceManager.deleteWorkspace(projectId);
                workspaceCreated = false;
            }

            console.log("[6/6] Import workflow finished.");
            console.log("========== IMPORT RESULT ==========");
            console.log(JSON.stringify(result, null, 2));
            console.log("===================================");

            return result;
        } catch (error) {
            const message =
                error instanceof Error ? error.message : "Unknown import error";

            console.error(`Repository import failed: ${message}`);

            // Remove partially imported data if a stage throws.
            if (workspaceCreated && workspace) {
                try {
                    await this.workspaceManager.deleteWorkspace(
                        workspace.projectId
                    );
                    console.log("Partial workspace cleaned up.");
                } catch (cleanupError) {
                    const cleanupMessage =
                        cleanupError instanceof Error
                            ? cleanupError.message
                            : "Unknown cleanup error";

                    console.error(
                        `Workspace cleanup failed: ${cleanupMessage}`
                    );
                }
            }

            throw new Error(`Repository import failed: ${message}`);
        }
    }

    private generateProjectId(): string {
        return `PRJ-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
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
                Boolean(url.hostname)
            );
        } catch {
            return false;
        }
    }
}
