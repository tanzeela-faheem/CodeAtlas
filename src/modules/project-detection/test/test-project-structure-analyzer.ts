
import * as path from "node:path";
import assert from "node:assert/strict";

import { ProjectStructureAnalyzerService } from "../services/project-structure-analyzer.service.js";

const service = new ProjectStructureAnalyzerService();

const projectId = "PRJ-813DE6";

const repositoryPath = path.resolve(
    process.cwd(),
    "storage",
    "workspaces",
    projectId,
    "repository",
);

function main(): void {
    console.log("\n========== PROJECT STRUCTURE ANALYSIS ==========");
    console.log(`Repository: ${repositoryPath}`);

    const result = service.analyze(repositoryPath);

    // Verify basic repository statistics.
    assert.ok(
        result.totalFiles > 0,
        "Expected the repository to contain files",
    );

    assert.ok(
        result.totalDirectories > 0,
        "Expected the repository to contain directories",
    );

    assert.ok(
        result.sourceRoots.length > 0,
        "Expected at least one source root",
    );

    // Verify the sample repository's frontend module.
    const frontendModule = result.modules.find(
        (module) => module.name === "frontend",
    );

    assert.ok(
        frontendModule,
        "Expected a frontend module in the sample repository",
    );

    assert.ok(
        frontendModule.path.length > 0,
        "Expected the frontend module to have a path",
    );

    assert.ok(
        frontendModule.languages.length > 0,
        "Expected the frontend module to contain detected languages",
    );

    assert.ok(
        frontendModule.sourceDirectories.length > 0,
        "Expected the frontend module to have source directories",
    );

    // Validate detected paths are non-empty strings.
    const detectedPaths = [
        ...result.sourceRoots,
        ...result.testDirectories,
        ...result.configurationFiles,
        ...result.documentationFiles,
    ];

    for (const detectedPath of detectedPaths) {
        assert.ok(
            typeof detectedPath === "string" && detectedPath.length > 0,
            "Expected every detected path to be a non-empty string",
        );
    }

    // Verify module metadata is internally valid.
    for (const module of result.modules) {
        assert.ok(module.name.length > 0, "Expected a module name");
        assert.ok(module.path.length > 0, "Expected a module path");

        for (const language of module.languages) {
            assert.ok(
                language.length > 0,
                `Expected a valid language in module ${module.name}`,
            );
        }
    }

    console.log(`Total files: ${result.totalFiles}`);
    console.log(`Total directories: ${result.totalDirectories}`);

    console.log("\nSource roots:");
    console.log(result.sourceRoots);

    console.log("\nTest directories:");
    console.log(result.testDirectories);

    console.log("\nConfiguration files:");
    console.log(result.configurationFiles);

    console.log("\nDocumentation files:");
    console.log(result.documentationFiles);

    console.log("\nModules:");
    console.table(
        result.modules.map((module) => ({
            name: module.name,
            path: module.path,
            languages: module.languages.join(", ") || "Unknown",
            sourceDirectories:
                module.sourceDirectories.join(", ") || "None",
        })),
    );

    console.log("\nAll project structure analyzer assertions passed!");
    console.log("\n========== TEST COMPLETED ==========\n");
}

try {
    main();
} catch (error: unknown) {
    console.error("Project structure analysis test failed:", error);
    process.exitCode = 1;
}
