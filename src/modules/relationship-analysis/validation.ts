import * as v from "../../shared/validation.js";
import { validateMetadataDocument, validateMetadataReference, digest, range, projectDiagnostic } from "../symbol-resolution/integration/contracts.js";
import { validateResolutionReference, diagnostics } from "../symbol-resolution/validation.js";
import { validateAstReference } from "../ast-management/identity.js";
import { RESOLVER_VERSION } from "../symbol-resolution/model.js";
import { relationshipId } from "./contracts.js";
import { ANALYZER_VERSION, DEFAULT_LIMITS, KINDS, emptyRelationshipCounts, emptyFileCounts, type RelationshipAnalysis, type RelationshipCounts, type RelationshipDocument, type RelationshipInputs, type RelationshipRecord, type RelationshipReference, type SyntaxSlice } from "./model.js";
const node = (x: unknown) => { v.string(x, "AST node ID"); v.check(/^n\d+$/.test(x), "AST node ID"); };
const id = (x: unknown, prefix: string) => { v.string(x, "evidence ID"); v.check(new RegExp(`^${prefix}-[a-f0-9]{64}$`).test(x), "evidence ID"); };
export function validateInputs(value: unknown): asserts value is RelationshipInputs {
    const i = v.object(value, "relationship inputs", ["sourceAst", "astArtifactId", "metadataArtifact", "resolutionArtifact", "resolverVersion", "sourceAnalysisHash", "metadataAnalysisHash", "resolutionAnalysisHash"]);
    validateMetadataDocument({ schemaVersion: 1, extractorVersion: "javascript-syntax-v1", sourceAst: i.sourceAst, extractionStatus: "partial", entities: [], diagnostics: [], summary: {} });
    validateMetadataReference(i.metadataArtifact); validateResolutionReference(i.resolutionArtifact);
    for (const k of ["astArtifactId", "sourceAnalysisHash", "metadataAnalysisHash", "resolutionAnalysisHash"]) v.hash(i[k]);
    v.check(i.resolverVersion === RESOLVER_VERSION, "resolver version");
    const source = (value as RelationshipInputs).sourceAst, m = i.metadataArtifact, r = i.resolutionArtifact;
    validateAstReference({ schemaVersion: 1, artifactId: i.astArtifactId, projectId: source.projectId, analysisId: source.analysisId, relativePath: source.relativePath, contentHash: source.contentHash, parserId: source.parserId, parserVersion: source.parserVersion, grammarVersion: source.grammarVersion, normalizationVersion: source.normalizationVersion ?? "syntax-preorder-v1" }, source.projectId, source.analysisId, source.relativePath);
    v.check(m.astArtifactId === i.astArtifactId && m.projectId === source.projectId && m.analysisId === source.analysisId && m.relativePath === source.relativePath && m.contentHash === source.contentHash && r.relativePath === source.relativePath, "input ownership");
}
function slice(value: unknown): void {
    if (value === null) return;
    const s = v.object(value, "syntax slice", ["astNodeId", "tokens", "truncated"]); node(s.astNodeId); v.boolean(s.truncated, "truncation flag"); v.array(s.tokens, "syntax tokens", 128);
    let chars = 0;
    for (const item of s.tokens) { const t = v.object(item, "syntax token", ["astNodeId", "text"]); node(t.astNodeId); v.string(t.text, "token text", true, 4096); chars += t.text.length; }
    v.check(chars <= 4096, "syntax token text limit");
}
export function validateCounts(value: unknown): asserts value is RelationshipCounts {
    const c = v.object(value, "relationship counts", ["kinds", "targets"]), empty = emptyRelationshipCounts();
    for (const k of ["kinds", "targets"] as const) { const r = v.object(c[k], k, Object.keys(empty[k])); for (const x of Object.values(r)) v.integer(x, "relationship count"); }
    v.check(Object.values(c.kinds as Record<string, number>).reduce((a, b) => a + b, 0) === Object.values(c.targets as Record<string, number>).reduce((a, b) => a + b, 0), "relationship count balance");
}
export function addCounts(total: RelationshipCounts, addition: RelationshipCounts): void {
    for (const k of Object.keys(total.kinds) as (keyof RelationshipCounts["kinds"])[]) total.kinds[k] += addition.kinds[k];
    for (const k of Object.keys(total.targets) as (keyof RelationshipCounts["targets"])[]) total.targets[k] += addition.targets[k];
}
export function validateRelationshipDocument(value: unknown): asserts value is RelationshipDocument {
    const d = v.object(value, "relationship document", ["schemaVersion", "analyzerVersion", "inputs", "upstreamStatus", "status", "relationships", "counts", "diagnostics", "upstreamDiagnostics"]);
    v.check(d.schemaVersion === 1 && d.analyzerVersion === ANALYZER_VERSION, "relationship version"); validateInputs(d.inputs);
    v.member(d.upstreamStatus, ["complete", "partial"], "upstream file status"); v.member(d.status, ["complete", "partial"], "relationship file status");
    diagnostics(d.diagnostics);
    const upstream = v.object(d.upstreamDiagnostics, "upstream diagnostics", ["ast", "metadata", "resolution", "references"]);
    v.array(upstream.references, "reference diagnostics", 10000);
    for (const item of upstream.references) { const r = v.object(item, "reference diagnostics", ["referenceId", "diagnostics"]); id(r.referenceId, "ref"); diagnostics(r.diagnostics); }
    diagnostics(upstream.resolution); v.array(upstream.ast, "AST diagnostics", 10000);
    for (const item of upstream.ast) { const a = v.object(item, "AST diagnostic", ["nodeId", "code", "start", "end"]); node(a.nodeId); v.member(a.code, ["ERROR_NODE", "MISSING_NODE"], "AST diagnostic"); range({ start: a.start, end: a.end }); }
    validateMetadataDocument({ schemaVersion: 1, extractorVersion: "javascript-syntax-v1", sourceAst: d.inputs.sourceAst, extractionStatus: "partial", entities: [], diagnostics: upstream.metadata, summary: {} });
    v.array(d.relationships, "relationships", DEFAULT_LIMITS.maxRelationships);
    const counts = emptyRelationshipCounts(), seen = new Set<string>();
    for (const item of d.relationships) {
        const r = v.object(item, "relationship", ["relationshipId", "kind", "source", "target", "classification", "astNodeId", "range", "evidence", "syntax", "limitations"]);
        id(r.relationshipId, "rel"); v.check(!seen.has(r.relationshipId as string), "duplicate relationship"); seen.add(r.relationshipId as string);
        v.member(r.kind, KINDS, "relationship kind"); node(r.astNodeId); range(r.range);
        const source = v.object(r.source, "source endpoint", ["entityId", "moduleEntityId", "enclosingCallableEntityId", "context"]); id(source.entityId, "meta"); id(source.moduleEntityId, "meta"); if (source.enclosingCallableEntityId !== null) id(source.enclosingCallableEntityId, "meta"); v.member(source.context, ["module", "callable", "initializer", "declaration", "ownership"], "source context");
        const t = v.object(r.target, "target endpoint", ["status", "entityId", "symbolId", "meaning"]);
        v.member(t.status, Object.keys(counts.targets), "target status"); if (t.entityId !== null) id(t.entityId, "meta"); if (t.symbolId !== null) id(t.symbolId, "symbol");
        if (t.status === "established") {
            v.check(t.entityId !== null || t.symbolId !== null, "empty established endpoint");
            v.member(t.meaning, ["callable_declaration", "class_declaration", "lexical_binding", "syntactic_entity"], "target meaning");
        } else v.check(t.entityId === null && t.symbolId === null && t.meaning === null, "fabricated candidate endpoint");
        v.member(r.classification, ["verified_local", "syntax", "candidate", "unsupported", "invalid"], "classification");
        const expectedClassification = t.status === "established" ? t.meaning === "syntactic_entity" || r.kind === "extends_syntax" ? "syntax" : "verified_local" : t.status === "unsupported" ? "unsupported" : t.status === "invalid" ? "invalid" : "candidate";
        v.check(r.classification === expectedClassification, "evidence classification");
        const e = v.object(r.evidence, "relationship evidence", ["astNodeIds", "metadataEntityIds", "referenceIds", "bindingSymbolId", "candidateSymbolIds"]);
        for (const [key, prefix] of [["astNodeIds", "node"], ["metadataEntityIds", "meta"], ["referenceIds", "ref"], ["candidateSymbolIds", "symbol"]] as const) {
            v.array(e[key], key, 10000); for (const entry of e[key]) prefix === "node" ? node(entry) : id(entry, prefix); v.check(new Set(e[key]).size === e[key].length, "duplicate evidence");
        }
        v.array(e.astNodeIds, "AST evidence", 10000); v.array(e.metadataEntityIds, "metadata evidence", 10000); v.array(e.referenceIds, "reference evidence", 1);
        if (e.bindingSymbolId !== null) id(e.bindingSymbolId, "symbol");
        v.check(e.astNodeIds.includes(r.astNodeId) && e.metadataEntityIds.includes(source.entityId) && e.metadataEntityIds.includes(source.moduleEntityId) && (source.enclosingCallableEntityId === null || e.metadataEntityIds.includes(source.enclosingCallableEntityId)), "missing source evidence");
        if (source.context === "module") v.check(source.entityId === source.moduleEntityId && source.enclosingCallableEntityId === null, "module source context");
        if (source.context === "callable") v.check(source.entityId === source.enclosingCallableEntityId, "callable source context");
        if (t.entityId !== null) v.check(e.metadataEntityIds.includes(t.entityId), "missing target entity evidence");
        if (t.symbolId !== null) v.check(t.symbolId === e.bindingSymbolId, "target binding evidence");
        if (t.status === "established") {
            if (r.kind === "calls") v.check(t.meaning === "callable_declaration" && t.entityId !== null && t.symbolId !== null && e.referenceIds.length === 1, "call target policy");
            if (r.kind === "constructs" || r.kind === "extends_syntax") v.check(t.meaning === "class_declaration" && t.entityId !== null && t.symbolId !== null && e.referenceIds.length === 1, "class target policy");
            if (r.kind === "reads" || r.kind === "writes") v.check(t.meaning === "lexical_binding" && t.symbolId !== null && t.entityId === null && e.referenceIds.length === 1, "occurrence target policy");
        }
        if (r.kind === "contains") v.check(t.status === "established" && t.meaning === "syntactic_entity" && t.entityId !== null && t.symbolId === null && source.entityId !== t.entityId && source.context === "ownership", "containment policy");
        if (r.kind === "imports_syntax") v.check(t.status === "deferred" || t.status === "invalid", "no linked import targets");
        const s = v.object(r.syntax, "relationship syntax", ["expression", "moduleSpecifier", "importedName", "localName", "exportedName", "importKind", "exportKind"]);
        slice(s.expression); slice(s.moduleSpecifier);
        for (const k of ["importedName", "localName", "exportedName"]) v.nullableString(s[k], k);
        if (s.importKind !== null) v.member(s.importKind, ["default", "named", "namespace", "side_effect"], "import kind");
        if (s.exportKind !== null) v.member(s.exportKind, ["local", "declaration", "default", "reexport", "star"], "export kind");
        v.array(r.limitations, "limitations", 10000); for (const c of r.limitations) { v.string(c, "limitation", false, 128); v.check(/^[A-Z][A-Z0-9_]*$/.test(c), "limitation code"); }
        const { relationshipId: _, ...record } = item as RelationshipRecord;
        v.check(r.relationshipId === relationshipId(d.inputs, record), "relationship identity");
        counts.kinds[r.kind as keyof typeof counts.kinds]++; counts.targets[t.status as keyof typeof counts.targets]++;
    }
    validateCounts(d.counts); v.check(digest(counts) === digest(d.counts), "relationship counts");
    const doc = value as RelationshipDocument;
    const partial = doc.upstreamStatus === "partial" || doc.inputs.metadataArtifact.extractionStatus === "partial" || doc.inputs.sourceAst.parseStatus === "syntax_errors" || doc.diagnostics.length || doc.upstreamDiagnostics.ast.length || doc.upstreamDiagnostics.metadata.length || doc.upstreamDiagnostics.resolution.length || doc.relationships.some(r => r.target.status !== "established");
    v.check(doc.status === (partial ? "partial" : "complete"), "relationship partial status");
    // Syntactic containment must remain an acyclic single-parent forest.
    const parents = new Map<string, string>();
    for (const r of doc.relationships.filter(r => r.kind === "contains")) { v.check(!parents.has(r.target.entityId!), "duplicate containment child"); parents.set(r.target.entityId!, r.source.entityId); }
    for (const child of parents.keys()) { let current: string | undefined = child, depth = 0; while (current && parents.has(current)) { v.check(++depth <= 512, "containment cycle/depth"); current = parents.get(current); } }
}
export function artifactId(doc: RelationshipDocument): string { return digest(["relationship-file", 1, ANALYZER_VERSION, doc.inputs]); }
export function reference(doc: RelationshipDocument): RelationshipReference { return { artifactId: artifactId(doc), documentHash: digest(doc), relativePath: doc.inputs.sourceAst.relativePath, counts: structuredClone(doc.counts), status: doc.status }; }
export function validateReference(value: unknown): asserts value is RelationshipReference {
    const r = v.object(value, "relationship reference", ["artifactId", "documentHash", "relativePath", "counts", "status"]); v.hash(r.artifactId); v.hash(r.documentHash); v.sourcePath(r.relativePath); validateCounts(r.counts); v.member(r.status, ["complete", "partial"], "artifact status");
}
export function validateRelationshipAnalysis(value: unknown): asserts value is RelationshipAnalysis {
    const a = v.object(value, "relationship analysis", ["schemaVersion", "analyzerVersion", "projectId", "analysisId", "sourceAnalysisHash", "metadataAnalysisHash", "resolutionAnalysisHash", "upstreamStatus", "upstreamDiagnostics", "status", "startedAt", "completedAt", "files", "counts", "relationshipCounts"]);
    v.check(a.schemaVersion === 1 && a.analyzerVersion === ANALYZER_VERSION, "relationship analysis version"); v.projectId(a.projectId); v.analysisId(a.analysisId);
    for (const k of ["sourceAnalysisHash", "metadataAnalysisHash", "resolutionAnalysisHash"]) v.hash(a[k]);
    v.member(a.upstreamStatus, ["complete", "partial", "failed"], "resolution analysis status"); v.array(a.upstreamDiagnostics, "upstream diagnostics", 1000); a.upstreamDiagnostics.forEach(projectDiagnostic);
    v.member(a.status, ["running", "complete", "partial", "failed", "interrupted"], "analysis status"); v.timestamp(a.startedAt, "start"); v.check((a.status === "running") === (a.completedAt === null), "completion state"); if (a.completedAt !== null) { v.timestamp(a.completedAt, "completion"); v.check(a.completedAt >= a.startedAt, "timestamps"); }
    v.array(a.files, "relationship outcomes", 1000); const counts = emptyFileCounts(), totals = emptyRelationshipCounts(), paths = new Set<string>(), ids = new Set<string>();
    for (const item of a.files) {
        const f = v.object(item, "file outcome", ["relativePath", "status", "code", "artifact", "upstreamStatus", "upstreamCode", "upstreamDiagnostics"]); v.array(f.upstreamDiagnostics, "upstream file diagnostics", 16); f.upstreamDiagnostics.forEach(projectDiagnostic); v.sourcePath(f.relativePath); v.check(!paths.has(f.relativePath), "duplicate file"); paths.add(f.relativePath);
        v.member(f.status, Object.keys(counts), "file status"); v.member(f.upstreamStatus, Object.keys(counts), "upstream file status");
        for (const k of ["code", "upstreamCode"]) if (f[k] !== null) { v.string(f[k], "code", false, 128); v.check(/^[A-Z][A-Z0-9_]*$/.test(f[k]), "code"); }
        v.check(["complete", "partial"].includes(f.status) === (f.artifact !== null) && (f.artifact === null) === (f.code !== null), "file artifact/state");
        if (f.artifact !== null) { validateReference(f.artifact); v.check(f.artifact.relativePath === f.relativePath && f.artifact.status === f.status && !ids.has(f.artifact.artifactId), "file reference"); ids.add(f.artifact.artifactId); addCounts(totals, f.artifact.counts); }
        counts[f.status as keyof typeof counts]++;
    }
    const c = v.object(a.counts, "file counts", Object.keys(counts)); for (const x of Object.values(c)) v.integer(x, "file count"); validateCounts(a.relationshipCounts);
    v.check(digest(counts) === digest(c) && digest(totals) === digest(a.relationshipCounts), "aggregate counts");
    const expected = counts.complete === a.files.length && a.upstreamStatus === "complete" ? "complete" : counts.complete + counts.partial > 0 ? "partial" : "failed";
    if (a.status !== "running" && a.status !== "interrupted") v.check(a.status === expected, "aggregate status");
}
