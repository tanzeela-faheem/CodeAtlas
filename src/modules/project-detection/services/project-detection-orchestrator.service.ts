
import path from "node:path";

import { LanguageDetectorService } from "./language-detector.service.js";
import { FrameworkDetectorService } from "./framework-detector.service.js";
import { BuildSystemDetectorService } from "./build-system-detector.service.js";
import { PackageManagerDetectorService } from "./package-manager-detector.service.js";
import { ProjectStructureAnalyzerService } from "./project-structure-analyzer.service.js";
import { MultiLanguageDetectorService } from "./multi-language-detector.service.js";

import type {
    ProjectProfile,
} from "../types/project-detection.types.js";

export class ProjectDetectionOrchestratorService {
    constructor(
        private readonly languageDetector = new LanguageDetectorService(),
        private readonly frameworkDetector = new FrameworkDetectorService(),
        private readonly buildSystemDetector = new BuildSystemDetectorService(),
        private readonly packageManagerDetector = new PackageManagerDetectorService(),
        private readonly structureAnalyzer = new ProjectStructureAnalyzerService(),
        private readonly multiLanguageDetector = new MultiLanguageDetectorService(),
    ) {}

    async detectProject(
        projectId: string,
        repositoryPath: string,
        projectName?: string,
    ): Promise<ProjectProfile> {
        const resolvedRepositoryPath = path.resolve(repositoryPath);

        console.log("\n========== PROJECT DETECTION STARTED ==========");
        console.log(`Project ID: ${projectId}`);
        console.log(`Repository: ${resolvedRepositoryPath}`);

        // Run independent detectors concurrently.
        const [
    languages,
    frameworks,
    buildSystems,
    packageManagers,
    structure,
] = await Promise.all([
    this.languageDetector.detectLanguages(resolvedRepositoryPath),
    this.frameworkDetector.detectFrameworks(resolvedRepositoryPath),
    this.buildSystemDetector.detectBuildSystems(resolvedRepositoryPath),
    this.packageManagerDetector.detectPackageManagers(resolvedRepositoryPath),
    Promise.resolve(
        this.structureAnalyzer.analyze(resolvedRepositoryPath),
    ),
]);

const multiLanguage =
    await this.multiLanguageDetector.detectMultiLanguage(
        resolvedRepositoryPath,
        languages,
    );

        const profile: ProjectProfile = {
            projectId,
            projectName:
                projectName?.trim() ||
                path.basename(resolvedRepositoryPath),
            repositoryPath: resolvedRepositoryPath,
            detectedAt: new Date().toISOString(),
            languages,
            frameworks,
            buildSystems,
            packageManagers,
            structure,
            multiLanguage,
        };

        console.log("\n========== PROJECT PROFILE SUMMARY ==========");
        console.log(`Project: ${profile.projectName}`);
        console.log(`Project ID: ${profile.projectId}`);
        console.log(`Languages: ${profile.languages.languages.length}`);
        console.log(`Frameworks: ${profile.frameworks.frameworks.length}`);
        console.log(`Build systems: ${profile.buildSystems.buildSystems.length}`);
        console.log(`Package managers: ${profile.packageManagers.packageManagers.length}`);
        console.log(`Files: ${profile.structure.totalFiles}`);
        console.log(`Directories: ${profile.structure.totalDirectories}`);
        console.log(`Modules: ${profile.multiLanguage.moduleCount}`);
        console.log(`Multi-language: ${profile.multiLanguage.isMultiLanguage}`);
        console.log(`Potential monorepo: ${profile.multiLanguage.isMonorepo}`);
        console.log("========== PROJECT DETECTION COMPLETED ==========\n");

        return profile;
    }
}
