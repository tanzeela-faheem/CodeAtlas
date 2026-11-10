import { setImmediate as yieldToLoop } from "node:timers/promises";
import type { AnalysisStore } from "../../analysis/summary-store.js";
import type { AstStore } from "../../ast-management/store.js";
import { validateAnalysisSummary } from "../../analysis/summary-validation.js";
import { DataValidationError, StorageError } from "../../../shared/validation.js";
import type { ResolutionStore } from "../storage.js";
import type { MetadataProvider } from "./MetadataClient.js";
import { cleanSource, digest, matchEvidence, validateMetadataAnalysis } from "./contracts.js";
import { JavascriptResolver, type LanguageResolver } from "../languages/javascript.js";
import { emptyResolutionCounts } from "../validation.js";
import { RESOLVER_VERSION, ResolutionError, type ResolutionAnalysis, type ResolutionOutcome } from "../model.js";
export class ResolutionCoordinator {
    private active: string | null = null;
    constructor(private readonly analyses: AnalysisStore, private readonly asts: AstStore,
        private readonly metadata: MetadataProvider, private readonly store: ResolutionStore,
        private readonly adapters: LanguageResolver[] = [new JavascriptResolver()],
        private readonly limits: { maxFiles: number; maxDurationMs: number; maxTotalBytes?: number } = { maxFiles: 1000, maxDurationMs: 60000, maxTotalBytes: 128 * 1024 * 1024 }) {}
    async get(project: string, analysis: string): Promise<ResolutionAnalysis> {
        const summary = await this.store.getAnalysis(project, analysis);
        if (summary.status === "running" && this.active !== `${project}/${analysis}`) {
            summary.status = "interrupted"; summary.completedAt = new Date().toISOString();
            await this.store.saveAnalysis(summary);
        }
        return summary;
    }
    async resolve(project: string, analysis: string): Promise<ResolutionAnalysis> {
        if (this.active) throw new ResolutionError("RESOLUTION_BUSY", 409);
        this.active = `${project}/${analysis}`;
        try {
            const source = await this.analyses.get(project, analysis);
            try { validateAnalysisSummary(source, project, analysis); } catch { throw new ResolutionError("INPUT_STORAGE_CORRUPT", 500); }
            if (!["completed", "completed_with_errors"].includes(source.status)) throw new ResolutionError("ANALYSIS_NOT_READY", 409);
            const metadata = await this.metadata.analysis(project, analysis);
            try { validateMetadataAnalysis(metadata); } catch (error) { if (error instanceof ResolutionError) throw error; throw new ResolutionError("METADATA_INVALID", 502); }
            if (metadata.projectId !== project || metadata.analysisId !== analysis || digest(cleanSource(metadata.sourceAnalysis)) !== digest(source)) throw new ResolutionError("AST_PROVENANCE_INCOMPATIBLE", 422);
            if (metadata.files.length > this.limits.maxFiles) throw new ResolutionError("RESOLUTION_RESOURCE_LIMIT", 413);
            const metadataHash = digest(metadata);
            try {
                const prior = await this.get(project, analysis);
                if (prior.metadataAnalysisHash !== metadataHash) throw new ResolutionError("RESOLUTION_SNAPSHOT_CONFLICT", 409);
                if (["complete", "partial"].includes(prior.status)) return prior;
            } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
            const summary: ResolutionAnalysis = { schemaVersion: 1, resolverVersion: RESOLVER_VERSION, projectId: project, analysisId: analysis, metadataAnalysisHash: metadataHash, sourceAnalysisHash: metadata.sourceAnalysisHash, extractionVersion: metadata.extractionVersion, upstreamStatus: metadata.status, upstreamDiagnostics: metadata.diagnostics, status: "running", startedAt: new Date().toISOString(), completedAt: null, counts: emptyResolutionCounts(), files: [] };
            await this.store.saveAnalysis(summary);
            let totalBytes = 0;
            const byteLimit = this.limits.maxTotalBytes ?? 128 * 1024 * 1024;
            const deadline = Date.now() + this.limits.maxDurationMs;
            for (const file of metadata.files) {
                let outcome: ResolutionOutcome = { relativePath: file.relativePath, status: "unavailable", code: "METADATA_MISSING", artifact: null, upstreamDiagnostics: file.diagnostics };
                if (totalBytes >= byteLimit) outcome = { ...outcome, status: "failed", code: "RESOLUTION_RESOURCE_LIMIT" };
                else if (Date.now() > deadline) outcome = { ...outcome, status: "failed", code: "RESOLUTION_TIME_BUDGET" };
                else if (!file.metadataArtifact || !file.sourceArtifact) outcome = { ...outcome, status: file.status === "unsupported" ? "unsupported" : "unavailable", code: file.status === "unsupported" ? "UNSUPPORTED_LANGUAGE" : "METADATA_MISSING" };
                else {
                    try {
                        const ref = file.metadataArtifact;
                        const ast = await this.asts.get(project, analysis, file.sourceArtifact.artifactId, file.sourceArtifact.contentHash);
                        const document = await this.metadata.document(project, analysis, ref.artifactId);
                        totalBytes += Buffer.byteLength(JSON.stringify(document));
                        if (totalBytes > byteLimit) throw new ResolutionError("RESOLUTION_RESOURCE_LIMIT", 413);
                        try { matchEvidence(ast, document, ref); }
                        catch { throw new ResolutionError("AST_PROVENANCE_INCOMPATIBLE"); }
                        const candidates = this.adapters.filter(a => a.supports(ast));
                        if (candidates.length !== 1) throw new ResolutionError("UNSUPPORTED_LANGUAGE");
                        let result;
                        try { result = candidates[0]!.resolve(ast, document, ref); }
                        catch (error) { if (error instanceof ResolutionError) throw error; throw new ResolutionError("RESOLUTION_FAILED", 500); }
                        totalBytes += Buffer.byteLength(JSON.stringify(result));
                        if (totalBytes > byteLimit) throw new ResolutionError("RESOLUTION_RESOURCE_LIMIT", 413);
                        let artifact;
                        try { artifact = await this.store.saveFile(result); }
                        catch (error) { if (error instanceof ResolutionError) throw error; throw new ResolutionError("RESOLUTION_STORAGE_FAILED", 500); }
                        outcome = { relativePath: file.relativePath, status: result.status, code: null, artifact, upstreamDiagnostics: file.diagnostics };
                    } catch (error) {
                        const code = error instanceof ResolutionError ? error.code : error instanceof StorageError ? "INPUT_STORAGE_CORRUPT" : error instanceof DataValidationError ? "RESOLUTION_FAILED" : "RESOLUTION_OR_STORAGE_FAILED";
                        outcome = { ...outcome, status: code === "UNSUPPORTED_LANGUAGE" ? "unsupported" : "failed", code };
                    }
                }
                summary.files.push(outcome); summary.counts[outcome.status]++;
                await this.store.saveAnalysis(summary); await yieldToLoop();
            }
            summary.status = summary.counts.complete === summary.files.length && metadata.status === "complete" ? "complete" : summary.counts.complete + summary.counts.partial > 0 ? "partial" : "failed";
            summary.completedAt = new Date().toISOString(); await this.store.saveAnalysis(summary);
            return structuredClone(summary);
        } finally { this.active = null; }
    }
}
