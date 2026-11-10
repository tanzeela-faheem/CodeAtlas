import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { analysisDirectory } from "../../shared/workspace-artifacts.js";
import { atomicJson, contained } from "../../shared/storage.js";
import { hash, object, validatedSnapshot } from "../../shared/validation.js";
import { WorkspaceManagerService } from "../respository/services/workspace-manager.service.js";
import { canonical, digest } from "./integration/contracts.js";
import { ResolutionError, type ResolutionAnalysis, type ResolutionDocument, type ResolutionReference } from "./model.js";
import { validateResolutionAnalysis, validateResolutionDocument, resolutionId, resolutionReference } from "./validation.js";
export interface ResolutionStore {
    saveFile(doc: ResolutionDocument): Promise<ResolutionReference>;
    getFile(project: string, analysis: string, id: string): Promise<ResolutionDocument>;
    saveAnalysis(summary: ResolutionAnalysis): Promise<void>;
    getAnalysis(project: string, analysis: string): Promise<ResolutionAnalysis>;
    // Validated summary only: downstream consumers validate each file independently.
    getAnalysisManifest?(project: string, analysis: string): Promise<ResolutionAnalysis>;
}
const MAX_BYTES = 16 * 1024 * 1024;
export class FileResolutionStore implements ResolutionStore {
    constructor(private readonly workspaces = new WorkspaceManagerService()) {}
    private async directory(project: string, analysis: string, create = false): Promise<string> {
        const parent = await analysisDirectory(this.workspaces, project, analysis);
        const dir = path.join(parent, "resolution");
        if (create) await fs.mkdir(dir, { recursive: true, mode: 0o700 });
        return contained(parent, dir);
    }
    private async read(directory: string, name: string): Promise<unknown> {
        const file = await contained(directory, path.join(directory, name));
        if ((await fs.stat(file)).size > MAX_BYTES) throw new ResolutionError("RESOLUTION_STORAGE_CORRUPT", 500);
        return JSON.parse(await fs.readFile(file, "utf8")) as unknown;
    }
    async saveFile(document: ResolutionDocument): Promise<ResolutionReference> {
        const doc = validatedSnapshot(document, validateResolutionDocument), ref = resolutionReference(doc), text = canonical({ documentHash: ref.documentHash, document: doc });
        if (Buffer.byteLength(text) > MAX_BYTES) throw new ResolutionError("RESOLUTION_RESOURCE_LIMIT", 413);
        const directory = await this.directory(doc.sourceAst.projectId, doc.sourceAst.analysisId, true);
        const temporary = path.join(directory, `.${randomUUID()}.tmp`);
        try {
            await fs.writeFile(temporary, text, { flag: "wx", mode: 0o600 });
            try { await fs.link(temporary, path.join(directory, `${ref.artifactId}.resolution.json`)); }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
                const prior = await this.getFile(doc.sourceAst.projectId, doc.sourceAst.analysisId, ref.artifactId);
                if (digest(prior) !== ref.documentHash) throw new ResolutionError("RESOLUTION_ARTIFACT_CONFLICT", 409);
            }
        } finally { await fs.rm(temporary, { force: true }); }
        return ref;
    }
    async getFile(project: string, analysis: string, id: string): Promise<ResolutionDocument> {
        hash(id);
        try {
            const dir = await this.directory(project, analysis), envelope = object(await this.read(dir, `${id}.resolution.json`), "resolution envelope", ["documentHash", "document"]);
            hash(envelope.documentHash);
            const value = envelope.document;
            validateResolutionDocument(value);
            if (digest(value) !== envelope.documentHash) throw new Error("checksum");
            if (value.sourceAst.projectId !== project || value.sourceAst.analysisId !== analysis || resolutionId(value) !== id) throw new Error("ownership");
            return value;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") throw error;
            throw new ResolutionError("RESOLUTION_STORAGE_CORRUPT", 500);
        }
    }
    async saveAnalysis(summary: ResolutionAnalysis): Promise<void> {
        const copy = validatedSnapshot(summary, validateResolutionAnalysis);
        if (Buffer.byteLength(JSON.stringify(copy)) > MAX_BYTES) throw new ResolutionError("RESOLUTION_RESOURCE_LIMIT", 413);
        // A summary may reference only already published artifacts from its own snapshot.
        for (const file of copy.files) if (file.artifact) {
            const doc = await this.getFile(copy.projectId, copy.analysisId, file.artifact.artifactId);
            if (digest(doc) !== file.artifact.documentHash || doc.sourceAst.relativePath !== file.relativePath || doc.status !== file.status) throw new ResolutionError("RESOLUTION_STORAGE_CORRUPT", 500);
        }
        await atomicJson(path.join(await this.directory(copy.projectId, copy.analysisId, true), "summary.json"), copy);
    }
    async getAnalysisManifest(project: string, analysis: string): Promise<ResolutionAnalysis> {
        try {
            const value = await this.read(await this.directory(project, analysis), "summary.json");
            validateResolutionAnalysis(value);
            if (value.projectId !== project || value.analysisId !== analysis) throw new Error("ownership");
            return value;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") throw error;
            throw new ResolutionError("RESOLUTION_STORAGE_CORRUPT", 500);
        }
    }
    async getAnalysis(project: string, analysis: string): Promise<ResolutionAnalysis> {
        const value = await this.getAnalysisManifest(project, analysis);
        for (const file of value.files) if (file.artifact) {
            const doc = await this.getFile(project, analysis, file.artifact.artifactId).catch(() => { throw new ResolutionError("RESOLUTION_STORAGE_CORRUPT", 500); });
            if (digest(doc) !== file.artifact.documentHash || doc.sourceAst.relativePath !== file.relativePath || doc.status !== file.status) throw new ResolutionError("RESOLUTION_STORAGE_CORRUPT", 500);
        }
        return value;
    }
}
