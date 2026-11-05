import fs from "node:fs/promises";
import path from "node:path";
import { contained } from "./storage.js";
import { WorkspaceManagerService } from "../modules/respository/services/workspace-manager.service.js";
export function validateAnalysisId(id: string): void {
    if (!/^AN-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))
        throw new Error("Invalid analysis ID");
}
export async function analysisDirectory(
    workspaces: WorkspaceManagerService,
    projectId: string,
    analysisId: string,
    create = false
): Promise<string> {
    validateAnalysisId(analysisId);
    const workspace = await workspaces.resolveWorkspace(projectId);
    const base = await contained(workspace, path.join(workspace, "analysis"));
    const directory = path.join(base, analysisId);
    if (create) await fs.mkdir(directory, { recursive: true });
    return contained(base, directory);
}
