import { validateProjectState } from "./project-validation.js";
import { storageFailure, validatedSnapshot } from "../../../shared/validation.js";
import path from "node:path";
import { atomicJson, contained, readJson } from "../../../shared/storage.js";
import { WorkspaceManagerService } from "./workspace-manager.service.js";
import type { RepositoryImportResult, RepositoryImportRequest } from "../types/repository.types.js";

export interface ProjectState {
    schemaVersion: 1;
    projectId?: string;
    createdAt: string;
    updatedAt: string;
    result: RepositoryImportResult;
    provenance?: RepositoryImportRequest;
}
export interface ProjectStore {
    save(state: ProjectState): Promise<void>;
    get(projectId: string): Promise<ProjectState>;
}
export class FileProjectStore implements ProjectStore {
    constructor(private readonly workspaces = new WorkspaceManagerService()) {}
    private async file(id: string): Promise<string> {
        const root = await this.workspaces.resolveWorkspace(id);
        const metadata = await contained(root, path.join(root, "metadata"));
        return path.join(metadata, "project.json");
    }
    async save(state: ProjectState): Promise<void> {
        const copy = validatedSnapshot(state, validateProjectState);
        await atomicJson(await this.file(copy.result.projectId), { ...copy, projectId: copy.result.projectId });
    }
    async get(id: string): Promise<ProjectState> {
        const file = await this.file(id);
        await contained(path.dirname(file), file);
        let state: ProjectState;
        try {
            const value = await readJson(file);
            validateProjectState(value, id);
            state = value;
        } catch (error) {
            return storageFailure(error);
        }
        // Never trust a stored absolute repository path for subsequent reads.
        const root = await this.workspaces.resolveWorkspace(id);
        state.result.repositoryPath = await contained(root, path.join(root, "repository"));
        if (state.result.projectProfile) state.result.projectProfile.repositoryPath = state.result.repositoryPath;
        return state;
    }
}
