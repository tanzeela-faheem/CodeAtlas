
import path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import assert from "node:assert/strict";

import { MultiLanguageDetectorService } from "../services/multi-language-detector.service.js";

async function main(): Promise<void> {
    const projectId = "PRJ-813DE6";

    const repositoryPath = path.resolve(
        process.cwd(),
        "storage",
        "workspaces",
        projectId,
        "repository",
    );

    const service = new MultiLanguageDetectorService();
    const result = await service.detectMultiLanguage(repositoryPath);

    // Verify multiple languages are detected.
    assert.ok(
        result.languages.length > 1,
        "Expected more than one language in the sample project",
    );

    assert.equal(
        result.isMultiLanguage,
        true,
        "Expected the sample project to be classified as multi-language",
    );

    // Verify module information is internally consistent.
    assert.ok(result.moduleCount > 0, "Expected at least one project module");

    assert.equal(
        result.moduleCount,
        result.segments.length,
        "Module count should match the number of language segments",
    );

    // Verify every segment has a name, path, and language.
    for (const segment of result.segments) {
        assert.ok(segment.moduleName.length > 0, "Expected a module name");
        assert.ok(segment.modulePath.length > 0, "Expected a module path");
        assert.ok(
            segment.languages.length > 0,
            `Expected at least one language in module ${segment.moduleName}`,
        );

        for (const language of segment.languages) {
            assert.ok(
                result.languages.includes(language),
                `Segment language ${language} should appear in the overall language list`,
            );
        }

        const segmentFileCount = Object.values(
            segment.fileCountByLanguage,
        ).reduce((sum, count) => sum + (count ?? 0), 0);

        assert.ok(
            segmentFileCount > 0,
            `Expected source files in module ${segment.moduleName}`,
        );
    }

    // The current fixture is not configured as a monorepo.
    assert.equal(
        result.isMonorepo,
        false,
        "Expected the sample project not to be classified as a monorepo",
    );

    // Create an isolated temporary repository with npm workspace evidence.
    const temporaryRoot = fs.mkdtempSync(
        path.join(os.tmpdir(), "codeatlas-monorepo-test-"),
    );

    try {
        fs.writeFileSync(
            path.join(temporaryRoot, "package.json"),
            JSON.stringify(
                {
                    name: "test-monorepo",
                    private: true,
                    workspaces: ["packages/*"],
                },
                null,
                2,
            ),
            "utf8",
        );

        const monorepoResult =
            await service.detectMultiLanguage(temporaryRoot);

        assert.equal(
            monorepoResult.isMonorepo,
            true,
            "Expected a root package.json with workspaces to indicate a monorepo",
        );
    } finally {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }

    console.log("\nAll multi-language detector assertions passed!");
    console.log(`Project ID: ${projectId}`);
    console.log(`Languages detected: ${result.languages.join(", ")}`);
    console.log(`Multi-language project: ${result.isMultiLanguage}`);
    console.log(`Modules detected: ${result.moduleCount}`);
    console.log(`Potential monorepo: ${result.isMonorepo}`);
    console.log("Monorepo workspace detection: passed");
}

main().catch((error: unknown) => {
    console.error("Multi-language detector test failed:", error);
    process.exitCode = 1;
});
