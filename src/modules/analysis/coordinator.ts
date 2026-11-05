import { validateProjectState } from "../respository/services/project-validation.js";
import { storageFailure } from "../../shared/validation.js";
import { randomUUID } from "node:crypto";
import { setImmediate as yieldToLoop } from "node:timers/promises";
import type { ProjectStore } from "../respository/services/project-store.js";
import { SourceReader } from "./source-reader.js";
import { composeParsers } from "./parser-composition.js";
import { AstBuilder } from "../ast-management/builder.js";
import type { AstStore } from "../ast-management/store.js";
import type { AnalysisStore } from "./summary-store.js";
import { emptyCounts, type AnalysisSummary, type FileOutcome } from "./model.js";
import type { ProjectProfile } from "../project-detection/types/project-detection.types.js";

export class AnalysisCoordinator {
    private active = false;
    private readonly tasks = new Map<string, Promise<void>>();

    constructor(
        private readonly projects: ProjectStore,
        private readonly summaries: AnalysisStore,
        private readonly asts: AstStore,
        private readonly reader: SourceReader,
        private readonly parsers = composeParsers(),
        private readonly builder = new AstBuilder(),
        private readonly limits = { maxFiles: 1000, maxDurationMs: 60_000 }
    ) {}

    async start(projectId: string): Promise<AnalysisSummary> {
        if (this.active) throw new Error("ANALYSIS_BUSY");
        this.active = true;

        try {
            const project = await this.projects.get(projectId);

            try {
                validateProjectState(project, projectId);
            } catch (error) {
                return storageFailure(error);
            }

            const profile = project.result.projectProfile;

            if (!profile) throw new Error("DETECTION_UNAVAILABLE");

            if (profile.languages.sourceFiles.length > this.limits.maxFiles) throw new Error("ANALYSIS_FILE_LIMIT");
            const summary: AnalysisSummary = {
                schemaVersion: 1,
                projectId,
                analysisId: `AN-${randomUUID()}`,
                status: "queued",
                startedAt: new Date().toISOString(),
                counts: emptyCounts(),
                files: []
            };

            await this.summaries.save(summary);

            const task = (async () => {
                await yieldToLoop();
                try {
                    await this.process(summary, profile);
                } catch {
                    summary.status = "failed";
                    summary.failureCode = "ANALYSIS_OR_SUMMARY_STORAGE_FAILED";
                    summary.completedAt = new Date().toISOString();
                    try {
                        await this.summaries.save(summary);
                    } catch {
                        /* Disk failure remains observable as interrupted after restart. */
                    }
                } finally {
                    this.active = false;
                    this.tasks.delete(summary.analysisId);
                }
            })();

            this.tasks.set(summary.analysisId, task);
            return structuredClone(summary);
        } catch (error) {
            this.active = false;
            throw error;
        }
    }

    async wait(analysisId: string): Promise<void> {
        await this.tasks.get(analysisId);
    }

    async get(projectId: string, analysisId: string): Promise<AnalysisSummary> {
        const summary = await this.summaries.get(projectId, analysisId);

        if (["queued", "running"].includes(summary.status) && !this.tasks.has(analysisId)) {
            summary.status = "interrupted";
            summary.failureCode = "PROCESS_RESTARTED";
            summary.completedAt = new Date().toISOString();
            await this.summaries.save(summary);
        }

        return summary;
    }

    private async process(summary: AnalysisSummary, profile: ProjectProfile): Promise<void> {
        summary.status = "running";
        await this.summaries.save(summary);
        const deadline = Date.now() + this.limits.maxDurationMs;

        for (const file of profile.languages.sourceFiles) {
            let outcome: FileOutcome;
            if (Date.now() > deadline)
                outcome = { relativePath: file.relativePath, status: "skipped", code: "ANALYSIS_TIME_BUDGET" };
            else if (file.isGenerated)
                outcome = { relativePath: file.relativePath, status: "skipped", code: "GENERATED_SOURCE" };
            else if (!this.parsers.registry.findCandidates(file.language, file.extension).length)
                outcome = {
                    relativePath: file.relativePath,
                    status: "unsupported",
                    code: "UNSUPPORTED_LANGUAGE_OR_EXTENSION"
                };
            else outcome = await this.analyzeFile(summary, file);
            summary.files.push(outcome);
            summary.counts[outcome.status]++;
            await this.summaries.save(summary);
            await yieldToLoop();
        }

        summary.status =
            summary.counts.read_failed +
                summary.counts.parser_failed +
                summary.counts.ast_failed +
                summary.counts.storage_failed +
                summary.counts.syntax_errors >
                0 || summary.files.some((f) => f.code === "ANALYSIS_TIME_BUDGET")
                ? "completed_with_errors"
                : "completed";

        summary.completedAt = new Date().toISOString();

        await this.summaries.save(summary);
    }

    private async analyzeFile(
        summary: AnalysisSummary,
        file: ProjectProfile["languages"]["sourceFiles"][number]
    ): Promise<FileOutcome> {
        const base = { relativePath: file.relativePath };
        const source = await this.reader.read(summary.projectId, file, summary.analysisId);

        if (source.status === "read_failed") return { ...base, status: "read_failed", code: source.code };
        const parsed = this.parsers.manager.parse({
            projectId: summary.projectId,
            relativePath: source.relativePath,
            language: source.language,
            sourceCode: source.sourceCode
        });

        if (parsed.status === "failed") return { ...base, status: "parser_failed", code: parsed.code };
        // Native tree is a local value only; Node binding provides no delete() API.
        let document;

        try {
            document = this.builder.build(parsed, {
                analysisId: summary.analysisId,
                language: source.language,
                contentHash: source.contentHash
            });
        } catch {
            return { ...base, status: "ast_failed", code: "AST_NORMALIZATION_FAILED" };
        }

        try {
            const artifact = await this.asts.save(document);
            return { ...base, status: parsed.status === "success" ? "parsed" : "syntax_errors", artifact };
        } catch {
            return { ...base, status: "storage_failed", code: "AST_STORAGE_FAILED" };
        }
    }
}
