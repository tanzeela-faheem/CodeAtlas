import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { deserializeAst } from "../../ast-management/serializer.js";
import { JavascriptResolver } from "../../symbol-resolution/languages/javascript.js";
import { validateResolutionDocument, resolutionReference, validateResolutionAnalysis, emptyResolutionCounts } from "../../symbol-resolution/validation.js";
import { digest, validateMetadataAnalysis, validateMetadataDocument, validateMetadataReference } from "../../symbol-resolution/integration/contracts.js";
import { RESOLVER_VERSION, type ResolutionAnalysis } from "../../symbol-resolution/model.js";
const dir = new URL('./fixtures/', import.meta.url);
const read = (name: string): unknown => JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
const metadata = read('metadata-analysis.json'); validateMetadataAnalysis(metadata);
const summary: ResolutionAnalysis = { schemaVersion: 1, resolverVersion: RESOLVER_VERSION, projectId: metadata.projectId, analysisId: metadata.analysisId, sourceAnalysisHash: metadata.sourceAnalysisHash, metadataAnalysisHash: digest(metadata), extractionVersion: metadata.extractionVersion, upstreamStatus: metadata.status, upstreamDiagnostics: metadata.diagnostics, status: 'running', startedAt: '2026-11-09T00:00:04.000Z', completedAt: null, files: [], counts: emptyResolutionCounts() };
for (const file of metadata.files) {
    if(!file.metadataArtifact){summary.files.push({relativePath:file.relativePath,status:'unsupported',code:'RESOLUTION_LANGUAGE_UNSUPPORTED',artifact:null,upstreamDiagnostics:file.diagnostics});summary.counts.unsupported++;continue;}
    const stem = readdirSync(dir).filter(n=>n.endsWith('.ast.json')).find(n=>(read(n) as {relativePath:string}).relativePath===file.relativePath)!.replace('.ast.json','');
    const ast = deserializeAst(readFileSync(new URL(`${stem}.ast.json`, dir), 'utf8'));
    const doc = read(`${stem}.metadata.json`), ref = read(`${stem}.reference.json`); validateMetadataDocument(doc); validateMetadataReference(ref);
    const resolution = new JavascriptResolver().resolve(ast, doc, ref); validateResolutionDocument(resolution);
    const artifact = resolutionReference(resolution);
    writeFileSync(new URL(`${stem}.resolution.json`, dir), JSON.stringify(resolution));
    writeFileSync(new URL(`${stem}.resolution-reference.json`, dir), JSON.stringify(artifact));
    summary.files.push({ relativePath: file.relativePath, status: resolution.status, code: null, artifact, upstreamDiagnostics: file.diagnostics }); summary.counts[resolution.status]++;
}
summary.status = summary.counts.complete === summary.files.length && metadata.status === 'complete' ? 'complete' : 'partial'; summary.completedAt = '2026-11-09T00:00:05.000Z'; validateResolutionAnalysis(summary);
writeFileSync(new URL('resolution-analysis.json', dir), JSON.stringify(summary));
console.log(`Generated ${summary.files.length} validated Module 6 resolution artifacts and summary.`);
