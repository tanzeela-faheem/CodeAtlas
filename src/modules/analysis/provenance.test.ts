import { it, expect } from "vitest";
import { fixture } from "../../test/fixtures.js";
import { WorkspaceManagerService } from "../respository/services/workspace-manager.service.js";
import { RepositoryImporterService } from "../respository/services/repository-importer.service.js";
import { FileProjectStore } from "../respository/services/project-store.js";
import { FileAstStore } from "../ast-management/store.js";
import { FileAnalysisStore } from "./summary-store.js";
import { SourceReader } from "./source-reader.js";
import { AnalysisCoordinator } from "./coordinator.js";
import { ParserRegistry } from "../parsing/core/ParserRegistry.js";
import { ParserManager } from "../parsing/core/ParserManager.js";
import { JavascriptParser } from "../parsing/languages/JavascriptParser.js";
it("persists each selected mock plugin provenance through the real coordinator and AST store", async () => {
    const f = await fixture({ "app.js": "export const x = 1;", "App.jsx": "export default <h1/>;" });
    try {
        const wm = new WorkspaceManagerService(f.storage),
            projects = new FileProjectStore(wm),
            summaries = new FileAnalysisStore(wm),
            asts = new FileAstStore(wm);
        const project = await new RepositoryImporterService(wm, projects).importRepository({
            sourceType: "local",
            source: f.source
        });
        const native = new JavascriptParser(),
            registry = new ParserRegistry();
        // Mock descriptors deliberately use distinct versions; both delegate syntax to
        // the installed native grammar. This is not an additional production plugin.
        for (const [id, extension] of [
            ["alpha", ".js"],
            ["beta", ".jsx"]
        ] as const)
            registry.register({
                id,
                supportedLanguages: ["JavaScript"],
                supportedExtensions: [extension],
                provenance: { parserVersion: `${id}-implementation`, grammarVersion: `${id}-grammar` },
                parse: (source) => native.parse(source)
            });
        const coordinator = new AnalysisCoordinator(projects, summaries, asts, new SourceReader(wm), {
            registry,
            manager: new ParserManager(registry)
        });
        const job = await coordinator.start(project.projectId);
        await coordinator.wait(job.analysisId);
        const final = await coordinator.get(project.projectId, job.analysisId);
        expect(final.counts.parsed).toBe(2);
        for (const file of final.files) {
            const doc = await new FileAstStore(wm).get(project.projectId, job.analysisId, file.artifact!.artifactId);
            const id = file.relativePath.endsWith(".jsx") ? "beta" : "alpha";
            expect(doc).toMatchObject({
                parserId: id,
                parserVersion: `${id}-implementation`,
                grammarVersion: `${id}-grammar`
            });
        }
    } finally {
        await f.cleanup();
    }
});
