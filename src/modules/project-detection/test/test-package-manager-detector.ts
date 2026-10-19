
import * as path from "node:path";
import assert from "node:assert/strict";

import { PackageManagerDetectorService } from "../services/package-manager-detector.service.js";

async function main(): Promise<void> {
    const projectId = "PRJ-813DE6";

    const repositoryPath = path.resolve(
        process.cwd(),
        "storage",
        "workspaces",
        projectId,
        "repository",
    );

    const detector = new PackageManagerDetectorService();
    const result = await detector.detectPackageManagers(repositoryPath);

    // The sample repository contains frontend/package.json and package-lock.json.
    const npmManager = result.packageManagers.find(
        (manager) => manager.name === "npm",
    );

    assert.ok(
        npmManager,
        "Expected npm to be detected from the sample repository",
    );

    assert.ok(
        npmManager.manifestFiles.some((file) =>
            file.replace(/\\/g, "/").endsWith("frontend/package.json"),
        ),
        "Expected npm manifest frontend/package.json to be detected",
    );

    assert.ok(
        npmManager.lockFiles.some((file) =>
            file.replace(/\\/g, "/").endsWith("frontend/package-lock.json"),
        ),
        "Expected npm lockfile frontend/package-lock.json to be detected",
    );

    assert.ok(
        npmManager.confidence >= 0 && npmManager.confidence <= 100,
        "Expected npm confidence to be between 0 and 100",
    );

    assert.ok(
        npmManager.dependencyCount === null ||
            (Number.isInteger(npmManager.dependencyCount) &&
                npmManager.dependencyCount >= 0),
        "Expected dependency count to be null or a non-negative integer",
    );

    assert.ok(
        result.packageManagers.length > 0,
        "Expected at least one package manager to be detected",
    );

    console.log("\nAll package manager detector assertions passed!");
    console.log(`Package managers: ${result.packageManagers.map((manager) => manager.name).join(", ")}`);
    console.log(`npm confidence: ${npmManager.confidence}%`);
    console.log(`npm dependency count: ${npmManager.dependencyCount ?? "Unknown"}`);
}

main().catch((error: unknown) => {
    console.error("Package manager detector test failed:", error);
    process.exitCode = 1;
});
