// Run from repository root using Node 22 + tsx. Writes only this task's fixtures.
import { writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { composeParsers } from "../../analysis/parser-composition.js";
import { AstBuilder } from "../../ast-management/builder.js";
const sources: Record<string, string> = {
    scope_rules: `function outer(p) { { var kept = p; let hidden = kept; hidden; } function nested(q) { return kept + q; } return nested(kept); } class Decl extends Base { [key](p) { return Decl + p; } field = Decl; static { var only = 1; only; } } Decl; only; function repeated(p) { var p; var x; function x() {} return p + x; } let a = 0, b = 0; ({a, b = a} = source);`,
    lexical: `const outer = 1; function f(p) { var x = p; { let outer = x; const y = outer; y; } return outer + x; } f(outer);`,
    patterns: `const source = {}; const {a: local = source, [source]: key, ...rest} = source; const [first, second = local] = rest; function f({x = first}, [y], ...args) { return x + y + args.length; }`,
    environments: `const outside = 1; const f = function inner(a = outside, b = a) { var outside = b; return inner(a); }; const C = class Inside { method(p) { return Inside; } }; try { throw outside; } catch ({message: error}) { error; } inner; Inside;`,
    references: `let value = 1; const obj = {value, key: value, [value]: value}; obj.key; obj[value]; value = obj; value++; label: while (value) { break label; } const view = <Thing prop={value}>{obj.key}</Thing>;`,
    imports: `import main, {calculate as runCalc, plain} from './math.js'; import * as ns from 'pkg'; export {runCalc as run}; export {remote as renamed} from 'pkg'; export * from 'other'; export * as group from 'pkg'; export default function execute(p) { return runCalc(main(p)) + plain + ns.x; }`,
    temporal: `x; var x = 1; y; let y = y; const [first = 1, second = first] = []; const closure = () => later; const later = 2; function f(a = hidden) { let hidden = a; return hidden; }`,
    duplicates: `var a; var a; let b; let b; function f(a) { let a; return a; } { const b = 1; b; } b;`,
    dynamic: `let local = 1; function f() { ((eval))('var x = 2'); return local + x; }`,
    errors: `function good(p) { return p; } function broken( { const x = ; } good(1);`,
    arrows: `const arguments = 1; function f() { const g = () => arguments; return g(); } const h = () => arguments;`,
    loops: `let x = 1; for (let i = 0; i < x; i++) { i; } i; for (const item of [x]) { item; }`,
};
const dir = new URL('./fixtures/', import.meta.url); mkdirSync(dir, { recursive: true });
for (const [name, source] of Object.entries(sources)) {
    const parsed = composeParsers().manager.parse({ projectId: "PRJ-123ABC", relativePath: `${name}.jsx`, language: "JavaScript", sourceCode: source });
    if (parsed.status === "failed") throw new Error(parsed.code);
    const ast = new AstBuilder().build(parsed, { analysisId: "AN-00000000-0000-0000-0000-000000000001", language: "JavaScript", contentHash: createHash("sha256").update(source).digest("hex") });
    writeFileSync(new URL(`${name}.ast.json`, dir), JSON.stringify({ ...ast, createdAt: "2026-11-09T00:00:00.000Z" }));
    writeFileSync(new URL(`${name}.jsx`, dir), source);
}
