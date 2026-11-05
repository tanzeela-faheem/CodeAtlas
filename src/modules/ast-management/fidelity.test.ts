import { it, expect } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import type Parser from "tree-sitter";
import { composeParsers } from "../analysis/parser-composition.js";
import { AstBuilder } from "./builder.js";
import { serializeAst, deserializeAst, verifyAstSource } from "./serializer.js";
import { visitDepthFirst } from "./visitor.js";
import { AstQuery } from "./query.js";
const complex = `/** docs */\r\nimport main, { x as y } from 'pkg';\r\nexport class Example extends Base { static field = 1; #secret = 'é😀'; constructor(arg = 1, ...rest) { super(arg); } method({a}, [b]) { const arrow = (x) => x + 1; function nested() {} return function(v) { return <Thing value={arrow(v)} />; }; } }\r\nexport const answer = 42;`;
it.each([
    complex,
    "",
    " \r\n ",
    'let a=1;\nlet b="é😀";',
    "let n = ;",
    "function f() {",
    "const r = /a+/gi;",
    "const t = `hi ${name}`;"
])("preserves every native syntax property and exact source mapping: %s", (source) => {
    const result = composeParsers().manager.parse({
        projectId: "PRJ-123ABC",
        relativePath: "App.jsx",
        language: "JavaScript",
        sourceCode: source
    });
    if (result.status === "failed") throw new Error(result.code);
    const doc = new AstBuilder().build(result, {
        analysisId: `AN-${randomUUID()}`,
        language: "JavaScript",
        contentHash: createHash("sha256").update(source).digest("hex")
    });
    const native: { node: Parser.SyntaxNode; parent: Parser.SyntaxNode | null; field: string | null }[] = [];
    const stack = [
        { node: result.result.tree.rootNode, parent: null as Parser.SyntaxNode | null, field: null as string | null }
    ];
    while (stack.length) {
        const current = stack.pop()!;
        native.push(current);
        for (let i = current.node.childCount - 1; i >= 0; i--)
            stack.push({
                node: current.node.child(i)!,
                parent: current.node,
                field: current.node.fieldNameForChild(i) ?? null
            });
    }
    expect(doc.nodes).toHaveLength(native.length);
    const ids = new Map(native.map((n, i) => [n.node.id, `n${i}`]));
    native.forEach(({ node, parent, field }, i) => {
        const normalized = doc.nodes[i]!;
        expect(normalized).toMatchObject({
            type: node.type,
            parentId: parent ? ids.get(parent.id) : null,
            fieldName: field,
            children: node.children.map((child) => ids.get(child.id)),
            named: node.isNamed,
            error: node.isError,
            missing: node.isMissing,
            start: { offset: node.startIndex, ...node.startPosition },
            end: { offset: node.endIndex, ...node.endPosition }
        });
        if (!node.childCount) expect(normalized.text).toBe(node.text);
    });
    const stored = deserializeAst(serializeAst(doc));
    verifyAstSource(stored, source);
    expect(stored).toEqual(doc);
    const order: string[] = [];
    visitDepthFirst(stored, (n) => {
        order.push(n.id);
    });
    expect(order).toEqual(doc.nodes.map((n) => n.id));
    if (source === complex) {
        const query = new AstQuery(stored);
        for (const kind of [
            "class_declaration",
            "method_definition",
            "field_definition",
            "formal_parameters",
            "arrow_function",
            "function_expression",
            "import_statement",
            "export_statement",
            "jsx_attribute",
            "comment"
        ])
            expect(query.byType(kind).length).toBeGreaterThan(0);
    }
    if (source === "function f() {") expect(stored.nodes.some((n) => n.missing)).toBe(true);
});
it("rejects 600-level syntax normalization without retaining an unbounded normalized tree", () => {
    const source = "(".repeat(600) + "1" + ")".repeat(600) + ";";
    const result = composeParsers().manager.parse({
        projectId: "PRJ-123ABC",
        relativePath: "a.js",
        language: "JavaScript",
        sourceCode: source
    });
    if (result.status === "failed") throw new Error(result.code);
    expect(() =>
        new AstBuilder().build(result, {
            analysisId: `AN-${randomUUID()}`,
            language: "JavaScript",
            contentHash: createHash("sha256").update(source).digest("hex")
        })
    ).toThrow("AST_DEPTH_LIMIT");
});
