import {
    DEFAULT_ACQUISITION_LIMITS,
    type AcquisitionLimits,
    shouldSkipDirectory,
    shouldSkipFile
} from "./acquisition-policy.js";

import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
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
        // 1. Validate archive.
        if (path.extname(zipPath).toLowerCase() !== ".zip") {
            throw new Error("Only ZIP archives are supported");
        }

        const archiveStat = await fsp.stat(zipPath);

        if (!archiveStat.isFile()) {
            throw new Error("ZIP path is not a regular file");
        }

        if (archiveStat.size > this.limits.maxBytes) {
            throw new Error("Archive too large");
        }

        const archive = await unzipper.Open.file(zipPath);

        if (archive.files.length > this.limits.maxFiles) {
            throw new Error("Archive entry limit exceeded");
        }

        // 2. Validate all archive entries before extraction.
        const validated = archive.files.map((entry) => {
            const raw = entry.path;

            if (!raw || raw.includes("\\") || raw.includes("\0") || raw.startsWith("/") || /^[A-Za-z]:/.test(raw)) {
                throw new Error("Unsafe ZIP path");
            }

            const parts = raw.split("/").filter(Boolean);

            if (
                parts.length === 0 ||
                parts.some((p) => p === "." || p === "..") ||
                parts.length > this.limits.maxDepth
            ) {
                throw new Error("Unsafe ZIP entry depth or traversal");
            }

            const mode = (entry.externalFileAttributes >>> 16) & 0xffff;

            const kind = mode & 0xf000;

            if (kind !== 0 && kind !== 0x8000 && kind !== 0x4000 && kind !== 0xa000) {
                throw new Error("Unsupported ZIP entry type");
            }

            const isDirectory = entry.type === "Directory" || raw.endsWith("/");

            if (
                (kind === 0x4000 && !isDirectory) ||
                (kind === 0x8000 && isDirectory) ||
                (kind === 0xa000 && isDirectory)
            ) {
                throw new Error("Inconsistent ZIP entry type");
            }

            return {
                entry,
                parts,
                isDirectory,
                kind
            };
        });

        // 3. Detect duplicate paths and file/directory conflicts.
        const seen = new Map<string, "file" | "directory">();

        for (const item of validated) {
            const key = item.parts.join("/");
            const type = item.isDirectory ? "directory" : "file";

            if (seen.has(key)) {
                throw new Error("Duplicate ZIP entry");
            }

            seen.set(key, type);
        }

        for (const [key] of seen) {
            const parts = key.split("/");

            for (let i = 1; i < parts.length; i++) {
                const parent = parts.slice(0, i).join("/");

                if (seen.get(parent) === "file") {
                    throw new Error("ZIP path conflicts with file");
                }
            }
        }

        // 4. Apply the shared exclusion policy.
        const included = validated.filter((item) => {
            const { parts, isDirectory, kind } = item;

            // Never extract symbolic links.
            if (kind === 0xa000) {
                return false;
            }

            const directoryParts = isDirectory ? parts : parts.slice(0, -1);

            if (directoryParts.some(shouldSkipDirectory)) {
                return false;
            }

            if (!isDirectory && shouldSkipFile(parts[parts.length - 1]!)) {
                return false;
            }

            return true;
        });

        // 5. Accept an existing empty extraction directory.
        // The importer owns the workspace.
        await fsp.mkdir(extractionPath, {
            recursive: true
        });

        const root = await fsp.realpath(extractionPath);

        const rootStat = await fsp.lstat(root);

        if (!rootStat.isDirectory()) {
            throw new Error("Extraction destination is not a directory");
        }

        const existingEntries = await fsp.readdir(root);

        if (existingEntries.length !== 0) {
            throw new Error("Extraction destination must be empty");
        }

        // 6. Extract eligible entries.
        let fileCount = 0;
        let directoryCount = 0;
        let totalBytes = 0;

        try {
            for (const item of included) {
                const { entry, parts, isDirectory } = item;

                const destination = path.join(root, ...parts);

                const relative = path.relative(root, destination);

                if (
                    relative === "" ||
                    relative === ".." ||
                    relative.startsWith(".." + path.sep) ||
                    path.isAbsolute(relative)
                ) {
                    throw new Error("Unsafe extraction destination");
                }

                if (isDirectory) {
                    await fsp.mkdir(destination, {
                        recursive: true
                    });

                    directoryCount++;
                    continue;
                }

                await fsp.mkdir(path.dirname(destination), {
                    recursive: true
                });

                let actualBytes = 0;

                const guard = new Transform({
                    transform: (chunk: Buffer, _encoding, callback) => {
                        actualBytes += chunk.length;
                        totalBytes += chunk.length;

                        if (actualBytes > entry.uncompressedSize || totalBytes > this.limits.maxBytes) {
                            callback(new Error("Archive expansion limit exceeded"));
                            return;
                        }

                        callback(null, chunk);
                    }
                });

                await pipeline(
                    entry.stream(),
                    guard,
                    fs.createWriteStream(destination, {
                        flags: "wx"
                    })
                );

                if (actualBytes !== entry.uncompressedSize) {
                    throw new Error("ZIP entry size mismatch");
                }

                fileCount++;
            }

            return {
                zipPath,
                extractionPath: root,
                fileCount,
                directoryCount
            };
        } catch (error) {
            // Do not delete the importer-owned workspace.
            // The importer is responsible for cleanup.
            throw new Error("ZIP extraction failed", { cause: error });
        }
    }
}
