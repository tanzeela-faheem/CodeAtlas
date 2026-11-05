import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fixture, zip } from "../../test/fixtures.js";
import { WorkspaceManagerService } from "./services/workspace-manager.service.js";
import { RepositoryImporterService } from "./services/repository-importer.service.js";
import { FileProjectStore } from "./services/project-store.js";
import { ZipExtractorService } from "./services/zip-extractor.service.js";
import { LocalDirectoryImporterService } from "./services/local-directory-importer.service.js";
import { ProjectDetectionOrchestratorService } from "../project-detection/services/project-detection-orchestrator.service.js";

beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "table").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
describe("repository boundaries", () => {
    it("imports and reloads local project state; collisions preserve existing workspace", async () => {
        const f = await fixture();
        try {
            const manager = new WorkspaceManagerService(f.storage);
            await manager.createWorkspace("PRJ-AAAAAA");
            await fs.writeFile(path.join(f.storage, "PRJ-AAAAAA", "repository", "keep"), "owned");
            let calls = 0;
            const importer = new RepositoryImporterService(manager, new FileProjectStore(manager), undefined, () =>
                calls++ === 0 ? "PRJ-AAAAAA" : "PRJ-BBBBBB"
            );
            const result = await importer.importRepository({ sourceType: "local", source: f.source });
            expect(result.status).toBe("imported");
            expect(
                (await new FileProjectStore(new WorkspaceManagerService(f.storage)).get(result.projectId)).result
                    .projectProfile?.languages.totalSourceFiles
            ).toBe(1);
            expect(await fs.readFile(path.join(f.storage, "PRJ-AAAAAA", "repository", "keep"), "utf8")).toBe("owned");
            const race = await Promise.allSettled([
                manager.createWorkspace("PRJ-CCCCCC"),
                manager.createWorkspace("PRJ-CCCCCC")
            ]);
            expect(race.filter((x) => x.status === "fulfilled")).toHaveLength(1);
            await expect(fs.stat(path.join(f.storage, "PRJ-CCCCCC", "repository"))).resolves.toBeDefined();
        } finally {
            await f.cleanup();
        }
    });
    it("imports ZIP; rejects traversal and expansion limits", async () => {
        const f = await fixture();
        try {
            const archive = path.join(f.root, "project.zip");
            await fs.writeFile(archive, zip({ "src/app.jsx": "export default <h1>Hello</h1>;" }));
            const manager = new WorkspaceManagerService(f.storage);
            const result = await new RepositoryImporterService(manager).importRepository({
                sourceType: "zip",
                source: archive
            });
            expect(result.status).toBe("imported");
            const dest = path.join(f.root, "extract");
            await fs.writeFile(archive, zip({ "../escape.js": "bad" }));
            await expect(new ZipExtractorService().extractZip(archive, dest)).rejects.toThrow("Unsafe");
            await fs.writeFile(archive, zip({ "big.js": "abcdef" }));
            await expect(
                new ZipExtractorService({ maxFiles: 1, maxBytes: 1000, maxFileBytes: 2, maxDepth: 5 }).extractZip(
                    archive,
                    dest
                )
            ).rejects.toThrow("limit");
        } finally {
            await f.cleanup();
        }
    });
    it("isolates detection failures and cleans only failed acquisitions", async () => {
        const f = await fixture();
        try {
            const manager = new WorkspaceManagerService(f.storage);
            const detector = new ProjectDetectionOrchestratorService();
            vi.spyOn(detector, "detectProject").mockRejectedValue(new Error("fixture detection failure"));
            const result = await new RepositoryImporterService(manager, undefined, detector).importRepository({
                sourceType: "local",
                source: f.source
            });
            expect(result.status).toBe("imported");
            expect(result.detectionError).toBeDefined();
            expect((await new FileProjectStore(manager).get(result.projectId)).result.detectionError).toBeDefined();
            const previous = await fs.readdir(f.storage);
            await expect(
                new RepositoryImporterService(manager).importRepository({
                    sourceType: "local",
                    source: path.join(f.root, "absent")
                })
            ).rejects.toThrow();
            expect(await fs.readdir(f.storage)).toEqual(previous);
            const dest = path.join(f.root, "bounded");
            await fs.mkdir(dest);
            await expect(
                new LocalDirectoryImporterService({
                    maxFiles: 0,
                    maxBytes: 1,
                    maxFileBytes: 1,
                    maxDepth: 1
                }).importDirectory(f.source, dest)
            ).rejects.toThrow();
        } finally {
            await f.cleanup();
        }
    });
});

it("returns distinct invalid validation outcome and removes only its newly created workspace", async () => {
    const f = await fixture();
    try {
        await fs.unlink(path.join(f.source, "src/app.js"));
        const workspaces = new WorkspaceManagerService(f.storage);
        const result = await new RepositoryImporterService(workspaces).importRepository({
            sourceType: "local",
            source: f.source
        });
        expect(result.status).toBe("failed");
        expect(result.validation?.status).toBe("invalid");
        expect(await fs.readdir(f.storage)).toEqual([]);
    } finally {
        await f.cleanup();
    }
});
