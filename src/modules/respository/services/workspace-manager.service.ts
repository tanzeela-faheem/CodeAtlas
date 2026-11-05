import fs from "fs/promises";
import path from "path";
import "../../../config.js";

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
    readonly workspacesRoot: string;
    constructor(root = process.env.WORKSPACE_ROOT?.trim() || "storage/workspaces") {
        this.workspacesRoot = path.resolve(root);
    }

    async resolveWorkspace(projectId: string): Promise<string> {
        const target = this.getWorkspacePath(projectId);
        const [root, actual, stat] = await Promise.all([
            fs.realpath(this.workspacesRoot),
            fs.realpath(target),
            fs.lstat(target)
        ]);
        if (stat.isSymbolicLink() || !stat.isDirectory() || path.dirname(actual) !== root)
            throw new Error("Unsafe workspace");
        return actual;
    }

    private readonly directoryNames = ["repository", "metadata", "analysis", "cache", "temp"];

    /**
     * Resolve and validate a project workspace path.
     */
    private getWorkspacePath(projectId: string): string {
        if (!/^PRJ-[A-Fa-f0-9]{6}$/.test(projectId)) {
            throw new Error("Invalid project ID");
        }

        const workspacePath = path.resolve(this.workspacesRoot, projectId);

        if (path.dirname(workspacePath) !== this.workspacesRoot) {
            throw new Error("Invalid workspace path");
        }

        return workspacePath;
    }

    /**
     * Create a workspace and its standard directories.
     */
    async createWorkspace(projectId: string): Promise<ProjectWorkspace> {
        const workspacePath = this.getWorkspacePath(projectId);

        await fs.mkdir(this.workspacesRoot, {
            recursive: true
        });

        // Exclusive mkdir establishes ownership before any cleanup is allowed.
        await fs.mkdir(workspacePath);

        try {
            for (const directoryName of this.directoryNames) {
                await fs.mkdir(path.join(workspacePath, directoryName));
            }

            const workspace: ProjectWorkspace = {
                projectId,
                workspacePath,
                repositoryPath: path.join(workspacePath, "repository"),
                metadataPath: path.join(workspacePath, "metadata"),
                analysisPath: path.join(workspacePath, "analysis"),
                cachePath: path.join(workspacePath, "cache"),
                tempPath: path.join(workspacePath, "temp")
            };

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
    }

    /**
     * Reset a workspace to its original empty structure.
     * WARNING: This deletes repository and analysis contents.
     */
    async resetWorkspace(projectId: string): Promise<ProjectWorkspace> {
        const workspacePath = this.getWorkspacePath(projectId);

        await fs.access(workspacePath);

        await fs.rm(workspacePath, {
            recursive: true,
            force: true
        });

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
    }

    /**
     * Calculate storage usage without following symbolic links.
     */
    async getStorageUsage(projectId: string): Promise<WorkspaceStorageReport> {
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

        return report;
    }
}
