import { fixture } from "../../../test/fixtures.js";
import { WorkspaceManagerService } from "../../respository/services/workspace-manager.service.js";
import { FileAstStore } from "../../ast-management/store.js";
import { FileAnalysisStore } from "../../analysis/summary-store.js";
import { validateAnalysisSummary } from "../../analysis/summary-validation.js";
import { FileResolutionStore } from "../../symbol-resolution/storage.js";
import { FileRelationshipStore } from "../storage.js";
import { RelationshipCoordinator } from "../integration/RelationshipCoordinator.js";
import { evidence, json, metadataAnalysis, resolutionAnalysis } from "./test-helpers.js";
export const PROJECT = 'PRJ-123ABC', ANALYSIS = 'AN-00000000-0000-0000-0000-000000000001';
export async function setup() {
    const f = await fixture(), workspaces = new WorkspaceManagerService(f.storage); await workspaces.createWorkspace(PROJECT);
    const asts = new FileAstStore(workspaces), analyses = new FileAnalysisStore(workspaces), resolutions = new FileResolutionStore(workspaces), store = new FileRelationshipStore(workspaces);
    const source = json('source-analysis'); validateAnalysisSummary(source); await analyses.save(source);
    for (const file of source.files) { const e = evidence(file.relativePath.replace('.jsx', '')); await asts.save(e.ast); await resolutions.saveFile(e.resolution); }
    await resolutions.saveAnalysis(resolutionAnalysis());
    const calls = { analysis: 0, document: 0 };
    const provider = { analysis: async () => { calls.analysis++; return metadataAnalysis(); }, document: async (_p: string, _a: string, id: string) => { calls.document++; const file = metadataAnalysis().files.find(f => f.metadataArtifact?.artifactId === id)!; return evidence(file.relativePath.replace('.jsx', '')).metadata; } };
    return { f, workspaces, asts, analyses, resolutions, store, provider, calls, coordinator: new RelationshipCoordinator(analyses, asts, resolutions, provider, store) };
}
