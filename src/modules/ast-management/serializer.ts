import { createHash } from "node:crypto";
import {
    check,
    object,
    string,
    integer,
    boolean,
    timestamp,
    projectId,
    analysisId,
    hash,
    sourcePath,
    nullableString,
    array
} from "../../shared/validation.js";
import { COORDINATES, NORMALIZATION_VERSION, type AstDocument, type AstNode, type SourcePoint } from "./model.js";
export const MAX_AST_BYTES = 64 * 1024 * 1024;
const nodeId = (value: unknown) => {
    string(value, "node ID");
    check(/^n\d+$/.test(value), "node ID");
};
function point(value: unknown): asserts value is SourcePoint {
    const p = object(value, "point", ["offset", "row", "column"]);
    for (const key of ["offset", "row", "column"]) integer(p[key], `point.${key}`);
    check(
        (p.column as number) <= (p.offset as number) && (p.row as number) <= (p.offset as number),
        "UTF-16 point bounds"
    );
}
const compare = (a: SourcePoint, b: SourcePoint) => a.row - b.row || a.column - b.column;
function ordered(a: SourcePoint, b: SourcePoint): boolean {
    return (
        a.offset <= b.offset &&
        compare(a, b) <= 0 &&
        (a.offset === b.offset ? compare(a, b) === 0 : compare(a, b) < 0) &&
        (a.row === b.row
            ? b.column - a.column === b.offset - a.offset
            : b.row - a.row + b.column <= b.offset - a.offset)
    );
}
function same(a: SourcePoint, b: SourcePoint): boolean {
    return a.offset === b.offset && a.row === b.row && a.column === b.column;
}
function freezeDocument(doc: AstDocument): void {
    // All shapes are validated before freezing; no arbitrary recursive object graph.
    for (const n of doc.nodes) {
        Object.freeze(n.start);
        Object.freeze(n.end);
        Object.freeze(n.children);
        Object.freeze(n);
    }
    for (const d of doc.diagnostics) {
        Object.freeze(d.start);
        Object.freeze(d.end);
        Object.freeze(d);
    }
    Object.freeze(doc.nodes);
    Object.freeze(doc.diagnostics);
    Object.freeze(doc);
}
/** Validates structural consistency, then freezes this read-only syntax snapshot.
 * This cannot establish exact character/line fidelity without verifyAstSource. */
