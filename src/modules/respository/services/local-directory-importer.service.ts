import { AcquisitionBudget, DEFAULT_ACQUISITION_LIMITS, type AcquisitionLimits } from "./acquisition-policy.js";
import fs from "fs/promises";
import path from "path";

export interface LocalDirectoryImportResult {
    sourcePath: string;
    destinationPath: string;
    fileCount: number;
    directoryCount: number;
    skippedFiles: string[];
}

export class LocalDirectoryImporterService {
    constructor(private readonly limits: AcquisitionLimits = DEFAULT_ACQUISITION_LIMITS) {}

    // Files/directories that should not be copied
    private readonly ignoredNames = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

    /**
     * Imports a local project into the CodeAtlas workspace.
     */
    async importDirectory(sourcePath: string, destinationPath: string): Promise<LocalDirectoryImportResult> {
        // ----------------------------------------
        // 1. Resolve source path
        // ----------------------------------------

        const resolvedSource = await fs.realpath(sourcePath);

        const resolvedDestination = await fs.realpath(destinationPath);

        // ----------------------------------------
        // 2. Verify source exists
        // ----------------------------------------

        let sourceStats;

        try {
            sourceStats = await fs.stat(resolvedSource);
        } catch {
            throw new Error("Local project directory does not exist or cannot be accessed");
        }

        // ----------------------------------------
        // 3. Verify source is a directory
        // ----------------------------------------

        if (!sourceStats.isDirectory()) {
            throw new Error("The provided local project path is not a directory");
        }

        // ----------------------------------------
        // 4. Prevent destination inside source
        // ----------------------------------------

        if (resolvedDestination === resolvedSource || resolvedDestination.startsWith(resolvedSource + path.sep)) {
            throw new Error("Destination workspace cannot be inside the source directory");
        }

        // ----------------------------------------
        // 5. Create destination
        // ----------------------------------------

        await fs.mkdir(resolvedDestination, {
            recursive: true
        });

        let fileCount = 0;
        let directoryCount = 0;

        const skippedFiles: string[] = [];

        // ----------------------------------------
        // 6. Copy recursively
        // ----------------------------------------

        try {
            await this.copyDirectory(resolvedSource, resolvedDestination, {
                sourceRoot: resolvedSource,
                budget: new AcquisitionBudget(this.limits),
                fileCount: () => fileCount++,
                directoryCount: () => directoryCount++,
                skippedFiles
            });
        } catch (error) {
            // ------------------------------------
            // Cleanup failed import
            // ------------------------------------

            try {
                await fs.rm(resolvedDestination, {
                    recursive: true,
                    force: true
                });
            } catch {}

            const message = error instanceof Error ? error.message : "Unknown local import error";

            throw new Error(`Local directory import failed: ${message}`);
        }

        // ----------------------------------------
        // 7. Verify copied content
        // ----------------------------------------

        const copiedEntries = await fs.readdir(resolvedDestination);

        if (copiedEntries.length === 0) {
            throw new Error("Local project directory is empty");
        }

        return {
            sourcePath: resolvedSource,
            destinationPath: resolvedDestination,
            fileCount,
            directoryCount,
            skippedFiles
        };
    }

    /**
     * Recursively copies a directory.
     */
    private async copyDirectory(
        sourceDirectory: string,
        destinationDirectory: string,
        context: {
            sourceRoot: string;
            budget: AcquisitionBudget;
            fileCount: () => void;
            directoryCount: () => void;
            skippedFiles: string[];
        }
    ): Promise<void> {
        const entries = await fs.readdir(sourceDirectory, {
            withFileTypes: true
        });

        for (const entry of entries) {
            const sourceEntry = path.join(sourceDirectory, entry.name);

            const relativePath = path.relative(context.sourceRoot, sourceEntry);

            const destinationEntry = path.join(destinationDirectory, entry.name);

            // ------------------------------------
            // Ignore unsupported/system files
            // ------------------------------------

            if (this.ignoredNames.has(entry.name)) {
                context.skippedFiles.push(relativePath);

                continue;
            }

            // ------------------------------------
            // Ignore symbolic links
            // ------------------------------------

            if (entry.isSymbolicLink()) {
                context.skippedFiles.push(relativePath);

                continue;
            }

            // ------------------------------------
            // Directory
            // ------------------------------------

            if (relativePath.split(path.sep).length > this.limits.maxDepth)
                throw new Error("Acquisition depth limit exceeded");

            if (entry.isDirectory()) {
                context.budget.add(0, relativePath.split(path.sep).length);

                await fs.mkdir(destinationEntry, {
                    recursive: true
                });

                context.directoryCount();

                await this.copyDirectory(sourceEntry, destinationEntry, context);

                continue;
            }

            // ------------------------------------
            // File
            // ------------------------------------

            if (entry.isFile()) {
                try {
                    const stat = await fs.lstat(sourceEntry);
                    context.budget.add(stat.size, relativePath.split(path.sep).length);
                    await fs.copyFile(sourceEntry, destinationEntry);

                    context.fileCount();
                } catch {
                    throw new Error(`Unable to access or copy file: ${relativePath}`);
                }
            }
        }
    }
}
