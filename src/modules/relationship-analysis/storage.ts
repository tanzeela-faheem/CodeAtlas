import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { analysisDirectory } from "../../shared/workspace-artifacts.js";
import { atomicJson, contained } from "../../shared/storage.js";
import { hash, object, validatedSnapshot } from "../../shared/validation.js";
import { WorkspaceManagerService } from "../respository/services/workspace-manager.service.js";
import { canonical, digest } from "../symbol-resolution/integration/contracts.js";
import { DEFAULT_LIMITS, RelationshipError, type RelationshipAnalysis, type RelationshipDocument, type RelationshipReference } from "./model.js";
import { artifactId, reference, validateRelationshipAnalysis, validateRelationshipDocument } from "./validation.js";
export interface RelationshipStore {
    saveFile(document: RelationshipDocument): Promise<RelationshipReference>;
    getFile(project: string, analysis: string, artifact: string): Promise<RelationshipDocument>;
    saveAnalysis(summary: RelationshipAnalysis): Promise<void>;
    getAnalysis(project: string, analysis: string): Promise<RelationshipAnalysis>;
    getAnalysisManifest?(project: string, analysis: string): Promise<RelationshipAnalysis>;
}
export class FileRelationshipStore implements RelationshipStore {
    constructor(private readonly workspaces = new WorkspaceManagerService()) {}
    private async directory(project: string, analysis: string, create = false): Promise<string> {
        const base = await analysisDirectory(this.workspaces, project, analysis), dir = path.join(base, 'relationships');
        if (create) await fs.mkdir(dir, { recursive: true, mode: 0o700 });
        return contained(base, dir);
    }
    private async read(directory: string, name: string): Promise<unknown> {
        const file = await contained(directory, path.join(directory, name)), handle = await fs.open(file, 'r');
        try {
            const stat = await handle.stat();
            if (!stat.isFile() || stat.size > DEFAULT_LIMITS.maxArtifactBytes) throw new Error('stored size/type');
            const chunks: Buffer[] = []; let total = 0;
            for (;;) {
                const chunk = Buffer.alloc(Math.min(65536, DEFAULT_LIMITS.maxArtifactBytes + 1 - total));
                const { bytesRead } = await handle.read(chunk);
                if (!bytesRead) break;
                total += bytesRead;
                if (total > DEFAULT_LIMITS.maxArtifactBytes) throw new Error('streamed storage bound');
                chunks.push(chunk.subarray(0, bytesRead));
            }
            return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) as unknown;
        } finally { await handle.close(); }
    }
    async saveFile(document: RelationshipDocument): Promise<RelationshipReference> {
        const doc = validatedSnapshot(document, validateRelationshipDocument), ref = reference(doc);
        const text = canonical({ documentHash: ref.documentHash, document: doc });
        if (Buffer.byteLength(text) > DEFAULT_LIMITS.maxArtifactBytes) throw new RelationshipError('RELATIONSHIP_RESOURCE_LIMIT', 413);
        const dir = await this.directory(doc.inputs.sourceAst.projectId, doc.inputs.sourceAst.analysisId, true), temporary = path.join(dir, `.${randomUUID()}.tmp`);
        try {
            await fs.writeFile(temporary, text, { flag: 'wx', mode: 0o600 });
            try { await fs.link(temporary, path.join(dir, `${ref.artifactId}.relationships.json`)); }
            catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
                const prior = await this.getFile(doc.inputs.sourceAst.projectId, doc.inputs.sourceAst.analysisId, ref.artifactId);
                if (digest(prior) !== ref.documentHash) throw new RelationshipError('RELATIONSHIP_ARTIFACT_CONFLICT', 409);
            }
        } finally { await fs.rm(temporary, { force: true }); }
        return ref;
    }
    async getFile(project: string, analysis: string, artifact: string): Promise<RelationshipDocument> {
        hash(artifact);
        try {
            const envelope = object(await this.read(await this.directory(project, analysis), `${artifact}.relationships.json`), 'relationship envelope', ['documentHash', 'document']);
            hash(envelope.documentHash); validateRelationshipDocument(envelope.document);
            const doc = envelope.document;
            if (digest(doc) !== envelope.documentHash || artifactId(doc) !== artifact || doc.inputs.sourceAst.projectId !== project || doc.inputs.sourceAst.analysisId !== analysis) throw new Error('identity/checksum');
            return doc;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error;
            throw new RelationshipError('RELATIONSHIP_STORAGE_CORRUPT', 500);
        }
    }
    private async referenced(summary: RelationshipAnalysis): Promise<void> {
        for (const file of summary.files) if (file.artifact) {
            const doc = await this.getFile(summary.projectId, summary.analysisId, file.artifact.artifactId).catch(() => { throw new RelationshipError('RELATIONSHIP_STORAGE_CORRUPT', 500); });
            if (digest(reference(doc)) !== digest(file.artifact) || doc.inputs.sourceAnalysisHash !== summary.sourceAnalysisHash || doc.inputs.metadataAnalysisHash !== summary.metadataAnalysisHash || doc.inputs.resolutionAnalysisHash !== summary.resolutionAnalysisHash) throw new RelationshipError('RELATIONSHIP_STORAGE_CORRUPT', 500);
        }
    }
    private async summary(project: string, analysis: string): Promise<RelationshipAnalysis> {
        const envelope = object(await this.read(await this.directory(project, analysis), 'summary.json'), 'summary envelope', ['documentHash', 'analysis']);
        hash(envelope.documentHash); validateRelationshipAnalysis(envelope.analysis);
        const a = envelope.analysis;
        if (digest(a) !== envelope.documentHash || a.projectId !== project || a.analysisId !== analysis) throw new Error('summary identity/checksum');
        return a;
    }
    async saveAnalysis(summary: RelationshipAnalysis): Promise<void> {
        const copy = validatedSnapshot(summary, validateRelationshipAnalysis);
        const envelope = { documentHash: digest(copy), analysis: copy };
        if (Buffer.byteLength(JSON.stringify(envelope)) > DEFAULT_LIMITS.maxArtifactBytes) throw new RelationshipError('RELATIONSHIP_RESOURCE_LIMIT', 413);
        try {
            const prior = await this.summary(copy.projectId, copy.analysisId);
            if (prior.sourceAnalysisHash !== copy.sourceAnalysisHash || prior.metadataAnalysisHash !== copy.metadataAnalysisHash || prior.resolutionAnalysisHash !== copy.resolutionAnalysisHash) throw new RelationshipError('RELATIONSHIP_SNAPSHOT_CONFLICT', 409);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { if (error instanceof RelationshipError) throw error; throw new RelationshipError('RELATIONSHIP_STORAGE_CORRUPT', 500); }
        }
        await this.referenced(copy);
        await atomicJson(path.join(await this.directory(copy.projectId, copy.analysisId, true), 'summary.json'), envelope);
    }
    async getAnalysisManifest(project: string, analysis: string): Promise<RelationshipAnalysis> {
        try { return await this.summary(project, analysis); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error; throw new RelationshipError('RELATIONSHIP_STORAGE_CORRUPT', 500); }
    }
    async getAnalysis(project: string, analysis: string): Promise<RelationshipAnalysis> {
        try { const summary = await this.summary(project, analysis); await this.referenced(summary); return summary; }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw error; throw new RelationshipError('RELATIONSHIP_STORAGE_CORRUPT', 500); }
    }
}
