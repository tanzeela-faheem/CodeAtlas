
import * as fs from "fs";
import * as path from "path";

import type {
    PackageManagerDetectionResult,
    PackageManagerInfo,
    PackageManagerName,
} from "../types/project-detection.types.js";

interface ManagerEvidence {
    name: PackageManagerName;
    manifests: Set<string>;
    locks: Set<string>;
    confidence: number;
    versions: Set<string>;
    dependencyCount: number;
}

export class PackageManagerDetectorService {
    private readonly ignoredDirectories = new Set([
        ".git",
        ".hg",
        ".svn",
        "node_modules",
        "vendor",
        ".venv",
        "venv",
        "__pycache__",
        ".next",
        ".nuxt",
        "dist",
        "coverage",
        ".gradle",
        ".idea",
        "bin",
        "obj",
    ]);

    async detectPackageManagers(
        repositoryPath: string,
    ): Promise<PackageManagerDetectionResult> {
        const root = path.resolve(repositoryPath);

        if (!fs.existsSync(root)) {
            throw new Error(`Repository path does not exist: ${root}`);
        }

        if (!fs.statSync(root).isDirectory()) {
            throw new Error(`Repository path is not a directory: ${root}`);
        }

        const files = this.collectFiles(root);
        const evidence = new Map<string, ManagerEvidence>();

        const getEvidence = (
            name: PackageManagerName,
        ): ManagerEvidence => {
            const existing = evidence.get(name);

            if (existing) {
                return existing;
            }

            const created: ManagerEvidence = {
                name,
                manifests: new Set<string>(),
                locks: new Set<string>(),
                confidence: 0,
                versions: new Set<string>(),
                dependencyCount: 0,
            };

            evidence.set(name, created);
            return created;
        };

        const addManifest = (
            name: PackageManagerName,
            file: string,
            confidence: number,
        ): void => {
            const item = getEvidence(name);
            item.manifests.add(path.relative(root, file));
            item.confidence = Math.max(item.confidence, confidence);
        };

        const addLock = (
            name: PackageManagerName,
            file: string,
            confidence: number,
        ): void => {
            const item = getEvidence(name);
            item.locks.add(path.relative(root, file));
            item.confidence = Math.max(item.confidence, confidence);
        };

        const readJson = (file: string): Record<string, unknown> | null => {
            try {
                const parsed: unknown = JSON.parse(
                    fs.readFileSync(file, "utf8"),
                );

                if (
                    typeof parsed === "object" &&
                    parsed !== null &&
                    !Array.isArray(parsed)
                ) {
                    return parsed as Record<string, unknown>;
                }
            } catch {
                // Ignore malformed or unreadable manifests.
            }

            return null;
        };

        for (const file of files) {
            const relativePath = path.relative(root, file);
            const baseName = path.basename(file).toLowerCase();

            // JavaScript / TypeScript ecosystem.
            if (baseName === "package.json") {
                const manifest = readJson(file);

                if (!manifest) {
                    continue;
                }

                const packageManager =
                    typeof manifest.packageManager === "string"
                        ? manifest.packageManager
                        : "";

                const declaredManager = packageManager
    .split("@")[0]
    ?.toLowerCase() ?? "";

                const dependencyCount = this.countDependencies(manifest);

                const managerFromDeclaration =
                    this.javascriptManager(declaredManager);

                if (managerFromDeclaration) {
                    addManifest(managerFromDeclaration, file, 98);

                    const item = getEvidence(managerFromDeclaration);
                    item.dependencyCount += dependencyCount;

                    if (packageManager.includes("@")) {
                        const version = packageManager.slice(
                            packageManager.indexOf("@") + 1,
                        );

                        if (version) {
                            item.versions.add(version);
                        }
                    }
                } else {
                    // Infer the manager from lockfiles beside this manifest.
                    const directory = path.dirname(file);
                    const lockNames = new Set(
                        files
                            .filter(
                                (candidate) =>
                                    path.dirname(candidate) === directory,
                            )
                            .map((candidate) =>
                                path.basename(candidate).toLowerCase(),
                            ),
                    );

                    let inferred: PackageManagerName = "Unknown";

                    if (lockNames.has("pnpm-lock.yaml")) {
                        inferred = "pnpm";
                    } else if (
                        lockNames.has("yarn.lock")
                    ) {
                        inferred = "Yarn";
                    } else if (
                        lockNames.has("bun.lock") ||
                        lockNames.has("bun.lockb")
                    ) {
                        inferred = "Bun";
                    } else if (
                        lockNames.has("package-lock.json") ||
                        lockNames.has("npm-shrinkwrap.json")
                    ) {
                        inferred = "npm";
                    } else {
                        // A package.json without a manager declaration or
                        // lockfile is only weak evidence for npm.
                        inferred = "npm";
                    }

                    addManifest(
                        inferred,
                        file,
                        inferred === "npm" &&
                            !lockNames.has("package-lock.json") &&
                            !lockNames.has("npm-shrinkwrap.json")
                            ? 65
                            : 90,
                    );

                    const item = getEvidence(inferred);
                    item.dependencyCount += dependencyCount;
                }

                continue;
            }

            if (baseName === "package-lock.json" ||
                baseName === "npm-shrinkwrap.json") {
                addLock("npm", file, 98);

                const lock = readJson(file);

                if (lock) {
                    const lockVersion = lock.lockfileVersion;
                    const item = getEvidence("npm");

                    if (
                        typeof lockVersion === "number" ||
                        typeof lockVersion === "string"
                    ) {
                        // Lockfile format version is not the npm version.
                        // Do not store it as a package-manager version.
                    }

                    if (Array.isArray(lock.packages)) {
                        item.dependencyCount = Math.max(
                            item.dependencyCount,
                            Math.max(0, lock.packages.length - 1),
                        );
                    }
                }

                continue;
            }

            if (baseName === "yarn.lock") {
                addLock("Yarn", file, 98);
                continue;
            }

            if (baseName === "pnpm-lock.yaml") {
                addLock("pnpm", file, 98);
                continue;
            }

            if (baseName === "bun.lock" || baseName === "bun.lockb") {
                addLock("Bun", file, 98);
                continue;
            }

            // Python ecosystem.
            if (baseName === "requirements.txt") {
                addManifest("pip", file, 85);
                getEvidence("pip").dependencyCount +=
                    this.countRequirementLines(file);
                continue;
            }

            if (baseName === "pyproject.toml") {
                const content = this.readText(file).toLowerCase();

                if (content.includes("[tool.poetry")) {
                    addManifest("Poetry", file, 95);
                    getEvidence("Poetry").dependencyCount +=
                        this.countTomlDependencies(content);
                } else if (
                    content.includes("[tool.uv") ||
                    content.includes("uv_build")
                ) {
                    addManifest("uv", file, 90);
                } else {
                    addManifest("pip", file, 65);
                }

                continue;
            }

            if (baseName === "poetry.lock") {
                addLock("Poetry", file, 98);
                continue;
            }

            if (baseName === "pipfile") {
                addManifest("Pipenv", file, 95);
                continue;
            }

            if (baseName === "pipfile.lock") {
                addLock("Pipenv", file, 98);
                continue;
            }

            if (baseName === "uv.lock") {
                addLock("uv", file, 98);
                continue;
            }

            if (
                baseName === "environment.yml" ||
                baseName === "environment.yaml"
            ) {
                const content = this.readText(file).toLowerCase();

                if (
                    content.includes("conda-forge") ||
                    content.includes("channels:") ||
                    content.includes("dependencies:")
                ) {
                    addManifest("Conda", file, 85);
                }

                continue;
            }

            // Java ecosystem.
            if (baseName === "pom.xml") {
                addManifest("Maven", file, 98);
                getEvidence("Maven").dependencyCount +=
                    this.countMatches(
                        this.readText(file),
                        /<dependency>/gi,
                    );
                continue;
            }

            if (
                baseName === "build.gradle" ||
                baseName === "build.gradle.kts"
            ) {
                addManifest("Gradle", file, 95);
                continue;
            }

            if (
                baseName === "settings.gradle" ||
                baseName === "settings.gradle.kts"
            ) {
                addManifest("Gradle", file, 90);
                continue;
            }

            if (baseName === "gradle.lockfile") {
                addLock("Gradle", file, 95);
                continue;
            }

            // PHP ecosystem.
            if (baseName === "composer.json") {
                const manifest = readJson(file);

                addManifest("Composer", file, 95);

                if (manifest) {
                    getEvidence("Composer").dependencyCount +=
                        this.countDependencies(manifest);
                }

                continue;
            }

            if (baseName === "composer.lock") {
                addLock("Composer", file, 98);
                continue;
            }

            // Ruby ecosystem.
            if (baseName === "gemfile") {
                addManifest("Bundler", file, 95);
                continue;
            }

            if (baseName === "gemfile.lock") {
                addLock("Bundler", file, 98);
                continue;
            }

            // Rust ecosystem.
            if (baseName === "cargo.toml") {
                const content = this.readText(file);

                addManifest("Cargo", file, 98);
                getEvidence("Cargo").dependencyCount +=
                    this.countMatches(
                        content,
                        /^\s*[a-zA-Z0-9_-]+\s*=/gm,
                    );
                continue;
            }

            if (baseName === "cargo.lock") {
                addLock("Cargo", file, 98);
                continue;
            }

            // Go ecosystem.
            if (baseName === "go.mod") {
                addManifest("Go Modules", file, 98);
                getEvidence("Go Modules").dependencyCount +=
                    this.countMatches(
                        this.readText(file),
                        /^\s*(?:require\s+\S+|[a-zA-Z0-9._/-]+\s+v[\w.+-]+)/gm,
                    );
                continue;
            }

            if (baseName === "go.sum") {
                addLock("Go Modules", file, 98);
                continue;
            }

            // .NET ecosystem.
            if (baseName === "packages.config") {
                addManifest("NuGet", file, 90);
                getEvidence("NuGet").dependencyCount +=
                    this.countMatches(
                        this.readText(file),
                        /<package\s+/gi,
                    );
                continue;
            }

            if (baseName === "packages.lock.json") {
                addLock("NuGet", file, 98);
                continue;
            }

            if (
                /\.(csproj|fsproj|vbproj)$/i.test(relativePath)
            ) {
                addManifest("NuGet", file, 80);
            }
        }

        // Lockfiles are strong evidence, even if a manifest was not found.
        // Keep lock-only detections rather than silently discarding them.
        const packageManagers: PackageManagerInfo[] = [];

        for (const item of evidence.values()) {
            if (
                item.manifests.size === 0 &&
                item.locks.size === 0
            ) {
                continue;
            }

            packageManagers.push({
                name: item.name,
                manifestFiles: [...item.manifests].sort(),
                lockFiles: [...item.locks].sort(),
                dependencyCount:
                    item.dependencyCount > 0
                        ? item.dependencyCount
                        : null,
                version:
    item.versions.size === 1
        ? [...item.versions][0] ?? null
        : null,
                confidence: item.confidence,
            });
        }

        const result: PackageManagerDetectionResult = {
            packageManagers,
            detectedAt: new Date().toISOString(),
        };

        console.log("\n========== PACKAGE MANAGER DETECTION ==========");
        console.log(`Repository: ${root}`);
        console.log(`Files inspected: ${files.length}`);
        console.log(`Package managers detected: ${packageManagers.length}`);

        if (packageManagers.length > 0) {
            console.table(
                packageManagers.map((manager) => ({
                    name: manager.name,
                    manifests: manager.manifestFiles.length,
                    lockFiles: manager.lockFiles.length,
                    dependencies: manager.dependencyCount ?? "Unknown",
                    version: manager.version ?? "Unknown",
                    confidence: `${manager.confidence}%`,
                })),
            );
        } else {
            console.log("No recognized package managers detected.");
        }

        console.log("===============================================\n");

        return result;
    }

