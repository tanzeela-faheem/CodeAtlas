
import * as path from "node:path";
import assert from "node:assert/strict";

import { BuildSystemDetectorService } from "../services/build-system-detector.service.js";

async function main(): Promise<void> {
    // Scan the imported ZIP repository.
    const projectId = "PRJ-813DE6";
    const repositoryPath = path.resolve(
        process.cwd(),
        "storage",
        "workspaces",
        projectId,
        "repository",
    );

    const detector = new BuildSystemDetectorService();
    const result = await detector.detectBuildSystems(repositoryPath);

    // Verify that the expected build systems were detected.
    const vite = result.buildSystems.find(
        (item) => item.name === "Vite",
    );

    const npmScripts = result.buildSystems.find(
        (item) => item.name === "npm scripts",
    );

    assert.ok(vite, "Expected Vite to be detected");
    assert.ok(npmScripts, "Expected npm scripts to be detected");

    // Verify confidence scores.
    assert.equal(
        vite.confidence,
        95,
        "Vite confidence should be 95%",
    );

    assert.equal(
        npmScripts.confidence,
        90,
        "npm scripts confidence should be 90%",
    );

    // Verify the evidence used to detect each build system.
    assert.ok(
        vite.configurationFiles.includes("frontend/vite.config.js"),
        "Expected Vite configuration file to be detected",
    );

    assert.ok(
        npmScripts.buildFiles.includes("frontend/package.json"),
        "Expected package.json to be detected for npm scripts",
    );

    console.log("\nAll build system detector assertions passed!");
    console.log("Verified: Vite detection and 95% confidence");
    console.log("Verified: npm scripts detection and 90% confidence");
    console.log("Verified: configuration and manifest file paths");
}

main().catch((error: unknown) => {
    console.error("Build system detector test failed:", error);
    process.exitCode = 1;
});
