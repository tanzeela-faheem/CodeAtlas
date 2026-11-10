// Read source as syntax only. Writes only this module's controlled fixtures.
import { writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { AstBuilder } from "../../ast-management/builder.js";
import { composeParsers } from "../../analysis/parser-composition.js";
const sources: Record<string, string> = {
    calls: `function greet() {} greet(); function recursive(n) { if(n) recursive(n - 1); } function outer() { function inner() { greet(); } inner(); return () => greet(); } { const greet = 10; greet(); } const callback = greet; callback(); const lambda = () => 1; lambda(); const value = 10; value(); unknown(); const obj = {}; obj.run(); obj[key](); greet?.(); const View = <Thing>{greet()}</Thing>; class Holder { method() { greet(); } }`,
    mutation: `function changed() {} changed = other; changed(); function stable() {} stable(); class C {} C = other; new C(); function closure() { changed = other; } let count = 0; count++; const read = count; count = read;`,
    constructors: `class Local {} new Local(); import Remote from 'pkg'; new Remote(); new Unknown(); const Alias = Local; new Alias(); const Factory = function() {}; new Factory(); new factories[key](); new (factory())(); function nested() { new Local(); } class Derived extends Local {} class Imported extends Remote {} class Dynamic extends factory() {} class UnknownBase extends Missing {} function outer() { class Nested extends Local {} return new Nested(); } const Expression = class Internal extends Local {};`,
    modules: `import main from './utils.js'; import {value, calculate as run} from 'pkg'; import * as ns from 'other'; import 'side-effect'; export {run as calculate, value}; export function local() {} export const number = 1; export default main; export {remote as renamed} from 'remote'; export * from 'star'; export * as namespace from 'namespace'; run(); main(); ns.member();`,
    containment: `class A { field = seed; constructor(p) { consume(p); } method(q) { function nested(r) { return q + r; } return nested(q); } } function one(x) { return x; } function two(x) { return x; }`,
    partial: `function good() { function independent() {} independent(); } good(); function broken( { const value = ; } missing();`,
    semantics: `function f() {} function body() { f(); } class C { field = f(); [f()]() {} static { f(); } } const object = { [f()]() { f(); } }; function defaults(p = f()) { return p; } const named = function internal() { internal(); };`,
    dynamic: `function f() {} ((eval))('f = other'); f();`,
    ambiguous: `let conflict; let conflict; conflict();`,
};
const dir = new URL('./fixtures/', import.meta.url); mkdirSync(dir, { recursive: true });
for (const [name, source] of Object.entries(sources)) {
    const parsed = composeParsers().manager.parse({ projectId: "PRJ-123ABC", relativePath: `${name}.jsx`, language: "JavaScript", sourceCode: source });
    if (parsed.status === "failed") throw new Error(parsed.code);
    const ast = new AstBuilder().build(parsed, { analysisId: "AN-00000000-0000-0000-0000-000000000001", language: "JavaScript", contentHash: createHash("sha256").update(source).digest("hex") });
    writeFileSync(new URL(`${name}.ast.json`, dir), JSON.stringify({ ...ast, createdAt: "2026-11-09T00:00:00.000Z" }));
    writeFileSync(new URL(`${name}.jsx`, dir), source);
}
