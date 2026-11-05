import { it, expect, vi } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import { fixture } from "../../test/fixtures.js";
import { WorkspaceManagerService } from "../respository/services/workspace-manager.service.js";
import { RepositoryImporterService } from "../respository/services/repository-importer.service.js";
import { FileProjectStore } from "../respository/services/project-store.js";
import { FileAstStore } from "../ast-management/store.js";
import { FileAnalysisStore } from "./summary-store.js";
import { SourceReader } from "./source-reader.js";
import { AnalysisCoordinator } from "./coordinator.js";
import { AstBuilder } from "../ast-management/builder.js";

it("imports, detects, parses, normalizes, persists and reloads a mixed repository", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {}),
        table = vi.spyOn(console, "table").mockImplementation(() => {});
    const f = await fixture({
        "src/app.js": 'import x from "x"; export class App { run(){ return "😀"; } }\r\n',
        "ui/App.jsx": "export default <h1>Hello</h1>;",
        "src/invalid.js": "const = ;",
        "src/not.ts": "let n: number = 1;",
        "index.html": "<h1>Hi</h1>",
        "style.css": "h1 {}",
        "generated/out.js": "const generated = 1;",
        "src/changed.js": "let before = 1;",
        "src/gone.js": "let gone = 1;"
    });
    try {
        const workspaces = new WorkspaceManagerService(f.storage),
            projects = new FileProjectStore(workspaces),
            asts = new FileAstStore(workspaces),
            summaries = new FileAnalysisStore(workspaces);
        const result = await new RepositoryImporterService(workspaces, projects).importRepository({
            sourceType: "local",
            source: f.source
        });
        expect(result.status).toBe("imported");
        expect(result.projectProfile).toBeDefined();
        await fs.writeFile(path.join(result.repositoryPath, "src/changed.js"), "let changed = 2;");
        await fs.unlink(path.join(result.repositoryPath, "src/gone.js"));
        const coordinator = new AnalysisCoordinator(projects, summaries, asts, new SourceReader(workspaces));
        const started = await coordinator.start(result.projectId);
        expect(started.status).toBe("queued");
        await expect(coordinator.start(result.projectId)).rejects.toThrow("BUSY");
        await coordinator.wait(started.analysisId);
        const reload = new AnalysisCoordinator(
            new FileProjectStore(new WorkspaceManagerService(f.storage)),
            summaries,
            new FileAstStore(workspaces),
            new SourceReader(workspaces)
        );
        const final = await reload.get(result.projectId, started.analysisId);
        expect(final.status).toBe("completed_with_errors");
        expect(final.counts).toEqual({
            parsed: 2,
            syntax_errors: 1,
            unsupported: 3,
            skipped: 1,
            read_failed: 2,
            parser_failed: 0,
            ast_failed: 0,
            storage_failed: 0
        });
        const artifacts = await new FileAstStore(workspaces).list(result.projectId, started.analysisId);
        expect(artifacts).toHaveLength(3);
        const app = artifacts.find((x) => x.relativePath === "src/app.js")!;
        const doc = await asts.get(result.projectId, started.analysisId, app.artifactId);
        expect(doc.nodes.find((x) => x.text === "😀")?.start.row).toBe(0);
        expect((await projects.get(result.projectId)).result.status).toBe("imported");
        const failedBuilder = new AnalysisCoordinator(
            projects,
            summaries,
            asts,
            new SourceReader(workspaces),
            undefined,
            new AstBuilder(1)
        );
        const second = await failedBuilder.start(result.projectId);
        await failedBuilder.wait(second.analysisId);
        expect((await failedBuilder.get(result.projectId, second.analysisId)).counts.ast_failed).toBe(3);
        expect(await asts.list(result.projectId, second.analysisId)).toHaveLength(0);
        expect(await asts.list(result.projectId, started.analysisId)).toHaveLength(3);
    } finally {
        await f.cleanup();
        log.mockRestore();
        table.mockRestore();
    }
});

