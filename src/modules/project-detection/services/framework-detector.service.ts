
import * as fs from "fs";
import * as path from "path";

import type {
    DetectedFramework,
    FrameworkDetectionResult,
    FrameworkCategory,
} from "../types/project-detection.types.js";

interface FrameworkRule {
    name: string;
    category: FrameworkCategory;
    indicators: string[];
    description: string;
}

export class FrameworkDetectorService {
    private readonly ignoredDirectories = new Set([
        ".git",
        "node_modules",
        "vendor",
        "dist",
        "build",
        "coverage",
        ".next",
        ".venv",
        "venv",
        "__pycache__",
        "target",
        "bin",
        "obj",
    ]);

    private readonly rules: FrameworkRule[] = [
        {
            name: "Express",
            category: "backend",
            indicators: ["express"],
            description: "Node.js web application framework",
        },
        {
            name: "NestJS",
            category: "backend",
            indicators: ["@nestjs/core"],
            description: "Structured Node.js server framework",
        },
        {
            name: "Fastify",
            category: "backend",
            indicators: ["fastify"],
            description: "Node.js web framework",
        },
        {
            name: "React",
            category: "frontend",
            indicators: ["react"],
            description: "JavaScript user-interface library",
        },
        {
            name: "Angular",
            category: "frontend",
            indicators: ["@angular/core"],
            description: "Web application framework",
        },
        {
            name: "Vue",
            category: "frontend",
            indicators: ["vue"],
            description: "JavaScript user-interface framework",
        },
        {
            name: "Next.js",
            category: "frontend",
            indicators: ["next"],
            description: "React framework for web applications",
        },
        {
            name: "Svelte",
            category: "frontend",
            indicators: ["svelte"],
            description: "Component-based user-interface framework",
        },
        {
            name: "Django",
            category: "backend",
            indicators: ["django"],
            description: "Python web framework",
        },
        {
            name: "Flask",
            category: "backend",
            indicators: ["flask"],
            description: "Python web framework",
        },
        {
            name: "FastAPI",
            category: "backend",
            indicators: ["fastapi"],
            description: "Python API framework",
        },
        {
            name: "Spring Boot",
            category: "backend",
            indicators: ["spring-boot", "spring-boot-starter"],
            description: "Java application framework",
        },
        {
            name: "Laravel",
            category: "backend",
            indicators: ["laravel/framework"],
            description: "PHP web application framework",
        },
        {
            name: "ASP.NET Core",
            category: "backend",
            indicators: ["microsoft.aspnetcore"],
            description: "Microsoft web application framework",
        },
        {
            name: "Electron",
            category: "desktop",
            indicators: ["electron"],
            description: "Desktop application framework",
        },
        {
            name: "Qt",
            category: "desktop",
            indicators: ["qt"],
            description: "Cross-platform application framework",
        },
        {
            name: "Unity",
            category: "game",
            indicators: ["unityengine"],
            description: "Game development engine",
        },
        {
            name: "Jest",
            category: "testing",
            indicators: ["jest"],
            description: "JavaScript testing framework",
        },
        {
            name: "Vitest",
            category: "testing",
            indicators: ["vitest"],
            description: "JavaScript and TypeScript testing framework",
        },
        {
            name: "Pytest",
            category: "testing",
            indicators: ["pytest"],
            description: "Python testing framework",
        },
    ];

