import { WorkspaceManagerService } from "./services/workspace-manager.service.js";

async function main() {
    const manager = new WorkspaceManagerService();

    const projectId = "PRJ-A1B2C3";

    // 1. Create a workspace
    const workspace = await manager.createWorkspace(projectId);
    console.log("Created:", workspace);

    // 2. Check storage usage
    const usage = await manager.getStorageUsage(projectId);
    console.log("Storage usage:", usage);

    // 3. Clean temporary files
    await manager.cleanTemporaryFiles(projectId);

    // 4. Reset only when you intentionally want to
    // destroy all repository and analysis contents:
    // await manager.resetWorkspace(projectId);

    // 5. Delete only when you intentionally want to
    // remove the complete workspace:
    // await manager.deleteWorkspace(projectId);
}

main().catch(console.error);