
import * as path from "node:path";
import assert from "node:assert/strict";

import { FrameworkDetectorService } from "../services/framework-detector.service.js";

async function main(): Promise<void> {
    const projectId = "PRJ-813DE6";

    const repositoryPath = path.resolve(
        process.cwd(),
        "storage",
        "workspaces",
        projectId,
        "repository",
    );

    const detector = new FrameworkDetectorService();
    const result = await detector.detectFrameworks(repositoryPath);

    // Verify that React was detected.
    const react = result.frameworks.find(
        (framework) => framework.name.toLowerCase() === "react",
    );

    assert.ok(react, "Expected React to be detected");
    assert.equal(react.category, "frontend");
    assert.equal(react.confidence, 70);
    assert.ok(
        react.evidence.length > 0,
        "Expected evidence supporting React detection",
    );

    // Verify result consistency.
    assert.equal(
        result.totalDetected,
        result.frameworks.length,
        "totalDetected should match the number of detected frameworks",
    );

    console.log("\nAll framework detector assertions passed!");
    console.log(`Frameworks detected: ${result.totalDetected}`);
    console.log(`Verified: ${react.name}`);
    console.log(`Category: ${react.category}`);
    console.log(`Confidence: ${react.confidence}%`);
    console.log(`Evidence: ${react.evidence.join(", ")}`);
}

main().catch((error: unknown) => {
    console.error("Framework detector test failed:", error);
    process.exitCode = 1;
});
