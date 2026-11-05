import path from "node:path";

export interface AcquisitionLimits {
    maxFiles: number;
    maxBytes: number;
    maxFileBytes: number;
    maxDepth: number;
}

export const DEFAULT_ACQUISITION_LIMITS: AcquisitionLimits = {
    maxFiles: 5000,
    maxBytes: 100_000_000,
    maxFileBytes: 10_000_000,
    maxDepth: 50
};

const EXCLUDED_DIRECTORIES = new Set([
    ".git",
    "node_modules",
    "dist",
    "build",
    "coverage",
    ".next",
    ".venv",
    "__pycache__",
    "target"
]);

const EXCLUDED_EXTENSIONS = new Set([
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".svg",
    ".ico",
    ".bmp",
    ".mp3",
    ".mp4",
    ".wav",
    ".mov",
    ".zip",
    ".tar",
    ".gz",
    ".7z",
    ".pdf",
    ".exe",
    ".dll",
    ".so",
    ".class",
    ".jar",
    ".pyc"
]);

export function shouldSkipDirectory(name: string): boolean {
    return EXCLUDED_DIRECTORIES.has(name);
}

export function shouldSkipFile(name: string): boolean {
    return EXCLUDED_EXTENSIONS.has(path.extname(name).toLowerCase());
}

export class AcquisitionBudget {
    files = 0;
    bytes = 0;
    constructor(readonly limits = DEFAULT_ACQUISITION_LIMITS) {}
    add(bytes: number, depth: number): void {
        this.files++;
        this.bytes += bytes;
        if (
            this.files > this.limits.maxFiles ||
            this.bytes > this.limits.maxBytes ||
            bytes > this.limits.maxFileBytes ||
            depth > this.limits.maxDepth
        ) {
            throw new Error("Acquisition resource limit exceeded");
        }
    }
}

// Enforce a final inventory budget before detection (including Git acquisitions).
// This does not claim to cap Git's disk allocation while the child process runs.
export async function verifyAcquisition(root: string, limits = DEFAULT_ACQUISITION_LIMITS): Promise<void> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const budget = new AcquisitionBudget(limits);

    const scan = async (directory: string, depth: number): Promise<void> => {
        if (depth > limits.maxDepth) {
            throw new Error("Acquisition depth limit exceeded");
        }

        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
            if (entry.isSymbolicLink()) continue;
            if (entry.isDirectory() && shouldSkipDirectory(entry.name)) continue;
            if (entry.isFile() && shouldSkipFile(entry.name)) continue;

            const target = path.join(directory, entry.name);
            const stat = await fs.lstat(target);

            if (stat.isDirectory()) {
                await scan(target, depth + 1);
            } else if (stat.isFile()) {
                budget.add(stat.size, depth);
            }
        }
    };

    await scan(root, 0);
}
