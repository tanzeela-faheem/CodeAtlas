import { it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fixture } from "../../test/fixtures.js";
import { WorkspaceManagerService } from "../respository/services/workspace-manager.service.js";
import { RepositoryImporterService } from "../respository/services/repository-importer.service.js";
import { FileProjectStore, type ProjectState } from "../respository/services/project-store.js";
import { FileAnalysisStore } from "./summary-store.js";
import { emptyCounts, type AnalysisSummary } from "./model.js";
import { AnalysisCoordinator } from "./coordinator.js";
import { SourceReader } from "./source-reader.js";
import { FileAstStore } from "../ast-management/store.js";
import { validateProjectState } from "../respository/services/project-validation.js";
import { validateAnalysisSummary } from "./summary-validation.js";

it("validates complete project state on save and reload, preserving old manifests without additive identity", async () => {
    const f = await fixture({ "a.js": "let a = 1;", "b.jsx": "export default <h1/>;" });
    try {
        const wm = new WorkspaceManagerService(f.storage),
            projects = new FileProjectStore(wm);
        const imported = await new RepositoryImporterService(wm, projects).importRepository({
            sourceType: "local",
            source: f.source
        });
        const state = await projects.get(imported.projectId),
            file = path.join(imported.workspacePath, "metadata/project.json");
        const changes: [string, (p: ProjectState) => unknown][] = [
            [
                "profile identity",
                (p) => ({
                    ...p,
                    result: { ...p.result, projectProfile: { ...p.result.projectProfile, projectId: "PRJ-FFFFFF" } }
                })
            ],
            [
                "incomplete profile",
                (p) => ({
                    ...p,
                    result: {
                        ...p.result,
                        projectProfile: { projectId: p.result.projectId, languages: { sourceFiles: [] } }
                    }
                })
            ],
            ["top identity", (p) => ({ ...p, projectId: "PRJ-FFFFFF" })],
            [
                "duplicate paths",
                (p) => ({
                    ...p,
                    result: {
                        ...p.result,
                        projectProfile: {
                            ...p.result.projectProfile,
                            languages: {
                                ...p.result.projectProfile!.languages,
                                sourceFiles: [
                                    p.result.projectProfile!.languages.sourceFiles[0],
                                    p.result.projectProfile!.languages.sourceFiles[0]
                                ]
                            }
                        }
                    }
                })
            ],
            [
                "bad source language",
                (p) => ({
                    ...p,
                    result: {
                        ...p.result,
                        projectProfile: {
                            ...p.result.projectProfile,
                            languages: {
                                ...p.result.projectProfile!.languages,
                                sourceFiles: [
                                    { ...p.result.projectProfile!.languages.sourceFiles[0], language: "MadeUpLanguage" }
                                ]
                            }
                        }
                    }
                })
            ],
            ["invalid scalar", (p) => ({ ...p, result: { ...p.result, sourceType: false } })],
            ["bad timestamp", (p) => ({ ...p, updatedAt: "yesterday" })],
            [
                "bad inventory path",
                (p) => ({
                    ...p,
                    result: {
                        ...p.result,
                        projectProfile: {
                            ...p.result.projectProfile,
                            languages: {
                                ...p.result.projectProfile!.languages,
                                sourceFiles: [
                                    { ...p.result.projectProfile!.languages.sourceFiles[0], relativePath: "../a.js" }
                                ]
                            }
                        }
                    }
                })
            ]
        ];
        for (const [name, change] of changes) {
            const invalid = change(state);
            expect(() => validateProjectState(invalid), name).toThrow("Invalid");
            await expect(projects.save(invalid as ProjectState), name).rejects.toThrow("Invalid");
            await fs.writeFile(file, JSON.stringify(invalid));
            await expect(new FileProjectStore(wm).get(imported.projectId), name).rejects.toMatchObject({
                code: "STORAGE_CORRUPT"
            });
        }
        const { projectId: _topId, ...legacy } = state;
        await fs.writeFile(file, JSON.stringify(legacy));
        expect(
            (await new FileProjectStore(wm).get(imported.projectId)).result.projectProfile?.languages.totalSourceFiles
        ).toBe(2);
        const coordinator = new AnalysisCoordinator(
            { get: async () => changes[1]![1](state) as ProjectState, save: async () => {} },
            new FileAnalysisStore(wm),
            new FileAstStore(wm),
            new SourceReader(wm)
        );
        await expect(coordinator.start(imported.projectId)).rejects.toMatchObject({ code: "STORAGE_CORRUPT" });
    } finally {
        await f.cleanup();
    }
});
it("validates summary counts, lifecycle, paths, outcomes and artifact owners on save and reload", async () => {
    const f = await fixture();
    try {
        const wm = new WorkspaceManagerService(f.storage);
        const ws = await wm.createWorkspace("PRJ-123ABC");
        const summaries = new FileAnalysisStore(wm);
        const valid: AnalysisSummary = {
            schemaVersion: 1,
            projectId: ws.projectId,
            analysisId: `AN-${randomUUID()}`,
            status: "completed",
            startedAt: "2026-11-05T00:00:00.000Z",
            completedAt: "2026-11-05T00:00:01.000Z",
            counts: { ...emptyCounts(), skipped: 1 },
            files: [{ relativePath: "generated/a.js", status: "skipped", code: "GENERATED_SOURCE" }]
        };
        await summaries.save(valid);
        const file = path.join(ws.analysisPath, valid.analysisId, "summary.json");
        const changes: [string, (s: AnalysisSummary) => unknown][] = [
            ["negative counts", (s) => ({ ...s, counts: { ...s.counts, parsed: -42 } })],
            ["wrong totals", (s) => ({ ...s, counts: emptyCounts() })],
            ["unknown status", (s) => ({ ...s, status: "made-up" })],
            ["queued contradiction", (s) => ({ ...s, status: "queued" })],
            ["running contradiction", (s) => ({ ...s, status: "running" })],
            ["bad time", (s) => ({ ...s, startedAt: "not-a-date" })],
            ["reversed time", (s) => ({ ...s, completedAt: "2026-11-04T00:00:00.000Z" })],
            [
                "missing completion",
                (s) => {
                    const { completedAt: _, ...other } = s;
                    return other;
                }
            ],
            ["unknown file status", (s) => ({ ...s, files: [{ relativePath: "a.js", status: "invented" }] })],
            ["traversal", (s) => ({ ...s, files: [{ ...s.files[0], relativePath: "../../outside.js" }] })],
            ["missing failure code", (s) => ({ ...s, status: "failed" })],
            ["malformed error code", (s) => ({ ...s, files: [{ ...s.files[0], code: "secret /path" }] })],
            [
                "foreign artifact",
                (s) => ({
                    ...s,
                    counts: { ...emptyCounts(), parsed: 1 },
                    files: [
                        {
                            relativePath: "a.js",
                            status: "parsed",
                            artifact: {
                                artifactId: "a".repeat(64),
                                relativePath: "a.js",
                                contentHash: "b".repeat(64),
                                schemaVersion: 1,
                                projectId: "PRJ-FFFFFF",
                                analysisId: s.analysisId
                            }
                        }
                    ]
                })
            ],
            [
                "artifact on failed file",
                (s) => ({
                    ...s,
                    files: [
                        {
                            ...s.files[0],
                            artifact: {
                                artifactId: "a".repeat(64),
                                relativePath: "generated/a.js",
                                contentHash: "b".repeat(64),
                                schemaVersion: 1
                            }
                        }
                    ]
                })
            ]
        ];
        for (const [name, change] of changes) {
            const invalid = change(valid);
            expect(() => validateAnalysisSummary(invalid), name).toThrow("Invalid");
            await expect(summaries.save(invalid as AnalysisSummary), name).rejects.toThrow("Invalid");
            await fs.writeFile(file, JSON.stringify(invalid));
            await expect(new FileAnalysisStore(wm).get(valid.projectId, valid.analysisId), name).rejects.toMatchObject({
                code: "STORAGE_CORRUPT"
            });
        }
        await summaries.save(valid);
        expect(await new FileAnalysisStore(wm).get(valid.projectId, valid.analysisId)).toEqual(valid);
        const mutation = structuredClone(valid),
            pending = summaries.save(mutation);
        mutation.counts.skipped = -1;
        await pending;
        expect((await summaries.get(valid.projectId, valid.analysisId)).counts.skipped).toBe(1);
    } finally {
        await f.cleanup();
    }
});
