import { validateAnalysisSummary } from "./summary-validation.js";
import { storageFailure, validatedSnapshot } from "../../shared/validation.js";
import path from "node:path";
import { atomicJson, contained, readJson } from "../../shared/storage.js";
import { WorkspaceManagerService } from "../respository/services/workspace-manager.service.js";
import { analysisDirectory } from "../../shared/workspace-artifacts.js";
import type { AnalysisSummary } from "./model.js";
export interface AnalysisStore {
    save(summary: AnalysisSummary): Promise<void>;
    get(projectId: string, analysisId: string): Promise<AnalysisSummary>;
}
export class FileAnalysisStore implements AnalysisStore {
    constructor(private readonly workspaces = new WorkspaceManagerService()) {}
    async save(summary: AnalysisSummary): Promise<void> {
        const copy = validatedSnapshot(summary, validateAnalysisSummary);
        const directory = await analysisDirectory(this.workspaces, copy.projectId, copy.analysisId, true);
        await atomicJson(path.join(directory, "summary.json"), copy);
    }
    async get(projectId: string, analysisId: string): Promise<AnalysisSummary> {
        const directory = await analysisDirectory(this.workspaces, projectId, analysisId);
        try {
            const value = await readJson(await contained(directory, path.join(directory, "summary.json")));
            validateAnalysisSummary(value, projectId, analysisId);
            return value;
        } catch (error) {
            return storageFailure(error);
        }
    }
}
