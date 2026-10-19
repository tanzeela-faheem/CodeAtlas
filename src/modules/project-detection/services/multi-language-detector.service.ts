
import path from "node:path";
import * as fs from "node:fs";

import { LanguageDetectorService } from "./language-detector.service.js";

import type {
    LanguageDetectionResult,
    LanguageSegment,
    MultiLanguageDetectionResult,
    ProgrammingLanguage,
} from "../types/project-detection.types.js";

export class MultiLanguageDetectorService {
    constructor(
        private readonly languageDetector = new LanguageDetectorService(),
    ) {}

    async detectMultiLanguage(
        repositoryPath: string,
        existingLanguageResult?: LanguageDetectionResult,
    ): Promise<MultiLanguageDetectionResult> {
        const languageResult =
            existingLanguageResult ??
            (await this.languageDetector.detectLanguages(repositoryPath));

        // Exclude generated files from language and module statistics.
        const files = languageResult.sourceFiles.filter(
            (file) => !file.isGenerated,
        );

        const moduleLanguageCounts = new Map<
            string,
            Map<ProgrammingLanguage, number>
        >();

        for (const file of files) {
            const normalizedPath = file.relativePath.replace(/\\/g, "/");
            const pathParts = normalizedPath.split("/").filter(Boolean);

            // Group source files by their first-level repository directory.
            // Root-level source files belong to the "." module.
            const modulePath =
                pathParts.length > 1 ? (pathParts[0] ?? ".") : ".";

            if (!moduleLanguageCounts.has(modulePath)) {
                moduleLanguageCounts.set(
                    modulePath,
                    new Map<ProgrammingLanguage, number>(),
                );
            }

            const languageCounts = moduleLanguageCounts.get(modulePath)!;

            languageCounts.set(
                file.language,
                (languageCounts.get(file.language) ?? 0) + 1,
            );
        }

        const segments: LanguageSegment[] = [];

        for (const [modulePath, languageCounts] of moduleLanguageCounts) {
            const fileCountByLanguage: Partial<
                Record<ProgrammingLanguage, number>
            > = {};

            for (const [language, count] of languageCounts) {
                fileCountByLanguage[language] = count;
            }

            const languages = Array.from(languageCounts.keys()).sort();

            segments.push({
                moduleName:
                    modulePath === "."
                        ? path.basename(path.resolve(repositoryPath))
                        : modulePath,
                modulePath,
                languages,
                fileCountByLanguage,
            });
        }

        segments.sort((a, b) =>
            a.modulePath.localeCompare(b.modulePath),
        );

        const allLanguages = Array.from(
            new Set(segments.flatMap((segment) => segment.languages)),
        ).sort();

        const crossLanguageBoundaries = segments
            .filter((segment) => segment.languages.length > 1)
            .map(
                (segment) =>
                    `${segment.modulePath}: ${segment.languages.join(" + ")}`,
            );

        const moduleCount = segments.length;

        const result: MultiLanguageDetectionResult = {
            isMultiLanguage: allLanguages.length > 1,
            languages: allLanguages,
            segments,
            isMonorepo: this.hasMonorepoEvidence(repositoryPath),
            moduleCount,
            crossLanguageBoundaries,
            detectedAt: new Date().toISOString(),
        };

        console.log("\n========== MULTI-LANGUAGE DETECTION ==========");
        console.log(`Repository: ${path.resolve(repositoryPath)}`);
        console.log(`Languages detected: ${allLanguages.length}`);
        console.log(`Multiple languages: ${result.isMultiLanguage}`);
        console.log(`Modules detected: ${moduleCount}`);
        console.log(`Potential monorepo: ${result.isMonorepo}`);

        console.log("\nLanguages:");
        console.log(allLanguages);

        console.log("\nLanguage segments:");
        console.table(
            segments.map((segment) => ({
                module: segment.moduleName,
                path: segment.modulePath,
                languages: segment.languages.join(", "),
                filesByLanguage: Object.entries(
                    segment.fileCountByLanguage,
                )
                    .map(([language, count]) => `${language}: ${count}`)
                    .join(", "),
            })),
        );

        console.log("\nCross-language boundaries:");
        console.log(crossLanguageBoundaries);

        return result;
    }

    private hasMonorepoEvidence(repositoryPath: string): boolean {
        const root = path.resolve(repositoryPath);

        // Common root-level monorepo configuration files.
        const monorepoMarkerFiles = [
            "pnpm-workspace.yaml",
            "lerna.json",
            "nx.json",
            "turbo.json",
            "settings.gradle",
            "settings.gradle.kts",
        ];

        if (
            monorepoMarkerFiles.some((fileName) =>
                fs.existsSync(path.join(root, fileName)),
            )
        ) {
            return true;
        }

        // Check package.json for npm/Yarn workspace configuration.
        const packageJsonPath = path.join(root, "package.json");

        if (!fs.existsSync(packageJsonPath)) {
            return false;
        }

        try {
            const packageJsonContent = fs.readFileSync(
                packageJsonPath,
                "utf8",
            );

            const packageJson: unknown = JSON.parse(packageJsonContent);

            if (
                typeof packageJson !== "object" ||
                packageJson === null ||
                !("workspaces" in packageJson)
            ) {
                return false;
            }

            const workspaces = packageJson.workspaces;

            // Supported forms:
            // "workspaces": ["packages/*", "apps/*"]
            // "workspaces": { "packages": ["packages/*", "apps/*"] }
            if (Array.isArray(workspaces)) {
                return workspaces.length > 0;
            }

            if (
                typeof workspaces === "object" &&
                workspaces !== null &&
                "packages" in workspaces &&
                Array.isArray(workspaces.packages)
            ) {
                return workspaces.packages.length > 0;
            }

            return false;
        } catch {
            // Invalid or unreadable package.json is not evidence.
            return false;
        }
    }
}
