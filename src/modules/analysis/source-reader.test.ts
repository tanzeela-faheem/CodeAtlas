import { it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fixture } from "../../test/fixtures.js";
import { WorkspaceManagerService } from "../respository/services/workspace-manager.service.js";
import { SourceReader } from "./source-reader.js";
import { composeParsers } from "./parser-composition.js";

it("bounds source reads and rejects unsafe, binary, encoding, changed and symlink sources", async () => {
    const f = await fixture();
    try {
        const workspaces = new WorkspaceManagerService(f.storage);
        const w = await workspaces.createWorkspace("PRJ-123ABC");
        const reader = new SourceReader(workspaces, 32);
        const file = {
            absolutePath: "",
            relativePath: "app.js",
            language: "JavaScript" as const,
            extension: ".js",
            linesOfCode: 1,
            isGenerated: false
        };
        await fs.writeFile(path.join(w.repositoryPath, "app.js"), "let x = 1;");
        const read = await reader.read(w.projectId, file, "snapshot");
        expect(read.status).toBe("read");
        if (read.status === "read")
            expect(composeParsers().manager.parse({ projectId: w.projectId, ...read }).status).toBe("success");
        for (const relativePath of ["../secret.js", "/tmp/secret.js", "C:/secret.js"])
            expect((await reader.read(w.projectId, { ...file, relativePath }, "snapshot")).status).toBe("read_failed");
        await fs.symlink(path.join(w.repositoryPath, "app.js"), path.join(w.repositoryPath, "link.js"));
        expect((await reader.read(w.projectId, { ...file, relativePath: "link.js" }, "snapshot")).status).toBe(
            "read_failed"
        );
        for (const [content, code] of [
            [Buffer.alloc(33, 65), "FILE_TOO_LARGE"],
            [Buffer.from([0]), "BINARY_SOURCE"],
            [Buffer.from([255]), "UNSUPPORTED_ENCODING"]
        ] as const) {
            await fs.writeFile(path.join(w.repositoryPath, "app.js"), content);
            expect(await reader.read(w.projectId, file, "snapshot")).toMatchObject({ code });
        }
        await fs.writeFile(path.join(w.repositoryPath, "app.js"), "changed");
        expect(await reader.read(w.projectId, { ...file, contentHash: "old" }, "snapshot")).toMatchObject({
            code: "SOURCE_CHANGED"
        });
    } finally {
        await f.cleanup();
    }
});
