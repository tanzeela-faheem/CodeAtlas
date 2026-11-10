import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fixture, zip } from "../../../test/fixtures.js";
import { ZipExtractorService } from "./zip-extractor.service.js";
import { RepositoryImporterService } from "./repository-importer.service.js";
import { WorkspaceManagerService } from "./workspace-manager.service.js";

const limits = { maxFiles: 3, maxBytes: 1000, maxFileBytes: 600, maxDepth: 5 };

describe("ZIP resource regression", () => {
    it("enforces archive, entry, declared per-file and aggregate limits before writing", async () => {
        const f = await fixture();
        try {
            const archive = path.join(f.root, "test.zip");
            const destination = path.join(f.root, "output");
            const cases = [
                { data: zip({ "a.js": "a".repeat(1000) }), policy: limits },
                { data: zip({ "a.js": "a", "b.js": "b" }), policy: { ...limits, maxFiles: 1 } },
                { data: zip({ "a.js": "a".repeat(601) }, true), policy: limits },
                { data: zip({ "a.js": "a".repeat(600), "b.js": "b".repeat(401) }, true), policy: limits }
            ];
            for (const { data, policy } of cases) {
                await fs.writeFile(archive, data);
                await expect(new ZipExtractorService(policy).extractZip(archive, destination)).rejects.toThrow();
                await expect(fs.stat(destination)).rejects.toMatchObject({ code: "ENOENT" });
            }
        } finally { await f.cleanup(); }
    });

    it("accepts exact expanded limits and rejects understated streamed sizes before writing bytes", async () => {
        const f = await fixture();
        try {
            const archive = path.join(f.root, "test.zip");
            const destination = path.join(f.root, "valid");
            await fs.writeFile(archive, zip({ "a.js": "a".repeat(600), "b.js": "b".repeat(400) }, true));
            await expect(new ZipExtractorService(limits).extractZip(archive, destination)).resolves.toMatchObject({ fileCount: 2 });
            expect((await fs.stat(path.join(destination, "a.js"))).size).toBe(600);
            // Both headers lie about expanded size; compressed payload still expands to 601 bytes.
            const data = zip({ "a.js": "x".repeat(601) }, true);
            const central = data.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
            data.writeUInt32LE(600, 22);
            data.writeUInt32LE(600, central + 24);
            await fs.writeFile(archive, data);
            const rejected = path.join(f.root, "rejected");
            const error = await new ZipExtractorService(limits).extractZip(archive, rejected).catch((e: unknown) => e);
            expect(error).toBeInstanceOf(Error);
            expect((error as Error).cause).toMatchObject({ message: "Archive expansion limit exceeded" });
            expect((await fs.stat(path.join(rejected, "a.js"))).size).toBeLessThanOrEqual(600);
        } finally { await f.cleanup(); }
    });

    it("rejects invalid archives and preserves unrelated destinations; importer cleans only its workspace", async () => {
        const f = await fixture();
        try {
            const archive = path.join(f.root, "test.zip");
            const destination = path.join(f.root, "existing");
            await fs.mkdir(destination);
            await fs.writeFile(path.join(destination, "keep"), "owned");
            await fs.writeFile(archive, zip({ "a.js": "ok" }));
            await expect(new ZipExtractorService().extractZip(archive, destination)).rejects.toThrow("empty");
            await fs.writeFile(archive, "invalid ZIP");
            await expect(new ZipExtractorService().extractZip(archive, destination)).rejects.toThrow();
            const manager = new WorkspaceManagerService(f.storage);
            await manager.createWorkspace("PRJ-AAAAAA");
            await fs.writeFile(path.join(f.storage, "PRJ-AAAAAA", "repository", "keep"), "owned");
            await fs.writeFile(archive, zip({ "../escape.js": "bad" }));
            await expect(new RepositoryImporterService(manager, undefined, undefined, () => "PRJ-BBBBBB")
                .importRepository({ sourceType: "zip", source: archive })).rejects.toMatchObject({ code: "ACQUISITION_FAILED" });
            expect(await fs.readdir(f.storage)).toEqual(["PRJ-AAAAAA"]);
            expect(await fs.readFile(path.join(destination, "keep"), "utf8")).toBe("owned");
            expect(await fs.readFile(path.join(f.storage, "PRJ-AAAAAA", "repository", "keep"), "utf8")).toBe("owned");
            await expect(fs.stat(path.join(f.root, "escape.js"))).rejects.toMatchObject({ code: "ENOENT" });
        } finally { await f.cleanup(); }
    });
});
