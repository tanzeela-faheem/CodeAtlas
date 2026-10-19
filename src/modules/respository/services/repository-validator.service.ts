import fs from "fs/promises";
import path from "path";

import type {
    RepositoryValidationReport,
    RepositoryImportRequest,
    RepositorySourceType,
    ValidationStatus
} from "../types/repository.types.js";


export class RepositoryValidatorService {

    // Files larger than this are reported.
    // Current limit: 50 MB
    private readonly largeFileLimit =
        50 * 1024 * 1024;


    // Common binary file extensions.
    private readonly binaryExtensions =
        new Set([
            ".png",
            ".jpg",
            ".jpeg",
            ".gif",
            ".bmp",
            ".webp",
            ".ico",
            ".pdf",
            ".zip",
            ".rar",
            ".7z",
            ".exe",
            ".dll",
            ".so",
            ".dylib",
            ".class",
            ".jar",
            ".mp3",
            ".mp4",
            ".avi",
            ".mov",
            ".woff",
            ".woff2",
            ".ttf",
            ".otf"
        ]);


    /**
     * Validate an imported repository.
     */
    async validateRepository(
        repositoryPath: string
    ): Promise<RepositoryValidationReport> {

        console.log("\n=================================");
        console.log("REPOSITORY VALIDATOR");
        console.log("=================================");

        console.log(
            `Repository: ${repositoryPath}`
        );


        // ----------------------------------------
        // 1. Check repository accessibility
        // ----------------------------------------

        try {

            await fs.access(repositoryPath);

        } catch {

            throw new Error(
                "Repository directory does not exist or cannot be accessed"
            );
        }


        // ----------------------------------------
        // 2. Check directory
        // ----------------------------------------

        const repositoryStats =
            await fs.stat(repositoryPath);


        if (!repositoryStats.isDirectory()) {

            throw new Error(
                "Repository path is not a directory"
            );
        }


        // ----------------------------------------
        // 3. Initialize counters
        // ----------------------------------------

        let totalFiles = 0;

        let totalDirectories = 0;

        let totalSize = 0;

        const binaryFiles: string[] = [];

        const largeFiles: string[] = [];

        const inaccessibleFiles: string[] = [];

        const symbolicLinks: string[] = [];

        const issues: string[] = [];


        // ----------------------------------------
        // 4. Scan repository
        // ----------------------------------------

        await this.scanDirectory(
            repositoryPath,
            repositoryPath,
            {
                incrementFile: () => {
                    totalFiles++;
                },

                incrementDirectory: () => {
                    totalDirectories++;
                },

                addSize: (size: number) => {
                    totalSize += size;
                },

                addBinaryFile: (file: string) => {
                    binaryFiles.push(file);
                },

                addLargeFile: (file: string) => {
                    largeFiles.push(file);
                },

                addInaccessibleFile: (file: string) => {
                    inaccessibleFiles.push(file);
                },

                addSymbolicLink: (file: string) => {
                    symbolicLinks.push(file);
                }
            }
        );


        // ----------------------------------------
        // 5. Empty repository check
        // ----------------------------------------

        if (totalFiles === 0) {

            issues.push(
                "Repository contains no files"
            );
        }


        // ----------------------------------------
        // 6. Large file issues
        // ----------------------------------------

        if (largeFiles.length > 0) {

            issues.push(
                `${largeFiles.length} extremely large file(s) detected`
            );
        }


        // ----------------------------------------
        // 7. Inaccessible file issues
        // ----------------------------------------

        if (inaccessibleFiles.length > 0) {

            issues.push(
                `${inaccessibleFiles.length} inaccessible file(s) detected`
            );
        }


        // ----------------------------------------
        // 8. Symbolic link issues
        // ----------------------------------------

        if (symbolicLinks.length > 0) {

            issues.push(
                `${symbolicLinks.length} symbolic link(s) detected`
            );
        }


        // ----------------------------------------
        // 9. Determine validation status
        // ----------------------------------------

        let status: ValidationStatus = "valid";


        if (
            totalFiles === 0 ||
            inaccessibleFiles.length > 0
        ) {

            status = "invalid";

        } else if (
            largeFiles.length > 0 ||
            symbolicLinks.length > 0 ||
            binaryFiles.length > 0
        ) {

            status = "warning";
        }


        // ----------------------------------------
        // 10. Build report
        // ----------------------------------------

        const report: RepositoryValidationReport = {

            status,

            repositoryPath,

            totalFiles,

            totalDirectories,

            totalSize,

            binaryFiles,

            largeFiles,

            inaccessibleFiles,

            symbolicLinks,

            issues,

            validatedAt:
                new Date().toISOString()
        };


        // ----------------------------------------
        // 11. Console report
        // ----------------------------------------

        this.printReport(report);


        return report;
    }


