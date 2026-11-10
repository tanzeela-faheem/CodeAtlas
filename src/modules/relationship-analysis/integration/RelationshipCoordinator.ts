import { setImmediate as yieldToLoop } from "node:timers/promises";
import type { AnalysisStore } from "../../analysis/summary-store.js";
import type { AstStore } from "../../ast-management/store.js";
import { validateAnalysisSummary } from "../../analysis/summary-validation.js";
import type { ResolutionStore } from "../../symbol-resolution/storage.js";
import { validateResolutionAnalysis, resolutionReference } from "../../symbol-resolution/validation.js";
import { cleanSource, digest, validateMetadataAnalysis } from "../../symbol-resolution/integration/contracts.js";
import type { MetadataProvider } from "../../symbol-resolution/integration/MetadataClient.js";
import { ResolutionError } from "../../symbol-resolution/model.js";
import { DataValidationError, StorageError, validatedSnapshot } from "../../../shared/validation.js";
import type { RelationshipStore } from "../storage.js";
import { JavascriptRelationshipAnalyzer, type RelationshipAdapter } from "../languages/javascript.js";
import { ANALYZER_VERSION, DEFAULT_LIMITS, emptyFileCounts, emptyRelationshipCounts, RelationshipError, validateLimits, type RelationshipAnalysis, type RelationshipLimits, type RelationshipOutcome } from "../model.js";
import { addCounts } from "../validation.js";
const missing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';
export class RelationshipCoordinator {
    private active: string | null = null;
    private readonly limits: Readonly<RelationshipLimits>;
    constructor(private readonly analyses: AnalysisStore, private readonly asts: AstStore,
        private readonly resolutions: ResolutionStore, private readonly metadata: MetadataProvider,
        private readonly store: RelationshipStore, private readonly adapters: readonly RelationshipAdapter[] = [new JavascriptRelationshipAnalyzer()],
        limits: RelationshipLimits = { ...DEFAULT_LIMITS }) { validateLimits(limits); this.limits = Object.freeze({ ...limits }); }
    async get(project: string, analysis: string): Promise<RelationshipAnalysis> {
        const summary = await this.store.getAnalysis(project, analysis);
        if (summary.status === 'running' && this.active !== `${project}/${analysis}`) {
            summary.status = 'interrupted'; summary.completedAt = new Date().toISOString(); await this.store.saveAnalysis(summary);
        }
        return summary;
    }
    async analyze(project: string, analysis: string): Promise<RelationshipAnalysis> {
        if (this.active) throw new RelationshipError('RELATIONSHIP_BUSY', 409);
        this.active = `${project}/${analysis}`;
        const deadline = Date.now() + this.limits.maxDurationMs;
        try {
            const rawSource = await this.analyses.get(project, analysis).catch(error => { if (missing(error)) throw new RelationshipError('RELATIONSHIP_ANALYSIS_MISSING', 404); throw error; });
            const source = validatedSnapshot(rawSource, validateAnalysisSummary);
            if (source.projectId !== project || source.analysisId !== analysis) throw new RelationshipError('RELATIONSHIP_INPUT_INCOMPATIBLE');
            if (!['completed', 'completed_with_errors'].includes(source.status)) throw new RelationshipError('RELATIONSHIP_ANALYSIS_NOT_READY', 409);
            const rawResolution = await (this.resolutions.getAnalysisManifest?.(project, analysis) ?? this.resolutions.getAnalysis(project, analysis)).catch(error => { if (missing(error)) throw new RelationshipError('RELATIONSHIP_RESOLUTION_MISSING', 424); throw error; });
            const resolution = validatedSnapshot(rawResolution, validateResolutionAnalysis);
            if (!['complete', 'partial', 'failed'].includes(resolution.status)) throw new RelationshipError('RELATIONSHIP_RESOLUTION_NOT_READY', 409);
            if (resolution.projectId !== project || resolution.analysisId !== analysis || resolution.sourceAnalysisHash !== digest(source)) throw new RelationshipError('RELATIONSHIP_INPUT_INCOMPATIBLE');
            const metadata = validatedSnapshot(await this.metadata.analysis(project, analysis), validateMetadataAnalysis);
            if (metadata.projectId !== project || metadata.analysisId !== analysis || digest(cleanSource(metadata.sourceAnalysis)) !== digest(source) || digest(metadata) !== resolution.metadataAnalysisHash || metadata.sourceAnalysisHash !== resolution.sourceAnalysisHash || metadata.extractionVersion !== resolution.extractionVersion || metadata.status !== resolution.upstreamStatus) throw new RelationshipError('RELATIONSHIP_UPSTREAM_SNAPSHOT_CONFLICT', 409);
            if (source.files.length > this.limits.maxFiles) throw new RelationshipError('RELATIONSHIP_RESOURCE_LIMIT', 413);
            const expected = new Map(source.files.map(f => [f.relativePath, f])), mf = new Map(metadata.files.map(f => [f.relativePath, f]));
            if (resolution.files.length !== expected.size || resolution.files.some(f => !expected.has(f.relativePath))) throw new RelationshipError('RELATIONSHIP_INPUT_INCOMPATIBLE');
            const resolutionHash = digest(resolution);
            try {
                const prior = await this.get(project, analysis);
                if (prior.sourceAnalysisHash !== resolution.sourceAnalysisHash || prior.metadataAnalysisHash !== resolution.metadataAnalysisHash || prior.resolutionAnalysisHash !== resolutionHash) throw new RelationshipError('RELATIONSHIP_SNAPSHOT_CONFLICT', 409);
                if (prior.status === 'complete' || prior.status === 'partial') return prior;
            } catch (error) { if (!missing(error)) throw error; }
            const summary: RelationshipAnalysis = { schemaVersion: 1, analyzerVersion: ANALYZER_VERSION, projectId: project, analysisId: analysis,
                sourceAnalysisHash: resolution.sourceAnalysisHash, metadataAnalysisHash: resolution.metadataAnalysisHash, resolutionAnalysisHash: resolutionHash,
                upstreamStatus: resolution.status, upstreamDiagnostics: resolution.upstreamDiagnostics, status: 'running', startedAt: new Date().toISOString(), completedAt: null,
                files: [], counts: emptyFileCounts(), relationshipCounts: emptyRelationshipCounts() };
            await this.store.saveAnalysis(summary);
            let bytes = Buffer.byteLength(JSON.stringify([source, metadata, resolution]));
            for (const file of resolution.files) {
                let outcome: RelationshipOutcome = { relativePath: file.relativePath, status: 'unavailable', code: 'RELATIONSHIP_RESOLUTION_FILE_UNAVAILABLE', artifact: null, upstreamStatus: file.status, upstreamCode: file.code, upstreamDiagnostics: file.upstreamDiagnostics };
                if (bytes >= this.limits.maxTotalBytes) outcome = { ...outcome, status: 'failed', code: 'RELATIONSHIP_RESOURCE_LIMIT' };
                else if (Date.now() > deadline) outcome = { ...outcome, status: 'failed', code: 'RELATIONSHIP_TIME_BUDGET' };
                else if (!file.artifact) outcome = { ...outcome, status: file.status === 'unsupported' ? 'unsupported' : 'unavailable', code: file.status === 'unsupported' ? 'RELATIONSHIP_LANGUAGE_UNSUPPORTED' : outcome.code };
                else {
                    try {
                        const original = expected.get(file.relativePath)!, meta = mf.get(file.relativePath)!;
                        if (!original.artifact || !meta.metadataArtifact) throw new RelationshipError('RELATIONSHIP_INPUT_INCOMPATIBLE');
                        const resolved = await this.resolutions.getFile(project, analysis, file.artifact.artifactId).catch(error => { if (missing(error)) throw new RelationshipError('RELATIONSHIP_RESOLUTION_FILE_MISSING', 424); throw error; });
                        if (digest(resolutionReference(resolved)) !== digest(file.artifact) || resolved.status !== file.status || resolved.astArtifactId !== original.artifact.artifactId || digest(resolved.metadataArtifact) !== digest(meta.metadataArtifact)) throw new RelationshipError('RELATIONSHIP_INPUT_INCOMPATIBLE');
                        const ast = await this.asts.get(project, analysis, original.artifact.artifactId, original.artifact.contentHash).catch(error => { if (missing(error)) throw new RelationshipError('RELATIONSHIP_AST_MISSING', 424); throw error; });
                        const candidates = this.adapters.filter(a => a.supports(ast));
                        if (candidates.length !== 1) throw new RelationshipError('RELATIONSHIP_LANGUAGE_UNSUPPORTED');
                        const document = await this.metadata.document(project, analysis, meta.metadataArtifact.artifactId);
                        bytes += Buffer.byteLength(JSON.stringify([ast, document, resolved]));
                        if (bytes >= this.limits.maxTotalBytes) throw new RelationshipError('RELATIONSHIP_RESOURCE_LIMIT', 413);
                        let result;
                        try { result = candidates[0]!.analyze({ ast, metadata: document, resolution: resolved, resolutionArtifact: file.artifact, sourceAnalysisHash: summary.sourceAnalysisHash, metadataAnalysisHash: summary.metadataAnalysisHash, resolutionAnalysisHash: summary.resolutionAnalysisHash }, this.limits); }
                        catch (error) { if (error instanceof RelationshipError) throw error; throw new RelationshipError('RELATIONSHIP_ANALYSIS_FAILED', 500); }
                        const size = Buffer.byteLength(JSON.stringify({ documentHash: digest(result), document: result })); bytes += size;
                        if (size > this.limits.maxArtifactBytes || bytes > this.limits.maxTotalBytes) throw new RelationshipError('RELATIONSHIP_RESOURCE_LIMIT', 413);
                        let artifact;
                        try { artifact = await this.store.saveFile(result); }
                        catch (error) { if (error instanceof RelationshipError) throw error; throw new RelationshipError('RELATIONSHIP_STORAGE_FAILED', 500); }
                        outcome = { ...outcome, status: result.status, code: null, artifact };
                    } catch (error) {
                        const code = error instanceof RelationshipError || error instanceof ResolutionError ? error.code : error instanceof StorageError || error instanceof DataValidationError ? 'RELATIONSHIP_INPUT_CORRUPT' : 'RELATIONSHIP_ANALYSIS_FAILED';
                        outcome = { ...outcome, status: code === 'RELATIONSHIP_LANGUAGE_UNSUPPORTED' ? 'unsupported' : code.endsWith('_MISSING') || code === 'METADATA_UNAVAILABLE' || code === 'METADATA_MISSING' ? 'unavailable' : 'failed', code };
                    }
                }
                summary.files.push(outcome); summary.counts[outcome.status]++; if (outcome.artifact) addCounts(summary.relationshipCounts, outcome.artifact.counts);
                await this.store.saveAnalysis(summary); await yieldToLoop();
            }
            summary.status = summary.counts.complete === summary.files.length && resolution.status === 'complete' ? 'complete' : summary.counts.complete + summary.counts.partial > 0 ? 'partial' : 'failed';
            summary.completedAt = new Date().toISOString(); await this.store.saveAnalysis(summary); return structuredClone(summary);
        } finally { this.active = null; }
    }
}
