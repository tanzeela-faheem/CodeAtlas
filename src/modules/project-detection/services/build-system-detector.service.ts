
import * as fs from "fs";
import * as path from "path";

import type {
    BuildSystemDetectionResult,
    BuildSystemInfo,
    BuildTool,
} from "../types/project-detection.types.js";

interface BuildRule {
    name: BuildTool;
    buildFiles: string[];
    configurationFiles: string[];
    sourceDirectories: string[];
    testDirectories: string[];
    generatedDirectories: string[];
    outputDirectories: string[];
}

export class BuildSystemDetectorService {
    private readonly ignoredDirectories = new Set([
        ".git",
        "node_modules",
        "vendor",
        ".venv",
        "venv",
        "__pycache__",
        ".next",
        ".nuxt",
        "coverage",
    ]);

    private readonly rules: BuildRule[] = [
        {
            name: "Vite",
            buildFiles: [],
            configurationFiles: [
                "vite.config.js",
                "vite.config.ts",
                "vite.config.mjs",
                "vite.config.mts",
            ],
            sourceDirectories: ["src"],
            testDirectories: ["tests", "test"],
            generatedDirectories: [],
            outputDirectories: ["dist"],
        },
        {
            name: "Webpack",
            buildFiles: [],
            configurationFiles: [
                "webpack.config.js",
                "webpack.config.ts",
                "webpack.config.cjs",
            ],
            sourceDirectories: ["src"],
            testDirectories: ["tests", "test"],
            generatedDirectories: [],
            outputDirectories: ["dist", "build"],
        },
        {
            name: "esbuild",
            buildFiles: [],
            configurationFiles: ["esbuild.config.js", "esbuild.config.ts"],
            sourceDirectories: ["src"],
            testDirectories: ["tests", "test"],
            generatedDirectories: [],
            outputDirectories: ["dist", "build"],
        },
        {
            name: "npm scripts",
            buildFiles: ["package.json"],
            configurationFiles: [],
            sourceDirectories: ["src"],
            testDirectories: ["tests", "test"],
            generatedDirectories: [],
            outputDirectories: ["dist", "build"],
        },
        {
            name: "Maven",
            buildFiles: ["pom.xml"],
            configurationFiles: ["settings.xml"],
            sourceDirectories: ["src/main"],
            testDirectories: ["src/test"],
            generatedDirectories: ["target/generated-sources"],
            outputDirectories: ["target"],
        },
        {
            name: "Gradle",
            buildFiles: ["build.gradle", "build.gradle.kts"],
            configurationFiles: ["settings.gradle", "settings.gradle.kts"],
            sourceDirectories: ["src/main"],
            testDirectories: ["src/test"],
            generatedDirectories: ["build/generated"],
            outputDirectories: ["build"],
        },
        {
            name: "Make",
            buildFiles: ["Makefile", "makefile", "GNUmakefile"],
            configurationFiles: [],
            sourceDirectories: ["src"],
            testDirectories: ["tests", "test"],
            generatedDirectories: [],
            outputDirectories: ["build", "out"],
        },
        {
            name: "CMake",
            buildFiles: ["CMakeLists.txt"],
            configurationFiles: ["CMakePresets.json", "CMakeUserPresets.json"],
            sourceDirectories: ["src"],
            testDirectories: ["tests", "test"],
            generatedDirectories: ["build/generated"],
            outputDirectories: ["build", "out"],
        },
        {
            name: "Cargo",
            buildFiles: ["Cargo.toml"],
            configurationFiles: [".cargo/config", ".cargo/config.toml"],
            sourceDirectories: ["src"],
            testDirectories: ["tests"],
            generatedDirectories: ["target"],
            outputDirectories: ["target"],
        },
        {
            name: "Go build",
            buildFiles: ["go.mod"],
            configurationFiles: ["go.work"],
            sourceDirectories: ["cmd", "internal", "pkg"],
            testDirectories: [],
            generatedDirectories: [],
            outputDirectories: ["bin", "dist"],
        },
        {
            name: "MSBuild",
            buildFiles: [],
            configurationFiles: [],
            sourceDirectories: ["src"],
            testDirectories: ["tests", "test"],
            generatedDirectories: ["obj"],
            outputDirectories: ["bin", "obj"],
        },
    ];

    async detectBuildSystems(
        repositoryPath: string,
    ): Promise<BuildSystemDetectionResult> {
        const root = path.resolve(repositoryPath);

        if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
            throw new Error(`Invalid repository directory: ${root}`);
        }

        const files = this.collectFiles(root);
        const directories = this.collectDirectories(root);
        const buildSystems: BuildSystemInfo[] = [];

