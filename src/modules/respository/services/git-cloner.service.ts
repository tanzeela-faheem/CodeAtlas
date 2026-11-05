import { simpleGit } from "simple-git";
import os from "node:os";

export interface GitCloneOptions {
    branch?: string;
    tag?: string;
    commit?: string;
    shallow?: boolean;
}
export interface GitRepositoryInfo {
    url: string;
    branch?: string;
    tag?: string;
    commit: string;
    clonePath: string;
}

function createGitEnvironment(): Record<string, string> {
    const environment: Record<string, string> = {
        GIT_TERMINAL_PROMPT: "0",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_ALLOW_PROTOCOL: "https"
    };

    if (process.env.PATH) {
        environment.PATH = process.env.PATH;
    }

    if (process.platform === "win32") {
        environment.USERPROFILE = os.homedir();

        if (process.env.SystemRoot) {
            environment.SystemRoot = process.env.SystemRoot;
        }

        if (process.env.TEMP) {
            environment.TEMP = process.env.TEMP;
        }
    } else {
        environment.HOME = os.homedir();
        environment.LANG = "C";
    }

    return environment;
}

export function gitCloneArguments(options: GitCloneOptions): string[] {
    if (options.branch && options.tag) throw new Error("Choose branch or tag, not both");
    for (const ref of [options.branch, options.tag, options.commit])
        if (ref !== undefined && (typeof ref !== "string" || !ref || ref.startsWith("-") || /[\s\0]/.test(ref)))
            throw new Error("Invalid Git reference");
    const args: string[] = [];
    if (options.branch ?? options.tag) args.push("--branch", (options.branch ?? options.tag)!);
    if (options.shallow) args.push("--depth", "1");
    return args;
}
export class GitClonerService {
    async cloneRepository(
        repositoryUrl: string,
        clonePath: string,
        options: GitCloneOptions = {}
    ): Promise<GitRepositoryInfo> {
        const args = gitCloneArguments(options);
        const environment = createGitEnvironment();
        try {
            const git = simpleGit({ timeout: { block: 30_000 }, maxConcurrentProcesses: 1 }).env(environment);

            await git.clone(repositoryUrl, clonePath, args);

            const cloned = simpleGit({ baseDir: clonePath, timeout: { block: 30_000 } });
            if (options.commit) await cloned.checkout(options.commit);
            const commit = (await cloned.revparse(["HEAD"])).trim();
            const branch = (await cloned.branch()).current;
            return { url: repositoryUrl, branch, ...(options.tag ? { tag: options.tag } : {}), commit, clonePath };
        } catch (error) {
            throw new Error("Unable to clone Git repository");
        }
    }
}