    private collectFiles(root: string): string[] {
        const results: string[] = [];

        const walk = (directory: string): void => {
            let entries: fs.Dirent[];

            try {
                entries = fs.readdirSync(directory, {
                    withFileTypes: true,
                });
            } catch {
                return;
            }

            for (const entry of entries) {
                const fullPath = path.join(directory, entry.name);

                if (entry.isSymbolicLink()) {
                    continue;
                }

                if (entry.isDirectory()) {
                    if (
                        this.ignoredDirectories.has(
                            entry.name.toLowerCase(),
                        )
                    ) {
                        continue;
                    }

                    walk(fullPath);
                } else if (entry.isFile()) {
                    results.push(fullPath);
                }
            }
        };

        walk(root);
        return results;
    }

    private javascriptManager(
        declaredManager: string,
    ): PackageManagerName | null {
        switch (declaredManager) {
            case "npm":
                return "npm";
            case "yarn":
                return "Yarn";
            case "pnpm":
                return "pnpm";
            case "bun":
                return "Bun";
            default:
                return null;
        }
    }

    private countDependencies(
        manifest: Record<string, unknown>,
    ): number {
        const sections = [
            "dependencies",
            "devDependencies",
            "peerDependencies",
            "optionalDependencies",
        ];

        let total = 0;

        for (const section of sections) {
            const value = manifest[section];

            if (
                typeof value === "object" &&
                value !== null &&
                !Array.isArray(value)
            ) {
                total += Object.keys(value).length;
            }
        }

        return total;
    }

    private countRequirementLines(file: string): number {
        const content = this.readText(file);

        return content
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(
                (line) =>
                    line.length > 0 &&
                    !line.startsWith("#") &&
                    !line.startsWith("-"),
            ).length;
    }

    private countTomlDependencies(content: string): number {
        const lines = content.split(/\r?\n/);
        let inDependencySection = false;
        let count = 0;

        for (const line of lines) {
            const trimmed = line.trim();

            if (trimmed.startsWith("[")) {
                inDependencySection =
                    /^\[(tool\.poetry\.(dev-)?dependencies|project\.dependencies)\]$/i.test(
                        trimmed,
                    );
                continue;
            }

            if (
                inDependencySection &&
                /^[a-zA-Z0-9_.-]+\s*=/.test(trimmed)
            ) {
                count++;
            }
        }

        return count;
    }

    private countMatches(
        content: string,
        pattern: RegExp,
    ): number {
        return [...content.matchAll(pattern)].length;
    }

    private readText(file: string): string {
        try {
            return fs.readFileSync(file, "utf8");
        } catch {
            return "";
        }
    }
}
