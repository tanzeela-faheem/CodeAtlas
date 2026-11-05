import { it, expect } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { AstBuilder } from "./builder.js";
import { validateAst, serializeAst, deserializeAst, verifyAstSource, MAX_AST_BYTES } from "./serializer.js";
import type { AstDocument, AstNode } from "./model.js";
import { composeParsers } from "../analysis/parser-composition.js";
import { AstQuery } from "./query.js";
import { visitDepthFirst } from "./visitor.js";

function build(source = 'function name(a){ return "é😀" + a; }\r\n') {
    const outcome = composeParsers().manager.parse({
        projectId: "PRJ-123ABC",
        relativePath: "a.js",
        language: "JavaScript",
        sourceCode: source
    });
    if (outcome.status === "failed") throw new Error(outcome.code);
    return new AstBuilder().build(outcome, {
        analysisId: `AN-${randomUUID()}`,
        language: "JavaScript",
        contentHash: createHash("sha256").update(source).digest("hex")
    });
}
function node(doc: AstDocument, update: (n: AstNode) => unknown) {
    const index = doc.nodes.findIndex((n) => n.type === "identifier");
    return { ...doc, nodes: doc.nodes.map((n, i) => (i === index ? update(n) : n)) };
}
const cases: [string, (d: AstDocument) => unknown][] = [
    [
        "child points outside parent",
        (d) => node(d, (n) => ({ ...n, start: { ...n.start, row: 99999 }, end: { ...n.end, row: 99999 } }))
    ],
    ["malformed analysis ID", (d) => ({ ...d, analysisId: `AN-${"-".repeat(36)}` })],
    ["array hash", (d) => ({ ...d, contentHash: [d.contentHash] })],
    ["leaf span/text mismatch", (d) => node(d, (n) => ({ ...n, text: "DIFFERENT" }))],
    ["boolean scalar as string", (d) => node(d, (n) => ({ ...n, named: "true" }))],
    ["fractional offset", (d) => node(d, (n) => ({ ...n, start: { ...n.start, offset: 0.5 } }))],
    ["negative row", (d) => node(d, (n) => ({ ...n, start: { ...n.start, row: -1 } }))],
    [
        "same row offset/column disagreement",
        (d) => node(d, (n) => ({ ...n, end: { ...n.end, column: n.end.column + 1 } }))
    ],
    ["wrong parent", (d) => node(d, (n) => ({ ...n, parentId: "n999999" }))],
    [
        "cycle",
        (d) => ({ ...d, nodes: d.nodes.map((n, i) => (i === 0 ? { ...n, children: [...n.children, d.rootId] } : n)) })
    ],
    ["duplicate ID", (d) => ({ ...d, nodes: [...d.nodes, d.nodes[0]] })],
    ["unsupported schema", (d) => ({ ...d, schemaVersion: 2 })],
    ["unknown normalization policy", (d) => ({ ...d, normalizationVersion: "invented" })],
    ["undefined optional", (d) => ({ ...d, normalizationVersion: undefined })],
    ["unsupported extra fields", (d) => ({ ...d, native: {} })],
    ["non-leaf text", (d) => ({ ...d, nodes: d.nodes.map((n, i) => (i === 0 ? { ...n, text: "x" } : n)) })],
    ["too many nodes", (d) => ({ ...d, nodes: Array(100001).fill(d.nodes[0]) })],
    ["oversized text", (d) => node(d, (n) => ({ ...n, text: "x".repeat(MAX_AST_BYTES + 1) }))]
];
it.each(cases)("rejects F01 invalid data: %s", (_name, change) => {
    const value = change(build());
    expect(() => validateAst(value)).toThrow("Invalid");
});
it("rejects missing, foreign, duplicate and inconsistent diagnostic locations", () => {
    const d = build("function f() {");
    expect(d.diagnostics.length).toBeGreaterThan(0);
    for (const diagnostics of [
        [],
        [{ ...d.diagnostics[0], nodeId: "n99999" }],
        [...d.diagnostics, d.diagnostics[0]],
        d.diagnostics.map((x) => ({ ...x, start: { ...x.start, row: x.start.row + 1 } }))
    ]) {
        expect(() => validateAst({ ...d, diagnostics })).toThrow("Invalid");
    }
});
it("rejects malformed JSON and checks exact text against hash-verified source separately", () => {
    expect(() => deserializeAst("{bad")).toThrow("Invalid");
    const source = 'function name(a){ return "é😀" + a; }\r\n',
        d = build(source);
    verifyAstSource(d, Buffer.from(source));
    expect(() => verifyAstSource(d, source + " ")).toThrow("hash mismatch");
    const sameLength = node(d, (n) => ({ ...n, text: "fake" })) as AstDocument;
    validateAst(sameLength); // Length alone cannot authenticate characters.
    expect(() => verifyAstSource(sameLength, source)).toThrow("leaf text mismatch");
    expect(deserializeAst(serializeAst(d))).toEqual(d);
    for (const text of ["", " \r\n ", 'const x = "é😀";\r\nconst y=1;', "export default <X a={1}/>;"]) {
        // The selected JavaScript grammar accepts JSX even with a .js suffix.
        const document = build(text);
        verifyAstSource(deserializeAst(serializeAst(document)), text);
    }
});
it("exposes immutable snapshots without copying each query", () => {
    const d = build();
    const query = new AstQuery(d);
    const first = query.byId(d.rootId)!;
    expect(Object.isFrozen(d)).toBe(true);
    expect(Object.isFrozen(first.children)).toBe(true);
    expect(Reflect.set(first, "id", "other")).toBe(false);
    expect(query.byId(d.rootId)).toBe(first);
    const mutable = JSON.parse(serializeAst(d)) as AstDocument;
    const q = new AstQuery(mutable);
    expect(Object.isFrozen(mutable)).toBe(true);
    const order: string[] = [];
    visitDepthFirst(mutable, (n) => {
        expect(Reflect.set(n.start, "row", 100)).toBe(false);
        order.push(n.id);
    });
    expect(order).toEqual(d.nodes.map((n) => n.id));
    expect(q.byId(d.rootId)?.id).toBe(d.rootId);
});
