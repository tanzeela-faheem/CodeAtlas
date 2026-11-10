import { readFileSync } from "node:fs";
import { deserializeAst, verifyAstSource } from "../../ast-management/serializer.js";
import { validateMetadataAnalysis, validateMetadataDocument, digest } from "../../symbol-resolution/integration/contracts.js";
import { validateResolutionAnalysis, validateResolutionDocument, validateResolutionReference } from "../../symbol-resolution/validation.js";
import type { FileEvidence } from "../contracts.js";
export function json(name: string): unknown { return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8')); }
export function metadataAnalysis() { const m = json('metadata-analysis'); validateMetadataAnalysis(m); return m; }
export function resolutionAnalysis() { const r = json('resolution-analysis'); validateResolutionAnalysis(r); return r; }
export function evidence(name: string): FileEvidence {
    const ast = deserializeAst(readFileSync(new URL(`./fixtures/${name}.ast.json`, import.meta.url), 'utf8'));
    verifyAstSource(ast, source(name));
    const metadata = json(`${name}.metadata`), resolution = json(`${name}.resolution`), resolutionArtifact = json(`${name}.resolution-reference`);
    validateMetadataDocument(metadata); validateResolutionDocument(resolution); validateResolutionReference(resolutionArtifact);
    const m = metadataAnalysis();
    return { ast, metadata, resolution, resolutionArtifact, sourceAnalysisHash: m.sourceAnalysisHash, metadataAnalysisHash: digest(m), resolutionAnalysisHash: digest(resolutionAnalysis()) };
}
export function source(name: string) { return readFileSync(new URL(`./fixtures/${name}.jsx`, import.meta.url), 'utf8'); }
