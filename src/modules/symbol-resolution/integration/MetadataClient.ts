import http from "node:http";
import https from "node:https";
import * as v from "../../../shared/validation.js";
import { ResolutionError, type MetadataAnalysis, type MetadataDocument } from "../model.js";
import { validateMetadataAnalysis, validateMetadataDocument } from "./contracts.js";
export interface MetadataProvider {
    analysis(projectId: string, analysisId: string): Promise<MetadataAnalysis>;
    document(projectId: string, analysisId: string, artifactId: string): Promise<MetadataDocument>;
}
export class MetadataClient implements MetadataProvider {
    private readonly base: URL;
    constructor(base = process.env.CODEATLAS_METADATA_BASE_URL ?? "http://127.0.0.1:8000",
        private readonly limits = { connectMs: 2000, operationMs: 15000, maxBytes: 16 * 1024 * 1024 }) {
        this.base = new URL(base);
        if (!["http:", "https:"].includes(this.base.protocol) || this.base.username || this.base.password || this.base.search || this.base.hash || this.base.pathname !== "/") throw new Error("Invalid metadata base URL");
        for (const n of Object.values(limits)) if (!Number.isSafeInteger(n) || n <= 0) throw new Error("Invalid metadata client limits");
    }
    private endpoint(project: string, analysis: string): string {
        v.projectId(project); v.analysisId(analysis);
        return `/api/v2/metadata/projects/${project}/analyses/${analysis}`;
    }
    async analysis(project: string, analysis: string): Promise<MetadataAnalysis> {
        const value = await this.get(this.endpoint(project, analysis));
        try {
            validateMetadataAnalysis(value);
            v.check(value.projectId === project && value.analysisId === analysis, "metadata analysis ownership");
            return value;
        } catch (error) {
            if (error instanceof ResolutionError) throw error;
            throw new ResolutionError("METADATA_INVALID", 502);
        }
    }
    async document(project: string, analysis: string, artifact: string): Promise<MetadataDocument> {
        v.hash(artifact);
        const value = await this.get(`${this.endpoint(project, analysis)}/files/${artifact}`);
        try {
            const response = v.object(value, "metadata response", ["status", "metadata"]);
            v.check(response.status === "success", "metadata response status");
            validateMetadataDocument(response.metadata);
            v.check(response.metadata.sourceAst.projectId === project && response.metadata.sourceAst.analysisId === analysis, "document ownership");
            return response.metadata;
        } catch (error) {
            if (error instanceof ResolutionError) throw error;
            throw new ResolutionError("METADATA_INVALID", 502);
        }
    }
    private get(endpoint: string): Promise<unknown> {
        return new Promise((resolve, reject) => {
            let settled = false;
            const fail = (error: ResolutionError) => { if (!settled) { settled = true; reject(error); } };
            const request = (this.base.protocol === "https:" ? https : http).get(new URL(endpoint, this.base), { agent: false, headers: { Accept: "application/json" } }, response => {
                clearTimeout(connect);
                if (response.statusCode !== 200) {
                    response.destroy();
                    fail(new ResolutionError(response.statusCode === 404 ? "METADATA_MISSING" : "METADATA_UPSTREAM_FAILED", response.statusCode === 404 ? 424 : 502));
                    return;
                }
                const chunks: Buffer[] = [];
                let size = 0;
                response.on("data", (chunk: Buffer) => {
                    size += chunk.length;
                    if (size > this.limits.maxBytes) { fail(new ResolutionError("METADATA_RESPONSE_LIMIT", 502)); request.destroy(); }
                    else chunks.push(chunk);
                });
                response.on("error", () => fail(new ResolutionError("METADATA_UNAVAILABLE", 503)));
                response.on("end", () => {
                    if (settled) return;
                    try {
                        const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
                        settled = true; resolve(value);
                    } catch { fail(new ResolutionError("METADATA_INVALID", 502)); }
                });
            });
            const connect = setTimeout(() => { fail(new ResolutionError("METADATA_CONNECT_TIMEOUT", 504)); request.destroy(); }, this.limits.connectMs);
            const operation = setTimeout(() => { fail(new ResolutionError("METADATA_TIMEOUT", 504)); request.destroy(); }, this.limits.operationMs);
            request.on("socket", socket => socket.once(this.base.protocol === "https:" ? "secureConnect" : "connect", () => clearTimeout(connect)));
            request.on("error", () => fail(new ResolutionError("METADATA_UNAVAILABLE", 503)));
            request.on("close", () => { clearTimeout(connect); clearTimeout(operation); });
        });
    }
}
