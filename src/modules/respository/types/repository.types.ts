import { simpleGit, type SimpleGit } from "simple-git";
import type { RepositoryMetadataService } from "../services/repository-metadata.service.js";
import type { ProjectProfile } from "../../project-detection/types/project-detection.types.js";

export interface GitCloneOptions {
    branch?: string;
    tag?: string;
    commit?: string;
    shallow?: boolean;
}

export interface GitRepositoryInfo {
  url: string;
  branch?: string;
  tag?: string | undefined;
  commit: string;
  clonePath: string;
}

export type RepositorySourceType =
    | "git"
    | "zip"
    | "local";


export type ImportStatus =
    | "imported"
    | "failed";


export type ValidationStatus =
    | "valid"
    | "invalid"
    | "warning";


export interface RepositoryImportRequest {

    sourceType: RepositorySourceType;

    source: string;

    branch?: string;

    tag?: string;

    commit?: string;

    shallow?: boolean;
}


export interface RepositoryValidationReport {

    status: ValidationStatus;

    repositoryPath: string;

    totalFiles: number;

    totalDirectories: number;

    totalSize: number;

    binaryFiles: string[];

    largeFiles: string[];

    inaccessibleFiles: string[];

    symbolicLinks: string[];

    issues: string[];

    validatedAt: string;
}


export interface RepositoryImportResult {
    projectId: string;
    projectName: string;
    sourceType: RepositorySourceType;
    status: ImportStatus;
    workspacePath: string;
    repositoryPath: string;
    importedAt: string;
    message: string;

    validation?: RepositoryValidationReport;
    metadata?: RepositoryMetadata;

    // Optional analysis result; persistence is handled separately.
    projectProfile?: ProjectProfile;
    detectionError?: string;
}

export class GitClonerService {

    /**
     * Clone a Git repository into the provided workspace path.
     */
    async cloneRepository(
        repositoryUrl: string,
        clonePath: string,
        options: GitCloneOptions = {}
    ): Promise<GitRepositoryInfo> {

        console.log("\n=================================");
        console.log("GIT REPOSITORY CLONER");
        console.log("=================================");

        console.log(`Repository URL : ${repositoryUrl}`);
        console.log(`Clone Path     : ${clonePath}`);

        if (options.branch) {
            console.log(`Branch         : ${options.branch}`);
        }

        if (options.tag) {
            console.log(`Tag            : ${options.tag}`);
        }

        if (options.commit) {
            console.log(`Commit         : ${options.commit}`);
        }

        if (options.shallow) {
            console.log(`Shallow Clone  : enabled`);
        }

        try {

            const git: SimpleGit = simpleGit();

            // ----------------------------------------
            // Build clone options
            // ----------------------------------------

            const cloneOptions: string[] = [];

            if (options.branch) {
                cloneOptions.push(
                    "--branch",
                    options.branch
                );
            }

            if (options.shallow) {
                cloneOptions.push(
                    "--depth",
                    "1"
                );
            }

            // ----------------------------------------
            // Clone repository
            // ----------------------------------------

            console.log("\nCloning repository...");

            await git.clone(
                repositoryUrl,
                clonePath,
                cloneOptions
            );

            console.log("Repository cloned successfully.");

            // ----------------------------------------
            // Open cloned repository
            // ----------------------------------------

            const clonedGit = simpleGit(clonePath);

            // ----------------------------------------
            // Checkout requested commit
            // ----------------------------------------

            if (options.commit) {

                console.log(
                    `Checking out commit: ${options.commit}`
                );

                await clonedGit.checkout(
                    options.commit
                );
            }

            // ----------------------------------------
            // Get current commit
            // ----------------------------------------

            const log = await clonedGit.log({
                maxCount: 1
            });

            const currentCommit =
                log.latest?.hash || "";

            console.log(
                `Current Commit : ${currentCommit}`
            );

            // ----------------------------------------
            // Get current branch
            // ----------------------------------------

            const branchSummary =
                await clonedGit.branch();

            const currentBranch =
                branchSummary.current;

            console.log(
                `Current Branch : ${currentBranch}`
            );

            console.log("=================================\n");

            return {
                url: repositoryUrl,
                branch: currentBranch,
                tag: options.tag,
                commit: currentCommit,
                clonePath
            };

        } catch (error) {

            console.error(
                "\nGit clone failed."
            );

            if (error instanceof Error) {
                console.error(error.message);
            }

            throw new Error(
                "Unable to clone Git repository"
            );
        }
    }
}
export interface RepositoryMetadata {

    projectId: string;

    projectName: string;

    repositorySource:
        | "git"
        | "zip"
        | "local";

    importDate: string;

    lastUpdated: string;

    gitUrl?: string | undefined;

    defaultBranch?: string | undefined;

    commitHash?: string | undefined;

    repositorySize: number;

    numberOfFiles: number;

    numberOfDirectories: number;

    importStatus:
        | "imported"
        | "failed";

    validationStatus:
        | "valid"
        | "invalid"
        | "warning";
}
