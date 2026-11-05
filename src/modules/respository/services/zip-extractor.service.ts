import { AcquisitionBudget, DEFAULT_ACQUISITION_LIMITS, type AcquisitionLimits } from "./acquisition-policy.js";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import unzipper from "unzipper";

export interface ZipExtractionResult {
    zipPath: string;
    extractionPath: string;
    fileCount: number;
    directoryCount: number;
}

export class ZipExtractorService {
    constructor(private readonly limits: AcquisitionLimits = DEFAULT_ACQUISITION_LIMITS) {}

    async extractZip(zipPath: string, extractionPath: string): Promise<ZipExtractionResult> {
        // ----------------------------------------
        // 1. Check ZIP file exists
        // ----------------------------------------

        try {
            await fsp.access(zipPath);
        } catch {
            throw new Error("ZIP file does not exist or cannot be accessed");
        }

        // ----------------------------------------
        // 2. Check extension
        // ----------------------------------------

        if (path.extname(zipPath).toLowerCase() !== ".zip") {
            throw new Error("Invalid archive format. Only ZIP files are supported.");
        }

        // ----------------------------------------
        // 3. Create extraction directory
        // ----------------------------------------

        await fsp.mkdir(extractionPath, {
            recursive: true
        });

        if ((await fsp.stat(zipPath)).size > this.limits.maxBytes) throw new Error("Archive too large");
        const budget = new AcquisitionBudget(this.limits);
        extractionPath = await fsp.realpath(extractionPath);
        let fileCount = 0;
        let directoryCount = 0;

        try {
            // ----------------------------------------
            // 4. Open ZIP
            // ----------------------------------------

            const directory = await unzipper.Open.file(zipPath);

            // ----------------------------------------
            // 5. Process every ZIP entry
            // ----------------------------------------

            if (directory.files.length > this.limits.maxFiles) throw new Error("Archive entry limit exceeded");
            for (const entry of directory.files) {
                const entryPath = entry.path;
                if (
                    entryPath.includes("\\") ||
                    entryPath.includes("\0") ||
                    /^[A-Za-z]:/.test(entryPath) ||
                    entryPath.split("/").length > this.limits.maxDepth
                )
                    throw new Error("Unsafe ZIP entry");

                // ------------------------------------
                // Security check
                // ------------------------------------

                const destinationPath = path.resolve(extractionPath, entryPath);

                const normalizedExtractionPath = path.resolve(extractionPath) + path.sep;

                if (
                    !destinationPath.startsWith(normalizedExtractionPath) &&
                    destinationPath !== path.resolve(extractionPath)
                ) {
                    throw new Error(`Unsafe ZIP entry detected: ${entryPath}`);
                }

                // ------------------------------------
                // Directory
                // ------------------------------------

                if (entry.type === "Directory" || entryPath.endsWith("/")) {
                    await fsp.mkdir(destinationPath, {
                        recursive: true
                    });

                    directoryCount++;

                    continue;
                }

                // ------------------------------------
                // File
                // ------------------------------------

                await fsp.mkdir(path.dirname(destinationPath), {
                    recursive: true
                });

                budget.add(entry.uncompressedSize, entryPath.split("/").length);
                let actual = 0;
                const guard = new Transform({
                    transform: (chunk: Buffer, _encoding, callback) => {
                        actual += chunk.length;
                        if (actual > entry.uncompressedSize || actual > this.limits.maxFileBytes)
                            callback(new Error("Archive expansion limit exceeded"));
                        else callback(null, chunk);
                    }
                });
                await pipeline(entry.stream(), guard, fs.createWriteStream(destinationPath, { flags: "wx" }));

                fileCount++;
            }

            return {
                zipPath,

                extractionPath,

                fileCount,

                directoryCount
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown ZIP extraction error";

            // ----------------------------------------
            // Cleanup incomplete extraction
            // ----------------------------------------

            try {
                await fsp.rm(extractionPath, {
                    recursive: true,
                    force: true
                });
            } catch {}

            throw new Error(`ZIP extraction failed: ${message}`);
        }
    }
}