    async detectFrameworks(
        repositoryPath: string,
    ): Promise<FrameworkDetectionResult> {
        const root = path.resolve(repositoryPath);

        if (!fs.existsSync(root)) {
            throw new Error(`Repository path does not exist: ${root}`);
        }

        const stat = fs.statSync(root);

        if (!stat.isDirectory()) {
            throw new Error(`Repository path is not a directory: ${root}`);
        }

        const files = this.collectFiles(root);
        const evidenceByFramework = new Map<string, Set<string>>();
        const contentByFile = new Map<string, string>();

        for (const file of files) {
            const name = path.basename(file).toLowerCase();

            if (!this.isRelevantManifest(name)) {
                continue;
            }

            try {
                const content = fs.readFileSync(file, "utf8");
                contentByFile.set(file, content.toLowerCase());
            } catch {
                // Ignore files that cannot be read.
            }
        }

        for (const rule of this.rules) {
            const evidence = new Set<string>();

            for (const [file, content] of contentByFile.entries()) {
                const fileName = path.basename(file).toLowerCase();

                for (const indicator of rule.indicators) {
                    if (this.containsIndicator(content, indicator)) {
                        evidence.add(
                            `${path.relative(root, file)} contains "${indicator}"`,
                        );
                    }
                }

                // Framework-specific configuration file clues.
                if (
                    rule.name === "Next.js" &&
                    (fileName === "next.config.js" ||
                        fileName === "next.config.mjs" ||
                        fileName === "next.config.ts")
                ) {
                    evidence.add(`${path.relative(root, file)} configuration`);
                }

                if (
                    rule.name === "Django" &&
                    fileName === "manage.py" &&
                    content.includes("django")
                ) {
                    evidence.add(`${path.relative(root, file)} entry point`);
                }
            }

            if (evidence.size > 0) {
                evidenceByFramework.set(rule.name, evidence);
            }
        }

        const frameworks: DetectedFramework[] = [];

        for (const rule of this.rules) {
            const evidence = evidenceByFramework.get(rule.name);

            if (!evidence) {
                continue;
            }

            frameworks.push({
                name: rule.name,
                category: rule.category,
                confidence: this.calculateConfidence(evidence.size),
                evidence: [...evidence],
            });
        }

        const result: FrameworkDetectionResult = {
            frameworks,
            totalDetected: frameworks.length,
        };

        console.log("\n========== FRAMEWORK DETECTION ==========");
        console.log(`Repository: ${root}`);
        console.log(`Files inspected: ${files.length}`);
        console.log(`Frameworks detected: ${result.totalDetected}`);

        if (frameworks.length === 0) {
            console.log("No recognized frameworks detected.");
        } else {
            console.table(
                frameworks.map((framework) => ({
                    name: framework.name,
                    category: framework.category,
                    confidence: `${framework.confidence}%`,
                    evidenceCount: framework.evidence.length,
                })),
            );
        }

        console.log("=========================================\n");

        return result;
    }

    private collectFiles(directory: string): string[] {
        const results: string[] = [];

        const entries = fs.readdirSync(directory, {
            withFileTypes: true,
        });

        for (const entry of entries) {
            const fullPath = path.join(directory, entry.name);

            if (entry.isSymbolicLink()) {
                continue;
            }

            if (entry.isDirectory()) {
                if (this.ignoredDirectories.has(entry.name.toLowerCase())) {
                    continue;
                }

                results.push(...this.collectFiles(fullPath));
            } else if (entry.isFile()) {
                results.push(fullPath);
            }
        }

        return results;
    }

    private isRelevantManifest(fileName: string): boolean {
        const relevantNames = new Set([
            "package.json",
            "pom.xml",
            "build.gradle",
            "build.gradle.kts",
            "requirements.txt",
            "pyproject.toml",
            "pipfile",
            "composer.json",
            "cargo.toml",
            "go.mod",
            "packages.config",
            "directory.build.props",
            "manage.py",
            "next.config.js",
            "next.config.mjs",
            "next.config.ts",
            "pytest.ini",
            "setup.cfg",
        ]);

        return (
            relevantNames.has(fileName) ||
            fileName.endsWith(".csproj") ||
            fileName.endsWith(".fsproj")
        );
    }

    private containsIndicator(
        content: string,
        indicator: string,
    ): boolean {
        const escaped = indicator.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&",
        );

        // Match package names without matching arbitrary substrings.
        const pattern = new RegExp(
            `(^|[^a-z0-9@._/-])${escaped}([^a-z0-9@._/-]|$)`,
            "i",
        );

        return pattern.test(content);
    }

    private calculateConfidence(evidenceCount: number): number {
        if (evidenceCount >= 3) {
            return 95;
        }

        if (evidenceCount === 2) {
            return 85;
        }

        return 70;
    }
}
