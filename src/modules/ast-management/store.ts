import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { contained } from "../../shared/storage.js";
import { StorageError, storageFailure, check } from "../../shared/validation.js";
import { analysisDirectory } from "../../shared/workspace-artifacts.js";
import { WorkspaceManagerService } from "../respository/services/workspace-manager.service.js";
import { NORMALIZATION_VERSION, type AstDocument } from "./model.js";
import { deserializeAst, serializeAst, MAX_AST_BYTES } from "./serializer.js";
import { artifactId, legacyArtifactId, reference, type AstReference } from "./identity.js";
export type { AstReference } from "./identity.js";
export interface AstStore {
    save(document: AstDocument): Promise<AstReference>;
    get(projectId: string, analysisId: string, artifactId: string, expectedHash?: string): Promise<AstDocument>;
    list(projectId: string, analysisId: string): Promise<AstReference[]>;
}
function comparable(document: AstDocument): string {
    // Creation time is not syntax identity. Legacy absent policy means the original v1 normalizer.
    return serializeAst({
        ...document,
        normalizationVersion: document.normalizationVersion ?? NORMALIZATION_VERSION,
        createdAt: "1970-01-01T00:00:00.000Z"
    });
}
export class FileAstStore implements AstStore {
    constructor(private readonly workspaces = new WorkspaceManagerService()) {}
    async save(document: AstDocument): Promise<AstReference> {
        const text = serializeAst(document),
            plain = deserializeAst(text);
        const directory = await analysisDirectory(this.workspaces, plain.projectId, plain.analysisId, true);
        const ref = reference(plain),
            file = path.join(directory, `${ref.artifactId}.ast.json`);
        const temporary = path.join(directory, `.${randomUUID()}.tmp`);
        try {
            await fs.writeFile(temporary, text, { flag: "wx", mode: 0o600 });
            try {
                // Atomic create-if-absent: rename would silently replace an earlier artifact.
                await fs.link(temporary, file);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
                const existing = await this.get(plain.projectId, plain.analysisId, ref.artifactId);
                if (comparable(existing) !== comparable(plain))
                    throw new StorageError("ARTIFACT_CONFLICT", "Incompatible artifact already exists");
            }
        } finally {
            await fs.rm(temporary, { force: true });
        }
        return ref;
    }
    async get(projectId: string, analysisId: string, id: string, expectedHash?: string): Promise<AstDocument> {
        check(typeof id === "string" && /^[a-f0-9]{64}$/.test(id), "AST artifact ID");
        const directory = await analysisDirectory(this.workspaces, projectId, analysisId);
        const file = await contained(directory, path.join(directory, `${id}.ast.json`));
        try {
            check((await fs.stat(file)).size <= MAX_AST_BYTES, "AST storage limit");
            const doc = deserializeAst(await fs.readFile(file, "utf8"));
            if (
                doc.projectId !== projectId ||
                doc.analysisId !== analysisId ||
                (artifactId(doc) !== id && legacyArtifactId(doc) !== id) ||
                (expectedHash !== undefined && doc.contentHash !== expectedHash)
            )
                throw new StorageError("STORAGE_CORRUPT", "AST identity or content hash mismatch");
            return doc;
        } catch (error) {
            return storageFailure(error);
        }
    }
    async list(projectId: string, analysisId: string): Promise<AstReference[]> {
        const directory = await analysisDirectory(this.workspaces, projectId, analysisId);
        const files = (await fs.readdir(directory)).filter((f) => /^[a-f0-9]{64}\.ast\.json$/.test(f)).sort();
        if (files.length > 5000) throw new Error("Artifact count limit exceeded");
        const refs: AstReference[] = [];
        for (const file of files) {
            const id = file.slice(0, 64);
            refs.push(reference(await this.get(projectId, analysisId, id), id));
        }
        return refs;
    }
}
