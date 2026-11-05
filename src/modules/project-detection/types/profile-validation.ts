import {
    object,
    check,
    string,
    array,
    member,
    integer,
    finite,
    boolean,
    timestamp,
    projectId,
    sourcePath,
    hash,
    optional
} from "../../../shared/validation.js";
import type { ProjectProfile } from "./project-detection.types.js";
export const LANGUAGES = [
    "JavaScript",
    "TypeScript",
    "Python",
    "Java",
    "C",
    "C++",
    "C#",
    "Go",
    "Rust",
    "PHP",
    "Ruby",
    "Kotlin",
    "Swift",
    "Dart",
    "Scala",
    "SQL",
    "HTML",
    "CSS",
    "Shell",
    "PowerShell",
    "R",
    "Lua",
    "Perl",
    "Objective-C",
    "MATLAB",
    "Solidity",
    "Elixir",
    "Haskell",
    "Other"
] as const;
export const CATEGORIES = ["backend", "frontend", "desktop", "game", "mobile", "testing", "other"] as const;
export const BUILD_TOOLS = [
    "Maven",
    "Gradle",
    "npm scripts",
    "Webpack",
    "Vite",
    "esbuild",
    "Make",
    "CMake",
    "MSBuild",
    "Cargo",
    "Go build",
    "Composer scripts",
    "Unknown"
] as const;
export const PACKAGE_MANAGERS = [
    "npm",
    "Yarn",
    "pnpm",
    "Bun",
    "pip",
    "Poetry",
    "Pipenv",
    "uv",
    "Conda",
    "Maven",
    "Gradle",
    "Composer",
    "Bundler",
    "Cargo",
    "Go Modules",
    "NuGet",
    "Unknown"
] as const;
export const DIRECTORY_CATEGORIES = [
    "source",
    "test",
    "resource",
    "configuration",
    "documentation",
    "build-output",
    "generated",
    "dependency",
    "module",
    "other"
] as const;
function strings(value: unknown, label: string, paths = false, root = false): void {
    array(value, label);
    for (const item of value) paths ? sourcePath(item, root) : string(item, label);
}
function language(value: unknown): asserts value is string {
    member(value, LANGUAGES, "language");
}
function languages(value: unknown) {
    array(value, "languages");
    value.forEach(language);
    check(new Set(value).size === value.length, "duplicate languages");
}
function confidence(value: unknown) {
    finite(value, "confidence", 100);
}
export function validateProjectProfile(value: unknown, expectedProjectId?: string): asserts value is ProjectProfile {
    const p = object(value, "ProjectProfile", [
        "projectId",
        "projectName",
        "repositoryPath",
        "detectedAt",
        "languages",
        "frameworks",
        "buildSystems",
        "packageManagers",
        "structure",
        "multiLanguage"
    ]);
    projectId(p.projectId);
    check(expectedProjectId === undefined || p.projectId === expectedProjectId, "profile project identity");
    string(p.projectName, "projectName");
    string(p.repositoryPath, "repositoryPath");
    timestamp(p.detectedAt, "detectedAt");
    const detection = object(p.languages, "language detection", [
        "languages",
        "sourceFiles",
        "unknownExtensions",
        "totalSourceFiles",
        "totalLinesOfCode",
        "dominantLanguage",
        "detectedAt"
    ]);
    timestamp(detection.detectedAt, "language timestamp");
    strings(detection.unknownExtensions, "extensions");
    integer(detection.totalSourceFiles, "totalSourceFiles");
    integer(detection.totalLinesOfCode, "totalLinesOfCode");
    if (detection.dominantLanguage !== null) language(detection.dominantLanguage);
    array(detection.sourceFiles, "sourceFiles", 10000);
    const paths = new Set<string>();
    const totals = new Map<string, { count: number; loc: number }>();
    for (const entry of detection.sourceFiles) {
        const f = object(
            entry,
            "SourceFile",
            ["absolutePath", "relativePath", "extension", "language", "linesOfCode", "isGenerated"],
            ["contentHash", "sizeBytes", "modifiedAtMs"]
        );
        string(f.absolutePath, "absolutePath");
        sourcePath(f.relativePath);
        string(f.extension, "extension");
        check(
            /^\.[a-z0-9]+$/.test(f.extension) &&
                f.relativePath.slice(f.relativePath.lastIndexOf(".")).toLowerCase() === f.extension,
            "source extension"
        );
        check(!paths.has(f.relativePath), "duplicate source path");
        paths.add(f.relativePath);
        language(f.language);
        integer(f.linesOfCode, "linesOfCode");
        boolean(f.isGenerated, "isGenerated");
        optional(f, "contentHash", hash);
        optional(f, "sizeBytes", (x) => integer(x, "sizeBytes"));
        optional(f, "modifiedAtMs", (x) => finite(x, "modifiedAtMs"));
        if (!f.isGenerated) {
            const total = totals.get(f.language) ?? { count: 0, loc: 0 };
            total.count++;
            total.loc += f.linesOfCode;
            totals.set(f.language, total);
        }
    }
    array(detection.languages, "language statistics");
    const statsLanguages = new Set<string>();
    for (const entry of detection.languages) {
        const stat = object(entry, "LanguageStatistics", [
            "language",
            "fileCount",
            "linesOfCode",
            "percentageOfSourceFiles",
            "percentageOfLinesOfCode"
        ]);
        language(stat.language);
        integer(stat.fileCount, "fileCount");
        integer(stat.linesOfCode, "linesOfCode");
        confidence(stat.percentageOfSourceFiles);
        confidence(stat.percentageOfLinesOfCode);
        check(!statsLanguages.has(stat.language), "duplicate statistics");
        statsLanguages.add(stat.language);
        check(
            totals.get(stat.language)?.count === stat.fileCount && totals.get(stat.language)?.loc === stat.linesOfCode,
            "language statistics/inventory mismatch"
        );
    }
    check(
        statsLanguages.size === totals.size &&
            detection.totalSourceFiles === [...totals.values()].reduce((n, x) => n + x.count, 0) &&
            detection.totalLinesOfCode === [...totals.values()].reduce((n, x) => n + x.loc, 0),
        "language totals"
    );
    check(
        detection.dominantLanguage === null ? totals.size === 0 : totals.has(detection.dominantLanguage as string),
        "dominant language"
    );
    const frameworks = object(p.frameworks, "framework detection", ["frameworks", "totalDetected"]);
    array(frameworks.frameworks, "frameworks");
    integer(frameworks.totalDetected, "totalDetected");
    check(frameworks.totalDetected === frameworks.frameworks.length, "framework totals");
    for (const entry of frameworks.frameworks) {
        const f = object(entry, "framework", ["name", "category", "confidence", "evidence"]);
        string(f.name, "framework name");
        member(f.category, CATEGORIES, "framework category");
        confidence(f.confidence);
        strings(f.evidence, "framework evidence");
    }
    const builds = object(p.buildSystems, "build detection", ["buildSystems", "detectedAt"]);
    timestamp(builds.detectedAt, "build timestamp");
    array(builds.buildSystems, "build systems");
    for (const entry of builds.buildSystems) {
        const b = object(entry, "build system", [
            "name",
            "buildFiles",
            "sourceDirectories",
            "testDirectories",
            "generatedDirectories",
            "outputDirectories",
            "configurationFiles",
            "confidence"
        ]);
        member(b.name, BUILD_TOOLS, "build tool");
        confidence(b.confidence);
        for (const key of [
            "buildFiles",
            "sourceDirectories",
            "testDirectories",
            "generatedDirectories",
            "outputDirectories",
            "configurationFiles"
        ])
            strings(b[key], key, true, true);
    }
    const packages = object(p.packageManagers, "package detection", ["packageManagers", "detectedAt"]);
    timestamp(packages.detectedAt, "package timestamp");
    array(packages.packageManagers, "package managers");
    for (const entry of packages.packageManagers) {
        const m = object(entry, "package manager", [
            "name",
            "manifestFiles",
            "lockFiles",
            "dependencyCount",
            "version",
            "confidence"
        ]);
        member(m.name, PACKAGE_MANAGERS, "package manager");
        strings(m.manifestFiles, "manifestFiles", true);
        strings(m.lockFiles, "lockFiles", true);
        if (m.dependencyCount !== null) integer(m.dependencyCount, "dependencyCount");
        if (m.version !== null) string(m.version, "version");
        confidence(m.confidence);
    }
    const structure = object(p.structure, "structure", [
        "directories",
        "sourceRoots",
        "testDirectories",
        "resourceDirectories",
        "configurationFiles",
        "documentationFiles",
        "modules",
        "totalFiles",
        "totalDirectories",
        "detectedAt"
    ]);
    timestamp(structure.detectedAt, "structure timestamp");
    integer(structure.totalFiles, "totalFiles");
    integer(structure.totalDirectories, "totalDirectories");
    for (const key of [
        "sourceRoots",
        "testDirectories",
        "resourceDirectories",
        "configurationFiles",
        "documentationFiles"
    ])
        strings(structure[key], key, true, true);
    array(structure.directories, "directories");
    for (const entry of structure.directories) {
        const d = object(entry, "directory", ["path", "category", "fileCount"]);
        sourcePath(d.path, true);
        member(d.category, DIRECTORY_CATEGORIES, "directory category");
        integer(d.fileCount, "directory count");
    }
    array(structure.modules, "modules");
    for (const entry of structure.modules) {
        const m = object(entry, "module", ["name", "path", "languages", "sourceDirectories"]);
        string(m.name, "module name");
        sourcePath(m.path, true);
        languages(m.languages);
        strings(m.sourceDirectories, "module source roots", true, true);
    }
    const multi = object(p.multiLanguage, "multi language", [
        "isMultiLanguage",
        "languages",
        "segments",
        "isMonorepo",
        "moduleCount",
        "crossLanguageBoundaries",
        "detectedAt"
    ]);
    boolean(multi.isMultiLanguage, "isMultiLanguage");
    boolean(multi.isMonorepo, "isMonorepo");
    languages(multi.languages);
    integer(multi.moduleCount, "moduleCount");
    strings(multi.crossLanguageBoundaries, "crossLanguageBoundaries");
    timestamp(multi.detectedAt, "multi language timestamp");
    array(multi.segments, "segments");
    check(multi.moduleCount === multi.segments.length, "module count");
    check(multi.isMultiLanguage === (multi.languages as unknown[]).length > 1, "multi language flag");
    for (const entry of multi.segments) {
        const segment = object(entry, "segment", ["moduleName", "modulePath", "languages", "fileCountByLanguage"]);
        string(segment.moduleName, "moduleName");
        sourcePath(segment.modulePath, true);
        languages(segment.languages);
        const counts = object(segment.fileCountByLanguage, "fileCountByLanguage", [], LANGUAGES);
        for (const [key, count] of Object.entries(counts)) {
            check((segment.languages as unknown[]).includes(key), "segment count language");
            integer(count, "language count");
        }
    }
}