it("isolates parser/storage failures and records interruption after service reconstruction", async () => {
    const f = await fixture({ "good.js": "let good = 1;", "bad.js": "let bad = 1;" });
    try {
        const workspaces = new WorkspaceManagerService(f.storage),
            projects = new FileProjectStore(workspaces),
            summaries = new FileAnalysisStore(workspaces),
            asts = new FileAstStore(workspaces);
        const imported = await new RepositoryImporterService(workspaces, projects).importRepository({
            sourceType: "local",
            source: f.source
        });
        const save = vi.spyOn(asts, "save").mockRejectedValueOnce(new Error("controlled storage failure"));
        const job = new AnalysisCoordinator(projects, summaries, asts, new SourceReader(workspaces));
        const started = await job.start(imported.projectId);
        await job.wait(started.analysisId);
        const finished = await job.get(imported.projectId, started.analysisId);
        expect(finished.counts.storage_failed).toBe(1);
        expect(finished.counts.parsed).toBe(1);
        expect(await asts.list(imported.projectId, started.analysisId)).toHaveLength(1);
        save.mockRestore();
        const { composeParsers } = await import("./parser-composition.js");
        const native = composeParsers().registry.getById("tree-sitter-javascript")!;
        const { ParserRegistry } = await import("../parsing/core/ParserRegistry.js");
        const { ParserManager } = await import("../parsing/core/ParserManager.js");
        const registry = new ParserRegistry();
        const parse = vi.fn(native.parse.bind(native)).mockImplementationOnce(() => {
            throw new Error("controlled native exception");
        });
        registry.register({
            id: native.id,
            supportedLanguages: native.supportedLanguages,
            supportedExtensions: native.supportedExtensions,
            parse
        });
        const parsers = { registry, manager: new ParserManager(registry) };
        const failingParser = new AnalysisCoordinator(projects, summaries, asts, new SourceReader(workspaces), parsers);
        const second = await failingParser.start(imported.projectId);
        await failingParser.wait(second.analysisId);
        const result = await failingParser.get(imported.projectId, second.analysisId);
        expect(result.counts.parser_failed).toBe(1);
        expect(result.counts.parsed).toBe(1);
        const { completedAt: _completedAt, ...inProgress } = result;
        await summaries.save({ ...inProgress, status: "running" });
        const reconstructed = new AnalysisCoordinator(projects, summaries, asts, new SourceReader(workspaces));
        expect((await reconstructed.get(imported.projectId, result.analysisId)).status).toBe("interrupted");
    } finally {
        await f.cleanup();
    }
});

it("records oversized inventory entries and deadline skips instead of silently omitting them", async () => {
    const f = await fixture({ "small.js": "let x = 1;", "large.js": "a".repeat(2_000_001) });
    try {
        const workspaces = new WorkspaceManagerService(f.storage),
            projects = new FileProjectStore(workspaces),
            summaries = new FileAnalysisStore(workspaces),
            asts = new FileAstStore(workspaces);
        const imported = await new RepositoryImporterService(workspaces, projects).importRepository({
            sourceType: "local",
            source: f.source
        });
        expect(imported.projectProfile?.languages.sourceFiles).toHaveLength(2);
        const coordinator = new AnalysisCoordinator(projects, summaries, asts, new SourceReader(workspaces));
        const first = await coordinator.start(imported.projectId);
        await coordinator.wait(first.analysisId);
        const summary = await coordinator.get(imported.projectId, first.analysisId);
        expect(summary.counts.parsed).toBe(1);
        expect(summary.files.find((f) => f.relativePath === "large.js")?.code).toBe("FILE_TOO_LARGE");
        const expired = new AnalysisCoordinator(
            projects,
            summaries,
            asts,
            new SourceReader(workspaces),
            undefined,
            undefined,
            { maxFiles: 1000, maxDurationMs: -1 }
        );
        const second = await expired.start(imported.projectId);
        await expired.wait(second.analysisId);
        const final = await expired.get(imported.projectId, second.analysisId);
        expect(final.status).toBe("completed_with_errors");
        expect(final.counts.skipped).toBe(2);
    } finally {
        await f.cleanup();
    }
});
