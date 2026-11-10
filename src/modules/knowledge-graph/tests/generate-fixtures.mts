// Controlled syntax only; no imported source is executed.
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { AstBuilder } from '../../ast-management/builder.js';
import { composeParsers } from '../../analysis/parser-composition.js';
const sources={rich:`function target() {} function recursive() { recursive(); } function caller() { target(); target(); function nested() { target(); } nested(); } caller(); class Base {} class Derived extends Base { field = target(); constructor(p) { target(); } method(p) { return p; } static { target(); } } new Derived(); let value = 1; value++; try { throw 1; } catch (error) { console.log(error); } import remote from './same.jsx'; remote(); export { target };`,same:`function target() {} function outer() { function target() {} target(); } target();`};
for(const [name,source] of Object.entries(sources)){
 const parsed=composeParsers().manager.parse({projectId:'PRJ-123ABC',relativePath:name+'.jsx',language:'JavaScript',sourceCode:source});if(parsed.status==='failed')throw new Error(parsed.code);
 const ast=new AstBuilder().build(parsed,{analysisId:'AN-00000000-0000-0000-0000-000000000001',language:'JavaScript',contentHash:createHash('sha256').update(source).digest('hex')});
 writeFileSync(new URL(`./fixtures/${name}.jsx`,import.meta.url),source);writeFileSync(new URL(`./fixtures/${name}.ast.json`,import.meta.url),JSON.stringify({...ast,createdAt:'2026-11-09T00:00:00.000Z'}));
}
