
import path from "node:path";
import assert from "node:assert/strict";

import { LanguageDetectorService } from "../services/language-detector.service.js";

async function main(): Promise<void> {
    const projectId = "PRJ-813DE6";

    const repositoryPath = path.resolve(
        process.cwd(),
        "storage",
        "workspaces",
        projectId,
        "repository",
    );

    const detector = new LanguageDetectorService();
    const result = await detector.detectLanguages(repositoryPath);

    // Verify that source files and lines of code were detected.
    assert.ok(
        result.totalSourceFiles > 0,
        "Expected at least one source file",
    );

    assert.ok(
        result.totalLinesOfCode > 0,
        "Expected a positive lines-of-code total",
    );

    assert.ok(
        result.languages.length > 0,
        "Expected at least one language statistic",
    );

    // Verify that the language file counts add up to the total.
    const totalFilesFromLanguages = result.languages.reduce(
        (sum, language) => sum + language.fileCount,
        0,
    );

    assert.equal(
        totalFilesFromLanguages,
        result.totalSourceFiles,
        "Language file counts should add up to totalSourceFiles",
    );

    // Verify that language line counts add up to the overall total.
    const totalLinesFromLanguages = result.languages.reduce(
        (sum, language) => sum + language.linesOfCode,
        0,
    );

    assert.equal(
        totalLinesFromLanguages,
        result.totalLinesOfCode,
        "Language line counts should add up to totalLinesOfCode",
    );

    // Verify language percentages are within valid bounds.
    for (const language of result.languages) {
        assert.ok(
            language.fileCount >= 0,
            `${language.language} file count must not be negative`,
        );

        assert.ok(
            language.linesOfCode >= 0,
            `${language.language} line count must not be negative`,
        );

        assert.ok(
            language.percentageOfSourceFiles >= 0 &&
                language.percentageOfSourceFiles <= 100,
            `${language.language} file percentage must be between 0 and 100`,
        );

        assert.ok(
            language.percentageOfLinesOfCode >= 0 &&
                language.percentageOfLinesOfCode <= 100,
            `${language.language} LOC percentage must be between 0 and 100`,
        );
    }

    // Verify every reported source file has a language and a relative path.
    for (const file of result.sourceFiles) {
        assert.ok(file.relativePath.length > 0, "Expected a relative file path");
        assert.ok(file.language.length > 0, "Expected a language for each source file");
        assert.ok(
            file.linesOfCode >= 0,
            `Line count must not be negative for ${file.relativePath}`,
        );
    }

    // Verify the dominant language matches the highest LOC statistic.
    const highestLocLanguage = [...result.languages].sort(
        (a, b) => b.linesOfCode - a.linesOfCode,
    )[0];

    assert.ok(highestLocLanguage, "Expected a language with LOC statistics");

    assert.equal(
        result.dominantLanguage,
        highestLocLanguage.language,
        "Dominant language should have the highest lines-of-code count",
    );

    console.log("\nAll language detector assertions passed!");
    console.log(`Project ID: ${projectId}`);
    console.log(`Source files: ${result.totalSourceFiles}`);
    console.log(`Lines of code: ${result.totalLinesOfCode}`);
    console.log(`Dominant language: ${result.dominantLanguage ?? "Unknown"}`);
    console.log(`Languages detected: ${result.languages.length}`);
    console.log(`Unknown extensions: ${result.unknownExtensions.length}`);
}

main().catch((error: unknown) => {
    console.error("Language detector test failed:", error);
    process.exitCode = 1;
});
