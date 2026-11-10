import { describe, expect, it } from "vitest";
import { composeParsers } from "../../analysis/parser-composition.js";
import { AstBuilder } from "../../ast-management/builder.js";
import { serializeAst } from "../../ast-management/serializer.js";
import { JavascriptResolver } from "../languages/javascript.js";
import { validateResolutionDocument } from "../validation.js";
import { evidence } from "./test-helpers.js";
const resolve = (name: string) => { const e = evidence(name); const doc = new JavascriptResolver().resolve(e.ast, e.metadata, e.reference); validateResolutionDocument(doc); return doc; };
describe("JavaScript lexical resolver with producer-generated metadata", () => {
    it.each(["scope_rules", "lexical", "patterns", "environments", "references", "imports", "temporal", "duplicates", "dynamic", "errors", "arrows", "loops"])("resolves bounded native AST + producer evidence: %s", name => {
        const e = evidence(name), doc = resolve(name);
        const parsed = composeParsers().manager.parse({ projectId: e.ast.projectId, relativePath: e.ast.relativePath, language: e.ast.language, sourceCode: requireSource(name) });
        if (parsed.status === "failed") throw new Error(parsed.code);
        const native = new AstBuilder().build(parsed, { analysisId: e.ast.analysisId, language: e.ast.language, contentHash: e.ast.contentHash });
        expect(serializeAst({ ...native, createdAt: e.ast.createdAt })).toBe(serializeAst(e.ast));
        expect(doc).toEqual(resolve(name));
        expect(doc.symbols.every(s => s.id !== s.bindingNodeId && s.declarations.every(d => d.metadataEntityId !== s.id))).toBe(true);
    });
    it("models nesting, block shadowing, parameters, var scope and closure lookup", () => {
        const d = resolve("lexical"), outer = d.symbols.filter(s => s.name === "outer"), x = d.symbols.find(s => s.name === "x")!;
        expect(outer).toHaveLength(2); expect(outer[0]!.scopeId).not.toBe(outer[1]!.scopeId);
        expect(d.scopes.find(s => s.id === x.scopeId)?.kind).toBe("function");
        expect(d.references.filter(r => r.name === "outer").map(r => r.symbolId)).toContain(outer[1]!.id);
        expect(d.references.every(r => r.status === "resolved")).toBe(true);
        expect(d.references.find(r => r.name === "p")?.symbolId).toBe(d.symbols.find(s => s.name === "p")!.id);
    });
    it("handles nested functions, class declaration scopes, static var isolation and destructuring writes", () => {
        const d = resolve("scope_rules"), kept = d.symbols.find(s => s.name === "kept")!;
        expect(d.scopes.find(s => s.id === kept.scopeId)!.kind).toBe("function");
        expect(d.references.filter(r => r.name === "kept").every(r => r.symbolId === kept.id)).toBe(true);
        expect(d.references.filter(r => r.name === "only").map(r => r.status)).toEqual(["resolved", "unresolved"]);
        expect(d.references.filter(r => r.name === "Decl").every(r => r.status === "resolved")).toBe(true);
        expect(d.references.filter(r => r.name === "Decl").every(r => r.initialization === "runtime_unknown")).toBe(true);
        expect(d.references.filter(r => ["a", "b"].includes(r.name) && r.usage === "write")).toHaveLength(2);
        expect(d.references.find(r => r.name === "a" && r.usage === "read")).toBeDefined();
        expect(d.symbols.find(s => s.name === "x")!.declarations).toHaveLength(2);
        expect(d.references.filter(r => ["Base", "key", "source"].includes(r.name)).every(r => r.status === "unresolved")).toBe(true);
    });
    it("extracts only destructuring binding positions and resolves defaults/computed keys", () => {
        const d = resolve("patterns");
        expect(d.symbols.map(s => s.name)).toEqual(["source", "local", "key", "rest", "first", "second", "f", "x", "y", "args"]);
        expect(d.references.some(r => r.name === "a")).toBe(false);
        expect(d.references.filter(r => r.name === "source")).toHaveLength(3);
        expect(d.references.every(r => r.status === "resolved")).toBe(true);
        expect(d.symbols.find(s => s.name === "x")!.declarations[0]!.metadataEntityId).toMatch(/^meta-/);
    });
    it("isolates default-parameter environments and internal function/class names; supports catch AST evidence", () => {
        const d = resolve("environments");
        for (const name of ["inner", "Inside"]) expect(d.references.filter(r => r.name === name).map(r => r.status)).toEqual(["resolved", "unresolved"]);
        const outside = d.symbols.find(s => s.name === "outside" && s.kind === "const")!;
        expect(d.references.find(r => r.name === "outside")!.symbolId).toBe(outside.id);
        const caught = d.symbols.find(s => s.name === "error")!;
        expect(caught.kind).toBe("catch"); expect(caught.declarations[0]!.metadataEntityId).toBeNull();
        expect(d.references.find(r => r.name === "error")!.symbolId).toBe(caught.id);
    });
    it("excludes property names, labels and JSX tags while retaining shorthand/computed/JSX expressions", () => {
        const d = resolve("references");
        expect(d.references.some(r => ["key", "label", "Thing", "prop"].includes(r.name))).toBe(false);
        expect(d.references.some(r => r.name === "value" && r.usage === "write")).toBe(true);
        expect(d.references.some(r => r.usage === "read_write")).toBe(true);
        expect(d.references.filter(r => r.name === "value").length).toBeGreaterThan(5);
        expect(d.diagnostics.some(d => d.code === "JSX_TAGS_DEFERRED")).toBe(true);
    });
    it("resolves local import aliases and exports without claiming remote targets", () => {
        const d = resolve("imports"), run = d.symbols.find(s => s.name === "runCalc")!;
        expect(run.import).toEqual({ importedName: "calculate", moduleSpecifier: "./math.js", targetStatus: "deferred" });
        expect(d.references.find(r => r.usage === "export")?.symbolId).toBe(run.id);
        expect(d.references.some(r => ["calculate", "run", "remote", "renamed", "execute", "group"].includes(r.name))).toBe(false);
        expect(d.symbols.filter(s => s.kind === "import")).toHaveLength(4);
        expect(d.diagnostics.some(d => d.code === "MODULE_TARGET_DEFERRED")).toBe(true);
    });
    it("separates lexical lookup, source-order TDZ evidence and unknown closure initialization", () => {
        const d = resolve("temporal");
        expect(d.references.find(r => r.name === "x")!.initialization).toBe("not_applicable");
        expect(d.references.filter(r => r.name === "y").every(r => r.status === "resolved" && r.initialization === "before_initialization")).toBe(true);
        expect(d.references.find(r => r.name === "first")!.initialization).toBe("runtime_unknown");
        expect(d.references.find(r => r.name === "later")!.initialization).toBe("runtime_unknown");
        expect(d.references.find(r => r.name === "hidden")!.status).toBe("unresolved");
    });
    it("merges repeated var, preserves duplicate ambiguity and refuses lexical early-error conflicts", () => {
        const d = resolve("duplicates");
        const a = d.symbols.find(s => s.name === "a" && s.kind === "var")!;
        expect(a.declarations).toHaveLength(2);
        expect(d.references.find(r => r.name === "b" && r.status === "ambiguous")!.candidates).toHaveLength(2);
        expect(d.references.find(r => r.name === "a")!.status).toBe("unsupported");
    });
    it("keeps dynamic semantics and implicit arguments explicit, including arrow inheritance", () => {
        expect(resolve("dynamic").references.every(r => r.status === "unsupported")).toBe(true);
        const d = resolve("arrows");
        expect(d.references.filter(r => r.name === "arguments").map(r => r.status)).toEqual(["unsupported", "resolved"]);
    });
    it("resolves independent valid functions in malformed source and preserves upstream diagnostics", () => {
        const d = resolve("errors");
        expect(d.status).toBe("partial"); expect(d.astDiagnostics.length).toBeGreaterThan(0); expect(d.metadataDiagnostics.length).toBeGreaterThan(0);
        expect(d.references.find(r => r.name === "p")!.status).toBe("resolved"); expect(d.references.some(r => r.status === "invalid")).toBe(true);
    });
    it("bounds ordinary loop lexical scope and blocks unsupported producer-omitted for-of bindings", () => {
        const d = resolve("loops");
        expect(d.references.filter(r => r.name === "i").map(r => r.status)).toEqual(["resolved", "resolved", "resolved", "unresolved"]);
        expect(d.references.filter(r => r.name === "item").every(r => r.status === "unsupported")).toBe(true);
    });
});
import { readFileSync } from "node:fs";
function requireSource(name: string): string { return readFileSync(new URL(`./fixtures/${name}.jsx`, import.meta.url), "utf8"); }
