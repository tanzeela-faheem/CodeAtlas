
export type ProgrammingLanguage =
    | "JavaScript"
    | "TypeScript"
    | "Python"
    | "Java"
    | "C"
    | "C++"
    | "C#"
    | "Go"
    | "Rust"
    | "PHP"
    | "Ruby"
    | "Kotlin"
    | "Swift"
    | "Dart"
    | "Scala"
    | "SQL"
    | "HTML"
    | "CSS"
    | "Shell"
    | "PowerShell"
    | "R"
    | "Lua"
    | "Perl"
    | "Objective-C"
    | "MATLAB"
    | "Solidity"
    | "Elixir"
    | "Haskell"
    | "Other";

export type FrameworkCategory =
    | "backend"
    | "frontend"
    | "desktop"
    | "game"
    | "mobile"
    | "testing"
    | "other";

export type BuildTool =
    | "Maven"
    | "Gradle"
    | "npm scripts"
    | "Webpack"
    | "Vite"
    | "esbuild"
    | "Make"
    | "CMake"
    | "MSBuild"
    | "Cargo"
    | "Go build"
    | "Composer scripts"
    | "Unknown";

export type PackageManagerName =
    | "npm"
    | "Yarn"
    | "pnpm"
    | "Bun"
    | "pip"
    | "Poetry"
    | "Pipenv"
    | "uv"
    | "Conda"
    | "Maven"
    | "Gradle"
    | "Composer"
    | "Bundler"
    | "Cargo"
    | "Go Modules"
    | "NuGet"
    | "Unknown";

export interface SourceFile {
    absolutePath: string;
    relativePath: string;
    extension: string;
    language: ProgrammingLanguage;
    linesOfCode: number;
    isGenerated: boolean;
}

export interface LanguageStatistics {
    language: ProgrammingLanguage;
    fileCount: number;
    linesOfCode: number;
    percentageOfSourceFiles: number;
    percentageOfLinesOfCode: number;
}

export interface LanguageDetectionResult {
    languages: LanguageStatistics[];
    sourceFiles: SourceFile[];
    unknownExtensions: string[];
    totalSourceFiles: number;
    totalLinesOfCode: number;
    dominantLanguage: ProgrammingLanguage | null;
    detectedAt: string;
}

export interface DetectedFramework {
    name: string;
    category: FrameworkCategory;
    confidence: number;
    evidence: string[];
}

export interface FrameworkDetectionResult {
    frameworks: DetectedFramework[];
    totalDetected: number;
}

export interface BuildSystemInfo {
    name: BuildTool;
    buildFiles: string[];
    sourceDirectories: string[];
    testDirectories: string[];
    generatedDirectories: string[];
    outputDirectories: string[];
    configurationFiles: string[];
    confidence: number;
}

export interface BuildSystemDetectionResult {
    buildSystems: BuildSystemInfo[];
    detectedAt: string;
}

export interface PackageManagerInfo {
    name: PackageManagerName;
    manifestFiles: string[];
    lockFiles: string[];
    dependencyCount: number | null;
    version: string | null;
    confidence: number;
}

export interface PackageManagerDetectionResult {
    packageManagers: PackageManagerInfo[];
    detectedAt: string;
}

export type DirectoryCategory =
    | "source"
    | "test"
    | "resource"
    | "configuration"
    | "documentation"
    | "build-output"
    | "generated"
    | "dependency"
    | "module"
    | "other";

export interface DirectoryInfo {
    path: string;
    category: DirectoryCategory;
    fileCount: number;
}

export interface ProjectModuleInfo {
    name: string;
    path: string;
    languages: ProgrammingLanguage[];
    sourceDirectories: string[];
}

export interface ProjectStructureResult {
    directories: DirectoryInfo[];
    sourceRoots: string[];
    testDirectories: string[];
    resourceDirectories: string[];
    configurationFiles: string[];
    documentationFiles: string[];
    modules: ProjectModuleInfo[];
    totalFiles: number;
    totalDirectories: number;
    detectedAt: string;
}

export interface LanguageSegment {
    moduleName: string;
    modulePath: string;
    languages: ProgrammingLanguage[];
    fileCountByLanguage: Partial<Record<ProgrammingLanguage, number>>;
}

export interface MultiLanguageDetectionResult {
    isMultiLanguage: boolean;
    languages: ProgrammingLanguage[];
    segments: LanguageSegment[];
    isMonorepo: boolean;
    moduleCount: number;
    crossLanguageBoundaries: string[];
    detectedAt: string;
}

export interface ProjectProfile {
    projectId: string;
    projectName: string;
    repositoryPath: string;
    detectedAt: string;

    languages: LanguageDetectionResult;
    frameworks: FrameworkDetectionResult;
    buildSystems: BuildSystemDetectionResult;
    packageManagers: PackageManagerDetectionResult;
    structure: ProjectStructureResult;
    multiLanguage: MultiLanguageDetectionResult;
}