        for (const rule of this.rules) {
            const matchingBuildFiles = files.filter((file) =>
                rule.buildFiles.includes(path.basename(file)),
            );

            const matchingConfigFiles = files.filter((file) =>
                rule.configurationFiles.includes(
                    path.relative(root, file).replace(/\\/g, "/"),
                ) ||
                rule.configurationFiles.includes(path.basename(file)),
            );

            let evidenceCount =
                matchingBuildFiles.length + matchingConfigFiles.length;

            // MSBuild projects are identified by project or solution files.
            if (rule.name === "MSBuild") {
                const msbuildFiles = files.filter((file) =>
                    /\.(csproj|fsproj|vbproj|sln)$/i.test(file),
                );

                matchingBuildFiles.push(...msbuildFiles);
                evidenceCount += msbuildFiles.length;
            }

            // npm scripts are only evidence when package.json defines scripts.
            if (rule.name === "npm scripts") {
                const packageFiles = matchingBuildFiles.filter(
                    (file) => path.basename(file) === "package.json",
                );

                const packagesWithScripts = packageFiles.filter((file) => {
                    try {
                        const parsed = JSON.parse(
                            fs.readFileSync(file, "utf8"),
                        ) as { scripts?: Record<string, unknown> };

                        return (
                            parsed.scripts !== undefined &&
                            Object.keys(parsed.scripts).length > 0
                        );
                    } catch {
                        return false;
                    }
                });

                matchingBuildFiles.splice(
                    0,
                    matchingBuildFiles.length,
                    ...packagesWithScripts,
                );

                evidenceCount = packagesWithScripts.length;
            }

            // esbuild can be declared in package.json without its own config file.
            if (rule.name === "esbuild") {
                const packageFiles = files.filter(
                    (file) => path.basename(file) === "package.json",
                );

                const esbuildPackages = packageFiles.filter((file) => {
                    try {
                        const parsed = JSON.parse(
                            fs.readFileSync(file, "utf8"),
                        ) as {
                            dependencies?: Record<string, unknown>;
                            devDependencies?: Record<string, unknown>;
                        };

                        return Boolean(
                            parsed.dependencies?.esbuild ||
                            parsed.devDependencies?.esbuild,
                        );
                    } catch {
                        return false;
                    }
                });

                evidenceCount += esbuildPackages.length;
            }

            if (evidenceCount === 0) {
                continue;
            }

            const sourceDirectories = this.findDirectories(
                directories,
                rule.sourceDirectories,
            );

            const testDirectories = this.findDirectories(
                directories,
                rule.testDirectories,
            );

            const generatedDirectories = this.findDirectories(
                directories,
                rule.generatedDirectories,
            );

            const outputDirectories = this.findDirectories(
                directories,
                rule.outputDirectories,
            );

            buildSystems.push({
                name: rule.name,
                buildFiles: [
                    ...new Set(
                        matchingBuildFiles.map((file) =>
                            this.relativePath(root, file),
                        ),
                    ),
                ],
                sourceDirectories,
                testDirectories,
                generatedDirectories,
                outputDirectories,
                configurationFiles: [
                    ...new Set(
                        matchingConfigFiles.map((file) =>
                            this.relativePath(root, file),
                        ),
                    ),
                ],
                confidence: this.calculateConfidence(rule.name, evidenceCount),
            });
        }

        const result: BuildSystemDetectionResult = {
            buildSystems,
            detectedAt: new Date().toISOString(),
        };

        console.log("\n========== BUILD SYSTEM DETECTION ==========");
        console.log(`Repository: ${root}`);
        console.log(`Files inspected: ${files.length}`);
        console.log(`Build systems detected: ${buildSystems.length}`);

        if (buildSystems.length > 0) {
            console.table(
                buildSystems.map((item) => ({
                    name: item.name,
                    buildFiles: item.buildFiles.length,
                    configurationFiles: item.configurationFiles.length,
                    sourceDirectories: item.sourceDirectories.length,
                    confidence: `${item.confidence}%`,
                })),
            );
        } else {
            console.log("No recognized build systems detected.");
        }

        console.log("=============================================\n");

        return result;
    }
    private calculateConfidence(
    ruleName: BuildTool,
    evidenceCount: number,
): number {
    if (evidenceCount <= 0) {
        return 0;
    }

    const baseConfidence: Partial<Record<BuildTool, number>> = {
        Vite: 95,
        Webpack: 95,
        esbuild: 95,
        "npm scripts": 90,
        Maven: 95,
        Gradle: 95,
        Make: 95,
        CMake: 95,
        Cargo: 95,
        "Go build": 95,
        MSBuild: 95,
    };

    const base = baseConfidence[ruleName] ?? 70;

    // Additional independent evidence increases confidence slightly.
    return Math.min(99, base + Math.max(0, evidenceCount - 1) * 2);
}

    private collectFiles(directory: string): string[] {
        const results: string[] = [];

        for (const entry of fs.readdirSync(directory, {
            withFileTypes: true,
        })) {
            const fullPath = path.join(directory, entry.name);

            if (entry.isSymbolicLink()) {
                continue;
            }

            if (entry.isDirectory()) {
                if (!this.ignoredDirectories.has(entry.name.toLowerCase())) {
                    results.push(...this.collectFiles(fullPath));
                }
            } else if (entry.isFile()) {
                results.push(fullPath);
            }
        }

        return results;
    }

    private collectDirectories(directory: string): string[] {
        const results: string[] = [];

        for (const entry of fs.readdirSync(directory, {
            withFileTypes: true,
        })) {
            if (!entry.isDirectory() || entry.isSymbolicLink()) {
                continue;
            }

            if (this.ignoredDirectories.has(entry.name.toLowerCase())) {
                continue;
            }

            const fullPath = path.join(directory, entry.name);
            results.push(this.relativePath(directory, fullPath));
            results.push(...this.collectDirectories(fullPath).map((child) =>
                path.join(entry.name, child),
            ));
        }

        return results;
    }

    private findDirectories(
        directories: string[],
        expectedNames: string[],
    ): string[] {
        const expected = new Set(
            expectedNames.map((name) => name.toLowerCase()),
        );

        return directories.filter((directory) =>
            expected.has(path.basename(directory).toLowerCase()),
        );
    }

    private relativePath(root: string, filePath: string): string {
        return path.relative(root, filePath).replace(/\\/g, "/");
    }
}
