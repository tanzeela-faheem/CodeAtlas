import { it, expect } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { composeParsers } from "../analysis/parser-composition.js";
import { AstBuilder } from "./builder.js";
import { serializeAst, deserializeAst } from "./serializer.js";
import { AstQuery } from "./query.js";
import { visitDepthFirst } from "./visitor.js";
import { FileAstStore } from "./store.js";
import { WorkspaceManagerService } from "../respository/services/workspace-manager.service.js";
import { fixture } from "../../test/fixtures.js";
const analysisId = `AN-${randomUUID()}`;
function build(source: string, relativePath = "app.js") {
    const outcome = composeParsers().manager.parse({
        projectId: "PRJ-123ABC",
        relativePath,
        language: "JavaScript",
        sourceCode: source
    });
    if (outcome.status === "failed") throw new Error(outcome.message);
    return new AstBuilder().build(outcome, {
        analysisId,
        language: "JavaScript",
        contentHash: createHash("sha256").update(source).digest("hex"),
        createdAt: "2026-11-05T00:00:00.000Z"
    });
}
it.each([
    "",
    "let x = 1;",
    'const s = "é😀";\r\nconsole.log(s);',
    "function outer(){ function inner(){return 1;} return inner(); }",
    "export class A { method(){return 1;} }",
    'import x from "x"; export default x;',
    "export default <h1>😀</h1>;",
    "const = ;",
    "function f( {"
])("normalizes real native syntax and locations: %s", (source) => {
    const doc = build(source, source.includes("<h1>") ? "app.jsx" : "app.js");
    expect(deserializeAst(serializeAst(doc))).toEqual(doc);
    expect(serializeAst(build(source, doc.relativePath))).toBe(serializeAst(doc));
    const query = new AstQuery(doc);
    expect(new Set(doc.nodes.map((n) => n.id)).size).toBe(doc.nodes.length);
    const position = (offset: number) => {
        const prefix = source.slice(0, offset).split("\n");
        return { offset, row: prefix.length - 1, column: prefix.at(-1)!.length };
    };
    for (const node of doc.nodes) {
        expect(node.start).toEqual(position(node.start.offset));
        expect(node.end).toEqual(position(node.end.offset));
        if (node.text !== undefined) expect(node.text).toBe(source.slice(node.start.offset, node.end.offset));
        for (const child of query.children(node.id)) expect(child.parentId).toBe(node.id);
    }
    if (source.includes("const =") || source === "function f( {") expect(doc.parseStatus).toBe("syntax_errors");
    if (doc.parseStatus === "syntax_errors") expect(doc.diagnostics.length).toBeGreaterThan(0);
});
it("queries fields, ancestors, ranges and deterministic traversal with early stop", () => {
    const doc = build("function outer(a) { return a + 1; }");
    const query = new AstQuery(doc);
    const name = query.matching((n) => n.fieldName === "name")[0]!;
    expect(name.text).toBe("outer");
    expect(query.ancestors(name.id).at(-1)?.id).toBe(doc.rootId);
    expect(query.byType("function_declaration")).toHaveLength(1);
    expect(query.within(name.start.offset, name.end.offset)).toContain(name);
    expect(query.byId("absent")).toBeUndefined();
    expect(query.children("absent")).toEqual([]);
    expect(query.ancestors("absent")).toEqual([]);
    const order: string[] = [];
    visitDepthFirst(doc, (n) => {
        order.push(n.id);
    });
    expect(order).toEqual(doc.nodes.map((n) => n.id));
    let count = 0;
    visitDepthFirst(
        doc,
        () => {
            count++;
            return false;
        },
        (n) => n.named
    );
    expect(count).toBe(1);
    const invalid = {
        ...doc,
        nodes: doc.nodes.map((n, i) => (i === 0 ? { ...n, children: [...n.children, doc.rootId] } : n))
    };
    expect(() => serializeAst(invalid)).toThrow();
    expect(() => deserializeAst("{}")).toThrow();
    const outcome = composeParsers().manager.parse({
        projectId: doc.projectId,
        relativePath: "a.js",
        language: "JavaScript",
        sourceCode: "let x = 1;"
    });
    if (outcome.status !== "failed")
        expect(() =>
            new AstBuilder(1).build(outcome, { analysisId, language: "JavaScript", contentHash: doc.contentHash })
        ).toThrow("LIMIT");
});
it("persists independently of native tree and validates incompatible/corrupt artifacts", async () => {
    const f = await fixture();
    try {
        const workspaces = new WorkspaceManagerService(f.storage);
        await workspaces.createWorkspace("PRJ-123ABC");
        const doc = build("const x = 1;");
        const reference = await new FileAstStore(workspaces).save(doc);
        const store = new FileAstStore(new WorkspaceManagerService(f.storage));
        expect(await store.get(doc.projectId, analysisId, reference.artifactId)).toEqual(doc);
        expect(await store.list(doc.projectId, analysisId)).toEqual([reference]);
        await expect(store.get(doc.projectId, analysisId, reference.artifactId, "different")).rejects.toThrow(
            "mismatch"
        );
        await expect(store.get(doc.projectId, analysisId, "a".repeat(64))).rejects.toThrow();
        await fs.writeFile(
            path.join(f.storage, doc.projectId, "analysis", analysisId, `${reference.artifactId}.ast.json`),
            JSON.stringify({ ...doc, schemaVersion: 2 })
        );
        await expect(store.get(doc.projectId, analysisId, reference.artifactId)).rejects.toThrow("incompatible");
    } finally {
        await f.cleanup();
    }
});
