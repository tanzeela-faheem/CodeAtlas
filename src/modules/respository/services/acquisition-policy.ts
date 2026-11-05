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
        )
            throw new Error("Acquisition resource limit exceeded");
    }
}

// Enforce a final inventory budget before detection (including Git acquisitions).
// This does not claim to cap Git's disk allocation while the child process runs.
export async function verifyAcquisition(root: string, limits = DEFAULT_ACQUISITION_LIMITS): Promise<void> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const budget = new AcquisitionBudget(limits);
    const scan = async (directory: string, depth: number): Promise<void> => {
        if (depth > limits.maxDepth) throw new Error("Acquisition depth limit exceeded");
        for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
            if (entry.isSymbolicLink()) continue;
            const target = path.join(directory, entry.name);
            const stat = await fs.lstat(target);
            budget.add(stat.isFile() ? stat.size : 0, depth);
            if (stat.isDirectory()) await scan(target, depth + 1);
        }
    };
    await scan(root, 0);
}