    /**
     * Recursively scans the repository.
     */
    private async scanDirectory(

        currentPath: string,

        repositoryRoot: string,

        handlers: {

            incrementFile: () => void;

            incrementDirectory: () => void;

            addSize: (size: number) => void;

            addBinaryFile: (file: string) => void;

            addLargeFile: (file: string) => void;

            addInaccessibleFile: (file: string) => void;

            addSymbolicLink: (file: string) => void;
        }

    ): Promise<void> {

        let entries;


        // ----------------------------------------
        // Read directory
        // ----------------------------------------

        try {

            entries =
                await fs.readdir(
                    currentPath,
                    {
                        withFileTypes: true
                    }
                );

        } catch {

            handlers.addInaccessibleFile(
                this.relativePath(
                    repositoryRoot,
                    currentPath
                )
            );

            return;
        }


        // ----------------------------------------
        // Process entries
        // ----------------------------------------

        for (const entry of entries) {

            const fullPath =
                path.join(
                    currentPath,
                    entry.name
                );


            const relativePath =
                this.relativePath(
                    repositoryRoot,
                    fullPath
                );


            // ------------------------------------
            // Symbolic link
            // ------------------------------------

            if (entry.isSymbolicLink()) {

                handlers.addSymbolicLink(
                    relativePath
                );

                continue;
            }


            // ------------------------------------
            // Directory
            // ------------------------------------

            if (entry.isDirectory()) {

                handlers.incrementDirectory();

                await this.scanDirectory(
                    fullPath,
                    repositoryRoot,
                    handlers
                );

                continue;
            }


            // ------------------------------------
            // File
            // ------------------------------------

            if (entry.isFile()) {

                try {

                    const stats =
                        await fs.stat(fullPath);


                    handlers.incrementFile();


                    handlers.addSize(
                        stats.size
                    );


                    // ----------------------------
                    // Large file
                    // ----------------------------

                    if (
                        stats.size >
                        this.largeFileLimit
                    ) {

                        handlers.addLargeFile(
                            relativePath
                        );
                    }


                    // ----------------------------
                    // Binary file
                    // ----------------------------

                    if (
                        this.isBinaryFile(
                            fullPath
                        )
                    ) {

                        handlers.addBinaryFile(
                            relativePath
                        );
                    }

                } catch {

                    handlers.addInaccessibleFile(
                        relativePath
                    );
                }
            }
        }
    }


    /**
     * Determines whether a file is binary.
     */
    private isBinaryFile(
        filePath: string
    ): boolean {

        const extension =
            path.extname(
                filePath
            ).toLowerCase();


        return this.binaryExtensions.has(
            extension
        );
    }


    /**
     * Convert absolute path to repository-relative path.
     */
    private relativePath(
        repositoryRoot: string,
        filePath: string
    ): string {

        return path.relative(
            repositoryRoot,
            filePath
        );
    }


    /**
     * Print validation report.
     */
    private printReport(
        report: RepositoryValidationReport
    ): void {

        console.log("\n---------------------------------");
        console.log("VALIDATION REPORT");
        console.log("---------------------------------");

        console.log(
            `Status          : ${report.status}`
        );

        console.log(
            `Files           : ${report.totalFiles}`
        );

        console.log(
            `Directories     : ${report.totalDirectories}`
        );

        console.log(
            `Total Size      : ${report.totalSize} bytes`
        );

        console.log(
            `Binary Files    : ${report.binaryFiles.length}`
        );

        console.log(
            `Large Files     : ${report.largeFiles.length}`
        );

        console.log(
            `Inaccessible    : ${report.inaccessibleFiles.length}`
        );

        console.log(
            `Symbolic Links  : ${report.symbolicLinks.length}`
        );


        if (report.issues.length > 0) {

            console.log("\nIssues:");

            for (const issue of report.issues) {

                console.log(
                    `- ${issue}`
                );
            }
        }


        console.log("---------------------------------\n");
    }
}