export function validateAst(value: unknown): asserts value is AstDocument {
    const d = object(
        value,
        "AST",
        [
            "schemaVersion",
            "projectId",
            "analysisId",
            "relativePath",
            "language",
            "parserId",
            "parserVersion",
            "grammarVersion",
            "contentHash",
            "coordinates",
            "rootId",
            "nodes",
            "parseStatus",
            "diagnostics",
            "createdAt"
        ],
        ["normalizationVersion"]
    );
    check(d.schemaVersion === 1, "unsupported AST schema");
    if (Object.hasOwn(d, "normalizationVersion"))
        check(d.normalizationVersion === NORMALIZATION_VERSION, "unsupported normalization policy");
    projectId(d.projectId);
    analysisId(d.analysisId);
    sourcePath(d.relativePath);
    hash(d.contentHash);
    string(d.language, "language");
    check(d.language.trim() === d.language, "language identifier");
    string(d.parserId, "parserId");
    check(d.parserId.trim() === d.parserId && !/\s/.test(d.parserId), "parserId");
    nullableString(d.parserVersion, "parserVersion");
    nullableString(d.grammarVersion, "grammarVersion");
    timestamp(d.createdAt, "createdAt");
    check(d.coordinates === COORDINATES, "coordinate convention");
    check(d.parseStatus === "success" || d.parseStatus === "syntax_errors", "parse status");
    array(d.nodes, "nodes", 100_000);
    check(d.nodes.length > 0, "empty nodes");
    array(d.diagnostics, "diagnostics", 100_000);
    nodeId(d.rootId);
    const nodes = new Map<string, AstNode>();
    let textUnits = 0,
        edges = 0;
    for (const item of d.nodes) {
        const n = object(
            item,
            "node",
            ["id", "type", "parentId", "fieldName", "children", "named", "error", "missing", "start", "end"],
            ["text"]
        );
        nodeId(n.id);
        string(n.type, "node type");
        check(!nodes.has(n.id as string), "duplicate node ID");
        if (n.parentId !== null) nodeId(n.parentId);
        nullableString(n.fieldName, "fieldName");
        array(n.children, "children", 100_000);
        edges += n.children.length;
        check(edges < 100_000, "edge budget");
        n.children.forEach(nodeId);
        check(new Set(n.children).size === n.children.length, "duplicate child");
        boolean(n.named, "named");
        boolean(n.error, "error");
        boolean(n.missing, "missing");
        point(n.start);
        point(n.end);
        check(ordered(n.start, n.end), "node position ordering");
        if (Object.hasOwn(n, "text")) {
            string(n.text, "leaf text", true, MAX_AST_BYTES);
            check(n.children.length === 0 && n.text.length === n.end.offset - n.start.offset, "leaf text/span");
            const lines = n.text.split("\n");
            check(
                n.end.row === n.start.row + lines.length - 1 &&
                    n.end.column === (lines.length === 1 ? n.start.column + n.text.length : lines.at(-1)!.length),
                "leaf text/points"
            );
            textUnits += n.text.length;
            check(textUnits <= MAX_AST_BYTES / 2, "text budget");
        }
        nodes.set(n.id as string, item as AstNode);
    }
    const doc = value as AstDocument;
    const root = nodes.get(doc.rootId);
    check(root?.parentId === null && root.fieldName === null, "root identity");
    const stack = [{ id: doc.rootId, depth: 0 }],
        seen = new Set<string>();
    while (stack.length) {
        const { id, depth } = stack.pop()!;
        check(!seen.has(id) && depth <= 512, "cycle or depth limit");
        seen.add(id);
        const n = nodes.get(id);
        check(n, "unknown node");
        let previous = n.start;
        for (const childId of n.children) {
            const child = nodes.get(childId);
            check(child, "unknown child");
            check(
                child.parentId === id &&
                    ordered(n.start, child.start) &&
                    ordered(child.end, n.end) &&
                    ordered(previous, child.start),
                "parent/child position or order"
            );
            previous = child.end;
            stack.push({ id: childId, depth: depth + 1 });
        }
    }
    check(seen.size === nodes.size, "unreachable nodes");
    const covered = new Set<string>();
    for (const item of doc.diagnostics) {
        const diagnostic = object(item, "diagnostic", ["nodeId", "code", "start", "end"]);
        nodeId(diagnostic.nodeId);
        const n = nodes.get(diagnostic.nodeId as string);
        check(n, "unknown diagnostic node");
        point(diagnostic.start);
        point(diagnostic.end);
        const expected = n.missing ? "MISSING_NODE" : n.error ? "ERROR_NODE" : null;
        check(
            expected !== null &&
                diagnostic.code === expected &&
                !covered.has(n.id) &&
                same(diagnostic.start, n.start) &&
                same(diagnostic.end, n.end),
            "diagnostic coverage/positions"
        );
        covered.add(n.id);
    }
    const errors = doc.nodes.filter((n) => n.error || n.missing);
    check(errors.length === covered.size && errors.every((n) => covered.has(n.id)), "missing diagnostics");
    check(doc.parseStatus !== "success" || errors.length === 0, "success with error nodes");
    freezeDocument(doc);
}
function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === "object")
        return Object.fromEntries(
            Object.entries(value)
                .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                .map(([key, item]) => [key, canonical(item)])
        );
    return value;
}
export function serializeAst(document: AstDocument): string {
    validateAst(document);
    const text = JSON.stringify(canonical(document));
    check(Buffer.byteLength(text) <= MAX_AST_BYTES, "AST storage limit");
    return text;
}
export function deserializeAst(text: string): AstDocument {
    string(text, "stored AST", true, MAX_AST_BYTES);
    check(Buffer.byteLength(text) <= MAX_AST_BYTES, "AST storage limit");
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        check(false, "malformed AST JSON");
    }
    validateAst(value);
    return value;
}
/** Verify exact ranges and leaf characters against the original hash-checked UTF-8 source.
 * Source SHA-256 is not a checksum/authentication of the AST JSON payload. */
export function verifyAstSource(document: AstDocument, source: string | Buffer): void {
    validateAst(document);
    const bytes = typeof source === "string" ? Buffer.from(source, "utf8") : source;
    check(createHash("sha256").update(bytes).digest("hex") === document.contentHash, "source hash mismatch");
    let text: string;
    try {
        text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
        check(false, "source encoding");
    }
    const starts = [0];
    for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
    function position(p: SourcePoint) {
        check(
            p.offset <= text.length &&
                p.row < starts.length &&
                starts[p.row]! + p.column === p.offset &&
                (p.row === starts.length - 1 || p.offset < starts[p.row + 1]!),
            "source coordinate mismatch"
        );
    }
    for (const n of document.nodes) {
        position(n.start);
        position(n.end);
        if (n.text !== undefined)
            check(n.text === text.slice(n.start.offset, n.end.offset), "source leaf text mismatch");
    }
}
