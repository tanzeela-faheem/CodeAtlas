import * as v from "../../shared/validation.js";
import { validateMetadataDocument, validateMetadataReference, counts, range, digest, projectDiagnostic } from "./integration/contracts.js";
import { validateAstReference } from "../ast-management/identity.js";
import { RESOLVER_VERSION, type ResolutionAnalysis, type ResolutionDocument, type ResolutionReference } from "./model.js";
const nodeId = (x: unknown) => { v.string(x, "AST node ID"); v.check(/^n\d+$/.test(x), "AST node ID"); };
const identity = (x: unknown, prefix: string) => { v.string(x, "snapshot ID"); v.check(new RegExp(`^${prefix}-[a-f0-9]{64}$`).test(x), "snapshot ID"); };
export function diagnostics(value: unknown): void {
    v.array(value, "diagnostics", 100000);
    for (const d of value) { const r = v.object(d, "diagnostic", ["code", "astNodeId", "message"]); v.string(r.code, "code"); v.string(r.message, "message"); if (r.astNodeId !== null) nodeId(r.astNodeId); }
}
export function resolutionId(doc: ResolutionDocument): string {
    return digest(["resolution-file", 1, RESOLVER_VERSION, doc.sourceAst, doc.astArtifactId, doc.metadataArtifact]);
}
export function resolutionReference(doc: ResolutionDocument): ResolutionReference {
    return { artifactId: resolutionId(doc), documentHash: digest(doc), relativePath: doc.sourceAst.relativePath };
}
export function validateResolutionDocument(value: unknown): asserts value is ResolutionDocument {
    const d = v.object(value, "resolution file", ["schemaVersion", "resolverVersion", "sourceAst", "astArtifactId", "metadataArtifact", "status", "scopes", "symbols", "references", "diagnostics", "astDiagnostics", "metadataDiagnostics"]);
    v.check(d.schemaVersion === 1 && d.resolverVersion === RESOLVER_VERSION, "resolution version");
    // Reuse the external provenance/diagnostic validator, without inventing another AST schema.
    validateMetadataDocument({ schemaVersion: 1, extractorVersion: "javascript-syntax-v1", sourceAst: d.sourceAst, extractionStatus: "partial", entities: [], diagnostics: d.metadataDiagnostics, summary: {} });
    validateMetadataReference(d.metadataArtifact);
    const s = (d.sourceAst as ResolutionDocument["sourceAst"]), m = d.metadataArtifact;
    v.hash(d.astArtifactId);
    validateAstReference({ schemaVersion: 1, artifactId: d.astArtifactId, projectId: s.projectId, analysisId: s.analysisId, relativePath: s.relativePath, contentHash: s.contentHash, parserId: s.parserId, parserVersion: s.parserVersion, grammarVersion: s.grammarVersion, normalizationVersion: s.normalizationVersion ?? "syntax-preorder-v1" }, s.projectId, s.analysisId, s.relativePath);
    v.check(m.projectId === s.projectId && m.analysisId === s.analysisId && m.relativePath === s.relativePath && m.contentHash === s.contentHash && m.astArtifactId === d.astArtifactId, "resolution provenance ownership");
    v.member(d.status, ["complete", "partial"], "resolution status");
    diagnostics(d.diagnostics);
    v.array(d.astDiagnostics, "AST diagnostics", 100000);
    for (const item of d.astDiagnostics) { const a = v.object(item, "AST diagnostic", ["nodeId", "code", "start", "end"]); nodeId(a.nodeId); v.member(a.code, ["ERROR_NODE", "MISSING_NODE"], "AST diagnostic code"); range({ start: a.start, end: a.end }); }
    v.array(d.scopes, "scopes", 100000); v.array(d.symbols, "symbols", 100000); v.array(d.references, "references", 100000);
    const scopeIds = new Set<string>(), symbolIds = new Set<string>(), refIds = new Set<string>();
    for (const item of d.scopes) {
        const r = v.object(item, "scope", ["id", "kind", "parentId", "astNodeId", "range", "children", "bindings"]);
        identity(r.id, "scope"); v.check(!scopeIds.has(r.id as string), "duplicate scope"); scopeIds.add(r.id as string);
        v.member(r.kind, ["module", "function", "parameters", "block", "class", "catch", "function-name"], "scope kind");
        if (r.parentId !== null) identity(r.parentId, "scope"); nodeId(r.astNodeId); range(r.range);
        for (const [key, prefix] of [["children", "scope"], ["bindings", "symbol"]] as const) { v.array(r[key], key, 100000); for (const x of r[key]) identity(x, prefix); v.check(new Set(r[key]).size === r[key].length, "duplicate scope links"); }
    }
    for (const item of d.symbols) {
        const r = v.object(item, "symbol", ["id", "name", "kind", "scopeId", "bindingNodeId", "declarations", "initializationOffset", "modifiers", "import"]);
        identity(r.id, "symbol"); v.check(!symbolIds.has(r.id as string), "duplicate symbol"); symbolIds.add(r.id as string);
        v.string(r.name, "symbol name"); v.member(r.kind, ["var", "let", "const", "function", "parameter", "class", "catch", "import", "function-name", "class-name"], "binding kind");
        v.check(scopeIds.has(r.scopeId as string), "symbol scope"); nodeId(r.bindingNodeId);
        if (r.initializationOffset !== null) v.integer(r.initializationOffset, "initialization offset");
        v.array(r.modifiers, "modifiers", 32); for (const x of r.modifiers) v.string(x, "modifier");
        v.array(r.declarations, "declarations", 100000); v.check(r.declarations.length > 0, "empty declaration evidence");
        for (const dec of r.declarations) { const decl = v.object(dec, "declaration evidence", ["metadataEntityId", "astNodeId", "range"]); v.check(decl.metadataEntityId !== null || r.kind === "catch", "AST-only catch evidence"); if (decl.metadataEntityId !== null) identity(decl.metadataEntityId, "meta"); nodeId(decl.astNodeId); range(decl.range); }
        if (r.import !== null) { const imp = v.object(r.import, "import binding", ["importedName", "moduleSpecifier", "targetStatus"]); v.string(imp.importedName, "imported name", true); v.string(imp.moduleSpecifier, "module specifier", true); v.check(imp.targetStatus === "deferred" && r.kind === "import", "import target status"); }
        v.check((r.kind === "import") === (r.import !== null), "import category");
    }
    const doc = value as ResolutionDocument;
    const scopes = new Map(doc.scopes.map(s => [s.id, s])), symbols = new Map(doc.symbols.map(s => [s.id, s]));
    const roots = doc.scopes.filter(s => s.parentId === null);
    v.check(roots.length === 1 && roots[0]!.kind === "module" && roots[0]!.astNodeId === s.rootId, "scope root");
    for (const scope of doc.scopes) {
        if (scope.parentId !== null) {
            const parent = scopes.get(scope.parentId);
            v.check(parent && parent.children.includes(scope.id), "scope parent backlink");
            v.check(parent.range.start.offset <= scope.range.start.offset && parent.range.end.offset >= scope.range.end.offset, "scope containment");
        }
        for (const child of scope.children) v.check(scopes.get(child)?.parentId === scope.id, "scope child backlink");
        for (const binding of scope.bindings) v.check(symbols.get(binding)?.scopeId === scope.id, "scope binding");
        let current = scope, depth = 0;
        while (current.parentId !== null) { v.check(++depth <= 1024, "scope cycle/depth"); current = scopes.get(current.parentId)!; v.check(current, "scope parent missing"); }
    }
    for (const symbol of doc.symbols) {
        const scope = scopes.get(symbol.scopeId)!;
        v.check(scope.bindings.includes(symbol.id), "symbol backlink");
        for (const declaration of symbol.declarations) v.check(scope.range.start.offset <= declaration.range.start.offset && scope.range.end.offset >= declaration.range.end.offset, "declaration scope containment");
    }
    for (const item of d.references) {
        const r = v.object(item, "reference", ["id", "name", "astNodeId", "range", "scopeId", "usage", "status", "symbolId", "candidates", "initialization", "diagnostics"]);
        identity(r.id, "ref"); v.check(!refIds.has(r.id as string), "duplicate reference"); refIds.add(r.id as string);
        v.string(r.name, "reference name"); nodeId(r.astNodeId); range(r.range); v.check(scopeIds.has(r.scopeId as string), "reference scope");
        const refScope = scopes.get(r.scopeId as string)!;
        const refRange = r.range as import("./model.js").Range;
        v.check(refScope.range.start.offset <= refRange.start.offset && refScope.range.end.offset >= refRange.end.offset, "reference scope containment");
        v.member(r.usage, ["read", "write", "read_write", "call", "export"], "reference usage"); v.member(r.status, ["resolved", "unresolved", "ambiguous", "unsupported", "invalid"], "reference status");
        v.check((r.status === "resolved") === (r.symbolId !== null), "reference resolution/target"); if (r.symbolId !== null) v.check(symbolIds.has(r.symbolId as string) && symbols.get(r.symbolId as string)!.name === r.name, "reference symbol");
        v.array(r.candidates, "candidates", 100000); for (const x of r.candidates) v.check(symbolIds.has(x as string), "candidate symbol");
        v.check(r.status === "ambiguous" ? r.candidates.length > 1 : r.candidates.length === 0, "candidate status");
        v.member(r.initialization, ["not_applicable", "before_initialization", "runtime_unknown"], "initialization state"); diagnostics(r.diagnostics);
    }
    const partial = doc.diagnostics.length || doc.references.some(r => r.status !== "resolved") || doc.astDiagnostics.length || doc.metadataDiagnostics.length || m.extractionStatus === "partial";
    v.check(doc.status === (partial ? "partial" : "complete"), "resolution partial status");
}
export const emptyResolutionCounts = (): ResolutionAnalysis["counts"] => ({ complete: 0, partial: 0, unavailable: 0, unsupported: 0, failed: 0 });
export function validateResolutionReference(value: unknown): asserts value is ResolutionReference {
    const r = v.object(value, "resolution reference", ["artifactId", "documentHash", "relativePath"]); v.hash(r.artifactId); v.hash(r.documentHash); v.sourcePath(r.relativePath);
}
export function validateResolutionAnalysis(value: unknown): asserts value is ResolutionAnalysis {
    const s = v.object(value, "resolution summary", ["schemaVersion", "resolverVersion", "projectId", "analysisId", "metadataAnalysisHash", "sourceAnalysisHash", "extractionVersion", "upstreamStatus", "upstreamDiagnostics", "status", "startedAt", "completedAt", "files", "counts"]);
    v.check(s.schemaVersion === 1 && s.resolverVersion === RESOLVER_VERSION, "resolution summary version"); v.projectId(s.projectId); v.analysisId(s.analysisId); v.hash(s.metadataAnalysisHash); v.hash(s.sourceAnalysisHash); v.check(s.extractionVersion === "project-metadata-v1/javascript-syntax-v1", "extraction version"); v.member(s.upstreamStatus, ["complete", "partial", "failed"], "upstream metadata status"); v.array(s.upstreamDiagnostics, "upstream diagnostics", 1000); s.upstreamDiagnostics.forEach(projectDiagnostic);
    v.member(s.status, ["running", "complete", "partial", "failed", "interrupted"], "resolution lifecycle"); v.timestamp(s.startedAt, "start");
    v.check((s.status === "running") === (s.completedAt === null), "resolution completion");
    if (s.completedAt !== null) { v.timestamp(s.completedAt, "completion"); v.check(s.completedAt >= s.startedAt, "resolution timestamps"); }
    v.array(s.files, "resolution outcomes", 1000); const actual = emptyResolutionCounts(), paths = new Set<string>(), ids = new Set<string>();
    for (const item of s.files) {
        const f = v.object(item, "resolution outcome", ["relativePath", "status", "code", "artifact", "upstreamDiagnostics"]); v.array(f.upstreamDiagnostics, "upstream file diagnostics", 16); f.upstreamDiagnostics.forEach(projectDiagnostic); v.sourcePath(f.relativePath); v.check(!paths.has(f.relativePath), "duplicate resolution outcome"); paths.add(f.relativePath);
        v.member(f.status, Object.keys(actual), "resolution file status"); actual[f.status as keyof typeof actual]++;
        v.check(["complete", "partial"].includes(f.status) === (f.artifact !== null), "resolution outcome artifact");
        if (f.artifact !== null) { validateResolutionReference(f.artifact); v.check(f.artifact.relativePath === f.relativePath && !ids.has(f.artifact.artifactId), "resolution reference path/duplicate"); ids.add(f.artifact.artifactId); }
        v.check((f.artifact === null) === (f.code !== null), "resolution failure code"); if (f.code !== null) { v.string(f.code, "failure code"); v.check(/^[A-Z][A-Z0-9_]{0,127}$/.test(f.code), "failure code"); }
    }
    counts(s.counts); v.check(digest(actual) === digest(s.counts), "resolution aggregate counts");
    const expected = actual.complete === s.files.length && s.upstreamStatus === "complete" ? "complete" : actual.complete + actual.partial > 0 ? "partial" : "failed";
    if (!["running", "interrupted"].includes(s.status)) v.check(s.status === expected, "resolution aggregate status");
}
