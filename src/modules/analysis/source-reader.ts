import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { MAX_SOURCE_BYTES } from "../../config.js";
import { contained, relativeSource } from "../../shared/storage.js";
import type { SourceFile } from "../project-detection/types/project-detection.types.js";
import { WorkspaceManagerService } from "../respository/services/workspace-manager.service.js";

export type SourceRead =
    | {
          status: "read";
          sourceCode: string;
          relativePath: string;
          language: string;
          contentHash: string;
          encoding: "utf-8";
          analysisId: string;
      }
    | { status: "read_failed"; code: string; message: string };
export class SourceReader {
    constructor(
        private readonly workspaces = new WorkspaceManagerService(),
        private readonly maxBytes = MAX_SOURCE_BYTES
    ) {}
    async read(projectId: string, file: SourceFile, analysisId: string): Promise<SourceRead> {
        try {
            const relativePath = relativeSource(file.relativePath);
            const workspace = await this.workspaces.resolveWorkspace(projectId);
            const repository = await contained(workspace, path.join(workspace, "repository"));
            // Reject every symlink component, including links which remain inside the repository.
            let current = repository;
            for (const part of relativePath.split("/")) {
                current = path.join(current, part);
                if ((await fs.lstat(current)).isSymbolicLink()) throw new Error("SYMLINK");
            }
            const resolved = await contained(repository, current);
            const handle = await fs.open(resolved, constants.O_RDONLY | constants.O_NOFOLLOW);
            try {
                const before = await handle.stat();
                if (!before.isFile()) throw new Error("NOT_FILE");
                if (before.size > this.maxBytes) throw new Error("FILE_TOO_LARGE");
                const buffer = Buffer.alloc(this.maxBytes + 1);
                let bytesRead = 0;
                while (bytesRead < buffer.length) {
                    const chunk = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
                    if (!chunk.bytesRead) break;
                    bytesRead += chunk.bytesRead;
                }
                if (bytesRead > this.maxBytes) throw new Error("FILE_TOO_LARGE");
                const bytes = buffer.subarray(0, bytesRead);
                if (bytes.includes(0)) throw new Error("BINARY_SOURCE");
                let sourceCode: string;
                try {
                    sourceCode = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
                } catch {
                    throw new Error("UNSUPPORTED_ENCODING");
                }
                const after = await handle.stat();
                const contentHash = createHash("sha256").update(bytes).digest("hex");
                if (
                    before.size !== after.size ||
                    before.mtimeMs !== after.mtimeMs ||
                    (file.contentHash !== undefined && file.contentHash !== contentHash) ||
                    (file.sizeBytes !== undefined && file.sizeBytes !== after.size)
                )
                    throw new Error("SOURCE_CHANGED");
                return {
                    status: "read",
                    sourceCode,
                    relativePath,
                    language: file.language,
                    contentHash,
                    encoding: "utf-8",
                    analysisId
                };
            } finally {
                await handle.close();
            }
        } catch (error) {
            const code =
                error instanceof Error && /^[A-Z_]+$/.test(error.message)
                    ? error.message
                    : "UNSAFE_OR_UNREADABLE_SOURCE";
            return { status: "read_failed", code, message: code };
        }
    }
}
