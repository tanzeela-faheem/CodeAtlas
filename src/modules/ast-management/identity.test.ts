import { it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fixture } from "../../test/fixtures.js";
import { WorkspaceManagerService } from "../respository/services/workspace-manager.service.js";
import { FileAstStore } from "./store.js";
import { legacyArtifactId } from "./identity.js";
import { AstBuilder } from "./builder.js";
import { composeParsers } from "../analysis/parser-composition.js";
import { FileAnalysisStore } from "../analysis/summary-store.js";
import { emptyCounts } from "../analysis/model.js";
import { serializeAst } from "./serializer.js";
import type { AstDocument } from "./model.js";

function document(): AstDocument {
    const source = "const x = 1;";
    const result = composeParsers().manager.parse({
        projectId: "PRJ-123ABC",
        relativePath: "a.js",
        language: "JavaScript",
        sourceCode: source
    });
    if (result.status === "failed") throw new Error(result.code);
    return new AstBuilder().build(result, {
        analysisId: `AN-${randomUUID()}`,
        language: "JavaScript",
        contentHash: createHash("sha256").update(source).digest("hex")
    });
}
it("uses provenance-aware identities, saves equivalent documents idempotently, and rejects incompatible overwrite", async () => {
    const f = await fixture();
    try {
        const wm = new WorkspaceManagerService(f.storage);
        await wm.createWorkspace("PRJ-123ABC");
        const store = new FileAstStore(wm),
            d = document(),
            original = await store.save(d);
        const equivalents = await Promise.all([
            store.save(d),
            store.save({ ...d, createdAt: "2026-11-05T00:00:00.000Z" })
        ]);
        expect(equivalents.every((x) => x.artifactId === original.artifactId)).toBe(true);
        for (const update of [{ grammarVersion: "999.0.0" }, { parserVersion: null }, { parserId: "other-parser" }]) {
            const other = await store.save({ ...d, ...update });
            expect(other.artifactId).not.toBe(original.artifactId);
        }
        const incompatible = { ...d, nodes: d.nodes.map((n) => (n.type === "identifier" ? { ...n, text: "y" } : n)) };
        await expect(store.save(incompatible)).rejects.toMatchObject({ code: "ARTIFACT_CONFLICT" });
        expect(await new FileAstStore(wm).get(d.projectId, d.analysisId, original.artifactId)).toEqual(d);
        expect(await store.list(d.projectId, d.analysisId)).toHaveLength(4);
        const fresh = { ...d, analysisId: `AN-${randomUUID()}` };
        const race = await Promise.allSettled([
            store.save(fresh),
            store.save({ ...incompatible, analysisId: fresh.analysisId })
        ]);
        expect(race.filter((x) => x.status === "fulfilled")).toHaveLength(1);
        expect(race.filter((x) => x.status === "rejected")).toHaveLength(1);
        const rejected = race.find((x) => x.status === "rejected") as PromiseRejectedResult;
        expect(rejected.reason).toMatchObject({ code: "ARTIFACT_CONFLICT" });
    } finally {
        await f.cleanup();
    }
});
it("retrieves version-one legacy keys without rewriting or silently reinterpreting them", async () => {
    const f = await fixture();
    try {
        const wm = new WorkspaceManagerService(f.storage);
        const ws = await wm.createWorkspace("PRJ-123ABC");
        const { normalizationVersion: _policy, ...legacy } = document();
        const id = legacyArtifactId(legacy),
            directory = path.join(ws.analysisPath, legacy.analysisId);
        await fs.mkdir(directory);
        await fs.writeFile(path.join(directory, `${id}.ast.json`), serializeAst(legacy));
        const store = new FileAstStore(wm);
        expect(await store.get(legacy.projectId, legacy.analysisId, id)).toEqual(legacy);
        expect((await store.list(legacy.projectId, legacy.analysisId))[0]?.artifactId).toBe(id);
        const summaries = new FileAnalysisStore(wm);
        const summary = {
            schemaVersion: 1 as const,
            projectId: legacy.projectId,
            analysisId: legacy.analysisId,
            status: "completed" as const,
            startedAt: legacy.createdAt,
            completedAt: legacy.createdAt,
            counts: { ...emptyCounts(), parsed: 1 },
            files: [
                {
                    relativePath: legacy.relativePath,
                    status: "parsed" as const,
                    artifact: {
                        artifactId: id,
                        relativePath: legacy.relativePath,
                        contentHash: legacy.contentHash,
                        schemaVersion: 1 as const
                    }
                }
            ]
        };
        await summaries.save(summary);
        expect(await new FileAnalysisStore(wm).get(legacy.projectId, legacy.analysisId)).toEqual(summary);
        const fresh = await store.save(legacy);
        expect(fresh.artifactId).not.toBe(id);
        expect(await fs.readFile(path.join(directory, `${id}.ast.json`), "utf8")).toBe(serializeAst(legacy));
    } finally {
        await f.cleanup();
    }
});
