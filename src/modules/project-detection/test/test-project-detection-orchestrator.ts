
import path from "node:path";
import assert from "node:assert/strict";

import {
    ProjectDetectionOrchestratorService,
} from "../services/project-detection-orchestrator.service.js";

async function main(): Promise<void> {
    const projectId = "PRJ-813DE6";

    const repositoryPath = path.resolve(
        process.cwd(),
        "storage",
        "workspaces",
        projectId,
        "repository",
    );

    const orchestrator = new ProjectDetectionOrchestratorService();

    const profile = await orchestrator.detectProject(
        projectId,
        repositoryPath,
        "CodeAtlas Sample Frontend",
    );

    // Verify basic project identity.
    assert.equal(profile.projectId, projectId);
    assert.equal(profile.projectName, "CodeAtlas Sample Frontend");
    assert.equal(
        path.resolve(profile.repositoryPath),
        path.resolve(repositoryPath),
    );
    assert.ok(
        !Number.isNaN(Date.parse(profile.detectedAt)),
        "Expected a valid project detection timestamp",
    );

    // Verify language detection.
    assert.ok(
        profile.languages.totalSourceFiles > 0,
        "Expected source files to be detected",
    );
    assert.ok(
        profile.languages.languages.length > 0,
        "Expected at least one programming or source language",
    );
    assert.ok(
        profile.languages.totalLinesOfCode > 0,
        "Expected lines of code to be counted",
    );

    // Verify framework detection.
    assert.ok(
        profile.frameworks.frameworks.some(
            (framework) => framework.name.toLowerCase() === "react",
        ),
        "Expected React to be detected in the sample frontend",
    );

    // Verify build-system detection.
    assert.ok(
        profile.buildSystems.buildSystems.some(
            (item) => item.name === "Vite",
        ),
        "Expected Vite to be detected",
    );
    assert.ok(
        profile.buildSystems.buildSystems.some(
            (item) => item.name === "npm scripts",
        ),
        "Expected npm scripts to be detected",
    );

    // Verify package-manager detection.
    assert.ok(
        profile.packageManagers.packageManagers.some(
            (manager) => manager.name === "npm",
        ),
        "Expected npm to be detected",
    );

    // Verify project structure analysis.
    assert.ok(
        profile.structure.totalFiles > 0,
        "Expected project files to be counted",
    );
    assert.ok(
        profile.structure.totalDirectories > 0,
        "Expected project directories to be counted",
    );
    assert.ok(
        profile.structure.sourceRoots.length > 0,
        "Expected at least one source root",
    );

    // Verify multi-language analysis.
    assert.ok(
        profile.multiLanguage.languages.length > 0,
        "Expected languages in the multi-language analysis",
    );
    assert.ok(
        profile.multiLanguage.moduleCount > 0,
        "Expected at least one project module",
    );

    console.log("\nAll project detection orchestrator assertions passed!");
    console.log(`Project ID: ${profile.projectId}`);
    console.log(`Source files: ${profile.languages.totalSourceFiles}`);
    console.log(`Lines of code: ${profile.languages.totalLinesOfCode}`);
    console.log(
        `Frameworks: ${profile.frameworks.frameworks.map((item) => item.name).join(", ")}`,
    );
    console.log(
        `Build systems: ${profile.buildSystems.buildSystems.map((item) => item.name).join(", ")}`,
    );
    console.log(
        `Package managers: ${profile.packageManagers.packageManagers.map((item) => item.name).join(", ")}`,
    );
    console.log(
        `Modules: ${profile.multiLanguage.moduleCount}`,
    );
}

main().catch((error: unknown) => {
    console.error("\nProject detection orchestrator test failed:", error);
    process.exitCode = 1;
});
