import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export function relativeSource(value: string): string {
    if (
        typeof value !== "string" ||
        !value ||
        value.includes("\0") ||
        value.includes("\\") ||
        value.startsWith("/") ||
        /^[A-Za-z]:/.test(value) ||
        value.split("/").some((x) => x === ".." || x === "." || !x)
    )
        throw new Error("Invalid relative source path");
    return value;
}
export async function contained(root: string, target: string): Promise<string> {
    const [base, resolved] = await Promise.all([fs.realpath(root), fs.realpath(target)]);
    if (resolved !== base && !resolved.startsWith(base + path.sep)) throw new Error("Path outside trusted root");
    return resolved;
}
export const MAX_JSON_BYTES = 64 * 1024 * 1024;
export class StoredJsonError extends Error {}
export async function atomicJson(file: string, data: unknown): Promise<void> {
    const text = JSON.stringify(data);
    if (Buffer.byteLength(text) > MAX_JSON_BYTES) throw new StoredJsonError("Stored artifact too large");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await contained(path.dirname(file), path.dirname(file));
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
        await fs.writeFile(temporary, text, { flag: "wx", mode: 0o600 });
        await fs.rename(temporary, file);
    } finally {
        await fs.rm(temporary, { force: true });
    }
}
export async function readJson(file: string): Promise<unknown> {
    const stat = await fs.stat(file);
    if (stat.size > MAX_JSON_BYTES) throw new StoredJsonError("Stored artifact too large");
    return JSON.parse(await fs.readFile(file, "utf8")) as unknown;
}
