import { it, expect } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { ParserRegistry } from "./ParserRegistry.js";
import { ParserManager } from "./ParserManager.js";
import { JavascriptParser } from "../languages/JavascriptParser.js";
import { AstBuilder } from "../../ast-management/builder.js";
const request = { projectId: "PRJ-123ABC", relativePath: "a.js", language: "JavaScript", sourceCode: "const x=1;" };
it("rejects padded/duplicate IDs and snapshots mutable identity, capabilities and provenance without freezing parser state", () => {
    const registry = new ParserRegistry(),
        native = new JavascriptParser();
    const plugin = {
        id: "p",
        supportedLanguages: ["JavaScript"],
        supportedExtensions: ["js"],
        provenance: { parserVersion: "1", grammarVersion: "2" },
        calls: 0,
        parse(source: string) {
            this.calls++;
            return native.parse(source);
        }
    };
    expect(() => registry.register({ ...plugin, id: " p " })).toThrow("unpadded");
    registry.register(plugin);
    expect(() => registry.register(plugin)).toThrow("already registered");
    plugin.id = "changed";
    plugin.supportedLanguages[0] = "Python";
    plugin.supportedExtensions[0] = ".py";
    plugin.provenance.grammarVersion = "changed";
    expect(registry.findCandidates("JavaScript", ".js")).toHaveLength(1);
    expect(registry.findCandidates("Python", ".py")).toHaveLength(0);
    const registered = registry.getById("p")!;
    expect(Reflect.set(registered, "id", "other")).toBe(false);
    expect(Reflect.set(registered.supportedLanguages, "0", "Python")).toBe(false);
    const outcome = new ParserManager(registry).parse({ ...request, preferredParserId: "p" });
    expect(outcome).toMatchObject({
        status: "success",
        parserId: "p",
        provenance: { parserVersion: "1", grammarVersion: "2" }
    });
    expect(plugin.calls).toBe(1);
    expect(Object.isFrozen(plugin)).toBe(false);
});
it("records the actual selected parser provenance, preserves ambiguity/preferences and uses explicit unknown versions", () => {
    const native = new JavascriptParser(),
        registry = new ParserRegistry();
    for (const [id, parserVersion, grammarVersion] of [
        ["alpha", "1.0", "grammar-a"],
        ["beta", "2.0", "grammar-b"]
    ] as const)
        registry.register({
            id,
            supportedLanguages: ["JavaScript"],
            supportedExtensions: [".js"],
            provenance: { parserVersion, grammarVersion },
            parse: (source) => native.parse(source)
        });
    const manager = new ParserManager(registry);
    expect(manager.parse(request)).toMatchObject({ code: "AMBIGUOUS_PARSER" });
    for (const [preferredParserId, expected] of [
        ["alpha", "grammar-a"],
        ["beta", "grammar-b"]
    ]) {
        const parsed = manager.parse({ ...request, preferredParserId: preferredParserId! });
        if (parsed.status === "failed") throw new Error(parsed.code);
        const ast = new AstBuilder().build(parsed, {
            analysisId: `AN-${randomUUID()}`,
            language: "JavaScript",
            contentHash: createHash("sha256").update(request.sourceCode).digest("hex"),
            grammarVersion: "wrong-context-version"
        });
        expect(ast.grammarVersion).toBe(expected);
        expect(ast.parserId).toBe(preferredParserId);
    }
    const unknown = new ParserRegistry();
    unknown.register({
        id: "unknown",
        supportedLanguages: ["JavaScript"],
        supportedExtensions: [".js"],
        parse: (source) => native.parse(source)
    });
    const result = new ParserManager(unknown).parse(request);
    expect(result).toMatchObject({ provenance: { parserVersion: null, grammarVersion: null } });
    if (result.status === "failed") throw new Error(result.code);
    const ast = new AstBuilder().build(result, {
        analysisId: `AN-${randomUUID()}`,
        language: "JavaScript",
        contentHash: createHash("sha256").update(request.sourceCode).digest("hex"),
        grammarVersion: "must-not-invent"
    });
    expect(ast.grammarVersion).toBeNull();
    expect(ast.parserVersion).toBeNull();
});
