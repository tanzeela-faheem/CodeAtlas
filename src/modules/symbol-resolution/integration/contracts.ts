import { createHash } from "node:crypto";
import * as v from "../../../shared/validation.js";
import { validateAnalysisSummary } from "../../analysis/summary-validation.js";
import { validateAstReference, artifactId, legacyArtifactId } from "../../ast-management/identity.js";
import { validateAst } from "../../ast-management/serializer.js";
import { COORDINATES, NORMALIZATION_VERSION, type AstDocument } from "../../ast-management/model.js";
import { METADATA_VERSION, ResolutionError, type MetadataAnalysis, type MetadataDocument, type MetadataReference, type Range } from "../model.js";

// Python producer: json.dumps(sort_keys=True, separators=(',', ':'), ensure_ascii=...).
export function canonical(value: unknown, ascii = false): string {
    const sort = (x: unknown): unknown => Array.isArray(x) ? x.map(sort) : x !== null && typeof x === "object"
        ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => {
            // Compare Unicode scalar/code-point order without allocating two arrays
            // per comparison. Canonical bytes (including lone surrogates) stay exact.
            let i = 0, j = 0;
            while (i < a.length && j < b.length) {
                const aa = a.codePointAt(i)!, bb = b.codePointAt(j)!;
                if (aa !== bb) return aa - bb;
                i += aa > 0xffff ? 2 : 1;
                j += bb > 0xffff ? 2 : 1;
            }
            return i < a.length ? 1 : j < b.length ? -1 : 0;
        }).map(([k, val]) => [k, sort(val)])) : x;
    const text = JSON.stringify(sort(value));
    return ascii ? text.replace(/[\u007f-\uffff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`) : text;
}
export const digest = (x: unknown, ascii = false): string => createHash("sha256").update(canonical(x, ascii)).digest("hex");
export function cleanSource(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(cleanSource);
    if (value !== null && typeof value === "object") {
        const r = value as Record<string, unknown>;
        const legacyDefaults = Object.hasOwn(r, "artifactId") && r.projectId === null;
        const defaults = new Set(["failureCode", "completedAt", "code", "message", "artifact"]);
        if (legacyDefaults) for (const k of ["projectId", "analysisId", "parserId", "parserVersion", "grammarVersion", "normalizationVersion"]) defaults.add(k);
        return Object.fromEntries(Object.entries(r).filter(([k, val]) => !(val === null && defaults.has(k))).map(([k, val]) => [k, cleanSource(val)]));
    }
    return value;
}
export function range(value: unknown): asserts value is Range {
    const r = v.object(value, "range", ["start", "end"]);
    for (const p of [r.start, r.end]) {
        const pt = v.object(p, "point", ["offset", "row", "column"]);
        for (const k of ["offset", "row", "column"]) v.integer(pt[k], k);
        v.check((pt.row as number) <= (pt.offset as number) && (pt.column as number) <= (pt.offset as number), "point bounds");
    }
    const rr = value as Range;
    const a = rr.start, b = rr.end;
    v.check(a.offset <= b.offset && (a.row < b.row || (a.row === b.row && a.column <= b.column)) &&
        ((a.offset === b.offset) === (a.row === b.row && a.column === b.column)) &&
        (a.row === b.row ? b.column - a.column === b.offset - a.offset : b.row - a.row + b.column <= b.offset - a.offset), "range order/coordinates");
}
export function counts(value: unknown): asserts value is Record<string, number> {
    v.check(value !== null && typeof value === "object" && !Array.isArray(value), "counts object");
    for (const [k, n] of Object.entries(value)) { v.string(k, "count key"); v.integer(n, "count"); }
}
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
export function validateMetadataReference(value: unknown): asserts value is MetadataReference {
    const r = v.object(value, "metadata reference", ["artifactId", "astArtifactId", "projectId", "analysisId", "relativePath", "contentHash", "documentHash", "extractionStatus", "entityCounts"]);
    for (const k of ["artifactId", "astArtifactId", "contentHash", "documentHash"]) v.hash(r[k]);
    v.projectId(r.projectId); v.analysisId(r.analysisId); v.sourcePath(r.relativePath);
    v.member(r.extractionStatus, ["complete", "partial"], "extraction status"); counts(r.entityCounts);
}
export function projectDiagnostic(value: unknown): void {
    const d = v.object(value, "project diagnostic", ["code", "message", "relativePath", "astArtifactId"]);
    v.string(d.code, "diagnostic code", false, 128); v.string(d.message, "diagnostic message", false, 512);
    if (d.relativePath !== null) v.sourcePath(d.relativePath);
    if (d.astArtifactId !== null) v.hash(d.astArtifactId);
}
export function validateMetadataAnalysis(value: unknown): asserts value is MetadataAnalysis {
    const m = v.object(value, "metadata analysis", ["schemaVersion", "projectId", "analysisId", "extractionVersion", "status", "createdAt", "completedAt", "sourceAnalysis", "sourceAnalysisHash", "files", "entityCounts", "outcomeCounts", "diagnostics"]);
    if (m.schemaVersion !== 1 || m.extractionVersion !== METADATA_VERSION) throw new ResolutionError("METADATA_VERSION_INCOMPATIBLE", 502);
    v.projectId(m.projectId); v.analysisId(m.analysisId); v.member(m.status, ["complete", "partial", "failed"], "metadata status");
    v.timestamp(m.createdAt, "createdAt"); v.timestamp(m.completedAt, "completedAt"); v.check(m.completedAt >= m.createdAt, "metadata lifecycle");
    const source = cleanSource(m.sourceAnalysis);
    validateAnalysisSummary(source, m.projectId, m.analysisId);
    v.check(["completed", "completed_with_errors"].includes(source.status), "upstream completion");
    v.hash(m.sourceAnalysisHash); v.check(digest(source) === m.sourceAnalysisHash, "source analysis hash");
    v.array(m.files, "metadata files", 1000); counts(m.entityCounts); counts(m.outcomeCounts);
    v.array(m.diagnostics, "project diagnostics", 1000); m.diagnostics.forEach(projectDiagnostic);
    const seen = new Set<string>(), ids = new Set<string>(), outcomes: Record<string, number> = {}, entities: Record<string, number> = Object.create(null);
    const originals = new Map(source.files.map(f => [f.relativePath, f]));
    for (const item of m.files) {
        const f = v.object(item, "metadata outcome", ["relativePath", "upstreamStatus", "status", "sourceArtifact", "metadataArtifact", "diagnostics"]);
        v.sourcePath(f.relativePath); v.check(!seen.has(f.relativePath), "duplicate metadata path"); seen.add(f.relativePath);
        v.member(f.status, ["complete", "partial", "unsupported", "unavailable", "invalid", "failed", "upstream_failed", "skipped", "resource_limited"], "metadata outcome");
        const original = originals.get(f.relativePath);
        v.check(original && original.status === f.upstreamStatus && equal(original.artifact ?? null, cleanSource(f.sourceArtifact)), "changed source outcome");
        const success = f.status === "complete" || f.status === "partial";
        v.check(success === (f.metadataArtifact !== null), "metadata success/reference");
        if (f.sourceArtifact !== null) validateAstReference(cleanSource(f.sourceArtifact), m.projectId, m.analysisId, f.relativePath);
        if (f.metadataArtifact !== null) {
            validateMetadataReference(f.metadataArtifact);
            const r = f.metadataArtifact;
            v.check(r.projectId === m.projectId && r.analysisId === m.analysisId && r.relativePath === f.relativePath && r.extractionStatus === f.status && r.astArtifactId === original.artifact?.artifactId && r.contentHash === original.artifact?.contentHash && !ids.has(r.artifactId), "metadata reference ownership");
            ids.add(r.artifactId);
            for (const [k, n] of Object.entries(r.entityCounts)) entities[k] = (entities[k] ?? 0) + n;
        }
        v.array(f.diagnostics, "file diagnostics", 16); f.diagnostics.forEach(projectDiagnostic);
        outcomes[f.status] = (outcomes[f.status] ?? 0) + 1;
    }
    v.check(seen.size === originals.size && equal(outcomes, m.outcomeCounts) && equal(entities, m.entityCounts), "metadata aggregates");
    const complete = seen.size === (outcomes.complete ?? 0) && source.status === "completed";
    const expected = complete ? "complete" : (outcomes.complete ?? 0) + (outcomes.partial ?? 0) > 0 ? "partial" : "failed";
    v.check(m.status === expected, "metadata aggregate status");
}
export function validateMetadataDocument(value: unknown): asserts value is MetadataDocument {
    const m = v.object(value, "metadata document", ["schemaVersion", "extractorVersion", "sourceAst", "extractionStatus", "entities", "diagnostics", "summary"]);
    if (m.schemaVersion !== 1 || m.extractorVersion !== "javascript-syntax-v1") throw new ResolutionError("METADATA_VERSION_INCOMPATIBLE", 502);
    const s = v.object(m.sourceAst, "AST provenance", ["schemaVersion", "normalizationVersion", "projectId", "analysisId", "relativePath", "language", "parserId", "parserVersion", "grammarVersion", "contentHash", "coordinates", "rootId", "parseStatus", "createdAt"]);
    v.check(s.schemaVersion === 1 && (s.normalizationVersion === null || s.normalizationVersion === NORMALIZATION_VERSION) && s.coordinates === COORDINATES, "AST version/coordinates");
    v.projectId(s.projectId); v.analysisId(s.analysisId); v.sourcePath(s.relativePath); v.hash(s.contentHash); v.timestamp(s.createdAt, "AST timestamp");
    for (const k of ["language", "parserId", "rootId"]) v.string(s[k], k);
    for (const k of ["parserVersion", "grammarVersion"]) v.nullableString(s[k], k);
    v.member(s.parseStatus, ["success", "syntax_errors"], "parse status"); v.member(m.extractionStatus, ["complete", "partial"], "extraction status");
    v.array(m.entities, "entities", 100000); v.array(m.diagnostics, "diagnostics", 100000); counts(m.summary);
    const ids = new Set<string>(), totals: Record<string, number> = Object.create(null);
    for (const item of m.entities) {
        const e = v.object(item, "entity", ["entityId", "kind", "name", "qualifiedName", "language", "projectId", "analysisId", "relativePath", "contentHash", "astNodeId", "parentEntityId", "sourceRange", "attributes", "properties"]);
        v.string(e.entityId, "entity ID"); v.check(/^meta-[a-f0-9]{64}$/.test(e.entityId) && !ids.has(e.entityId), "entity identity"); ids.add(e.entityId);
        v.member(e.kind, ["module", "class", "function", "method", "constructor", "field", "variable_declaration", "variable", "parameter", "import", "import_specifier", "export", "export_specifier", "comment", "documentation"], "entity kind");
        for (const k of ["name", "qualifiedName", "parentEntityId"]) v.nullableString(e[k], k);
        for (const k of ["language", "projectId", "analysisId", "relativePath", "contentHash"]) v.check(e[k] === s[k], "entity source identity");
        v.string(e.astNodeId, "entity node"); range(e.sourceRange);
        for (const k of ["attributes", "properties"]) v.check(e[k] !== null && typeof e[k] === "object" && !Array.isArray(e[k]), "entity attributes/properties");
        totals[e.kind] = (totals[e.kind] ?? 0) + 1;
    }
    for (const item of m.diagnostics) {
        const d = v.object(item, "extraction diagnostic", ["code", "message", "astNodeId", "sourceRange"]);
        v.string(d.code, "diagnostic code"); v.string(d.message, "diagnostic message"); v.nullableString(d.astNodeId, "diagnostic node"); if (d.sourceRange !== null) range(d.sourceRange);
    }
    v.check(equal(totals, m.summary) && (!(s.parseStatus === "syntax_errors" || m.diagnostics.length) || m.extractionStatus === "partial"), "extraction counts/status");
}
export function matchEvidence(ast: AstDocument, metadata: MetadataDocument, ref: MetadataReference): void {
    validateAst(ast); validateMetadataDocument(metadata); validateMetadataReference(ref);
    const { nodes: _, diagnostics: __, ...provenance } = ast;
    v.check(equal({ ...provenance, normalizationVersion: ast.normalizationVersion ?? null }, metadata.sourceAst), "AST provenance mismatch");
    v.check(ref.projectId === ast.projectId && ref.analysisId === ast.analysisId && ref.relativePath === ast.relativePath && ref.contentHash === ast.contentHash && ref.extractionStatus === metadata.extractionStatus && equal(ref.entityCounts, metadata.summary), "metadata reference mismatch");
    v.check(ref.astArtifactId === artifactId(ast) || ref.astArtifactId === legacyArtifactId(ast), "AST artifact mismatch");
    const { createdAt: ___, ...identity } = metadata.sourceAst;
    v.check(ref.artifactId === digest(["metadata-file", 1, metadata.extractorVersion, identity]) && ref.documentHash === digest(metadata, true), "metadata artifact/hash mismatch");
    const nodes = new Map(ast.nodes.map(n => [n.id, n])), entities = new Map(metadata.entities.map(e => [e.entityId, e]));
    const roots = metadata.entities.filter(e => e.parentEntityId === null);
    v.check(roots.length === 1 && roots[0]!.kind === "module" && roots[0]!.astNodeId === ast.rootId, "metadata root");
    for (const e of metadata.entities) {
        const n = nodes.get(e.astNodeId);
        v.check(n && equal(e.sourceRange, { start: n.start, end: n.end }), "entity AST range");
        const entityIdentity = [1, metadata.sourceAst.normalizationVersion, ast.projectId, ast.analysisId, ast.relativePath, ast.contentHash, ast.language, ast.parserId, ast.parserVersion, ast.grammarVersion, metadata.extractorVersion, e.astNodeId, e.kind, ""];
        const encoded = JSON.stringify(entityIdentity).replace(/[\u007f-\uffff]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
        v.check(e.entityId === `meta-${createHash("sha256").update(encoded).digest("hex")}`, "entity ID provenance");
        let current = e, depth = 0;
        while (current.parentEntityId !== null) {
            const parent = entities.get(current.parentEntityId);
            v.check(parent && ++depth <= 512 && parent.sourceRange.start.offset <= current.sourceRange.start.offset && parent.sourceRange.end.offset >= current.sourceRange.end.offset, "entity ownership"); current = parent;
        }
        v.check(current.entityId === roots[0]!.entityId, "disconnected entity");
    }
    for (const d of metadata.diagnostics) if (d.astNodeId !== null) {
        const n = nodes.get(d.astNodeId); v.check(n && (d.sourceRange === null || equal(d.sourceRange, { start: n.start, end: n.end })), "diagnostic AST mapping");
    }
}
