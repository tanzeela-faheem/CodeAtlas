import fs from "fs/promises";
import path from "path";

export interface ProjectWorkspace {
    projectId: string;
    workspacePath: string;
    repositoryPath: string;
    metadataPath: string;
    analysisPath: string;
    cachePath: string;
    tempPath: string;
}

export interface WorkspaceStorageReport {
    projectId: string;
    workspacePath: string;
    totalSizeBytes: number;
    totalFiles: number;
    totalDirectories: number;
}

export class WorkspaceManagerService {
    private readonly workspacesRoot = path.resolve(
        process.cwd(),
        "storage",
        "workspaces"
    );

    private readonly directoryNames = [
        "repository",
        "metadata",
        "analysis",
        "cache",
        "temp"
    ];

    /**
     * Resolve and validate a project workspace path.
     */
    private getWorkspacePath(projectId: string): string {
        if (!/^PRJ-[A-Fa-f0-9]{6}$/.test(projectId)) {
            throw new Error("Invalid project ID");
        }

        const workspacePath = path.resolve(
            this.workspacesRoot,
            projectId
        );

        if (
            path.dirname(workspacePath) !== this.workspacesRoot
        ) {
            throw new Error("Invalid workspace path");
        }

        return workspacePath;
    }

    /**
     * Create a workspace and its standard directories.
     */
    async createWorkspace(
        projectId: string
    ): Promise<ProjectWorkspace> {
        const workspacePath = this.getWorkspacePath(projectId);

        await fs.mkdir(this.workspacesRoot, {
            recursive: true
        });

        // Do not silently reuse an existing project workspace.
        try {
            await fs.access(workspacePath);
            throw new Error(
                `Workspace already exists for project ${projectId}`
            );
        } catch (error) {
            if (
                error instanceof Error &&
                error.message.startsWith("Workspace already exists")
            ) {
                throw error;
            }
        }

        try {
            await fs.mkdir(workspacePath);

            for (const directoryName of this.directoryNames) {
                await fs.mkdir(
                    path.join(workspacePath, directoryName)
                );
            }

            const workspace: ProjectWorkspace = {
                projectId,
                workspacePath,
                repositoryPath: path.join(
                    workspacePath,
                    "repository"
                ),
                metadataPath: path.join(
                    workspacePath,
                    "metadata"
                ),
                analysisPath: path.join(
                    workspacePath,
                    "analysis"
                ),
                cachePath: path.join(
                    workspacePath,
                    "cache"
                ),
                tempPath: path.join(
                    workspacePath,
                    "temp"
                )
            };

            console.log("\n========== WORKSPACE CREATED ==========");
            console.log(`Project ID : ${projectId}`);
            console.log(`Workspace  : ${workspace.workspacePath}`);
            console.log(`Repository : ${workspace.repositoryPath}`);
            console.log("Directories: repository, metadata, analysis, cache, temp");
            console.log("=======================================\n");

            return workspace;
        } catch (error) {
            // Remove a partially created workspace.
            await fs.rm(workspacePath, {
                recursive: true,
                force: true
            });

            throw error;
        }
    }

    /**
     * Remove temporary files without touching the repository.
     */
    async cleanTemporaryFiles(projectId: string): Promise<void> {
        const workspacePath = this.getWorkspacePath(projectId);
        const tempPath = path.join(workspacePath, "temp");

        await fs.access(workspacePath);

        await fs.rm(tempPath, {
            recursive: true,
            force: true
        });

        await fs.mkdir(tempPath, {
            recursive: true
        });

        console.log(`Temporary files cleaned: ${projectId}`);
    }

    /**
     * Reset a workspace to its original empty structure.
     * WARNING: This deletes repository and analysis contents.
     */
    async resetWorkspace(
        projectId: string
    ): Promise<ProjectWorkspace> {
        const workspacePath = this.getWorkspacePath(projectId);

        await fs.access(workspacePath);

        await fs.rm(workspacePath, {
            recursive: true,
            force: true
        });

        console.log(`Workspace reset: ${projectId}`);

        return this.createWorkspace(projectId);
    }

    /**
     * Delete a complete project workspace.
     * The project ID is validated before deletion.
     */
    async deleteWorkspace(projectId: string): Promise<void> {
        const workspacePath = this.getWorkspacePath(projectId);

        await fs.rm(workspacePath, {
            recursive: true,
            force: true
        });

        console.log(`Workspace deleted: ${projectId}`);
    }

    /**
     * Calculate storage usage without following symbolic links.
     */
    async getStorageUsage(
        projectId: string
    ): Promise<WorkspaceStorageReport> {
        const workspacePath = this.getWorkspacePath(projectId);

        const rootStats = await fs.lstat(workspacePath);

        if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
            throw new Error("Workspace is not a valid directory");
        }

        let totalSizeBytes = 0;
        let totalFiles = 0;
        let totalDirectories = 0;

        const scan = async (directoryPath: string): Promise<void> => {
            const entries = await fs.readdir(directoryPath, {
                withFileTypes: true
            });

            for (const entry of entries) {
                const entryPath = path.join(directoryPath, entry.name);
                const stats = await fs.lstat(entryPath);

                if (stats.isSymbolicLink()) {
                    // Count link metadata, but never follow the link.
                    totalSizeBytes += stats.size;
                } else if (stats.isDirectory()) {
                    totalDirectories++;
                    await scan(entryPath);
                } else if (stats.isFile()) {
                    totalFiles++;
                    totalSizeBytes += stats.size;
                }
            }
        };

        await scan(workspacePath);

        const report: WorkspaceStorageReport = {
            projectId,
            workspacePath,
            totalSizeBytes,
            totalFiles,
            totalDirectories
        };

        console.log("\n========== WORKSPACE STORAGE ==========");
        console.log(JSON.stringify(report, null, 2));
        console.log("=======================================\n");

        return report;
    }
}