import {it,expect} from 'vitest';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {canonical,digest} from '../integration/contracts.js';
// Frozen pre-stabilization implementation: compatibility oracle for persisted
// hashes, deliberately retaining the old allocation-heavy code-point arrays.
function legacyCanonical(value:unknown,ascii=false):string{
 const sort=(x:unknown):unknown=>Array.isArray(x)?x.map(sort):x!==null&&typeof x==='object'?Object.fromEntries(Object.entries(x).sort(([a],[b])=>{const aa=Array.from(a,c=>c.codePointAt(0)!),bb=Array.from(b,c=>c.codePointAt(0)!);for(let i=0;i<Math.min(aa.length,bb.length);i++)if(aa[i]!==bb[i])return aa[i]!-bb[i]!;return aa.length-bb.length;}).map(([k,v])=>[k,sort(v)])):x;
 const text=JSON.stringify(sort(value));return ascii?text.replace(/[\u007f-\uffff]/g,c=>`\\u${c.charCodeAt(0).toString(16).padStart(4,'0')}`):text;
}
function compatible(value:unknown){for(const ascii of [false,true]){const expected=legacyCanonical(value,ascii);expect(canonical(value,ascii)).toBe(expected);expect(digest(value,ascii)).toBe(createHash('sha256').update(expected).digest('hex'));}}
it('retains Unicode code-point ordering rather than UTF-16 ordering',()=>{const value=Object.fromEntries([['\u{10000}',1],['\ue000',2],['😀',3],['a😀x',4],['a\uffff',5],['a',6],['',7],['\ud800',8],['\udc00',9],['a😀',10]]);compatible(value);expect(canonical({'\u{10000}':1,'\ue000':2})).toBe('{"\ue000":2,"𐀀":1}');});
it('preserves integer-like keys, special property names, arrays and nullable/omitted JSON values',()=>{compatible(Object.fromEntries([['__proto__',{constructor:1}],['constructor',[undefined,null,NaN,Infinity,-0]],['10',{z:undefined,a:'é😀'}],['2',false],['01',true],['a\0b','\r\n\ufeff']]));});
it('matches legacy bytes and digests across a deterministic mixed-Unicode key corpus',()=>{const units=['a','ab','b','0','10','é','e\u0301','\ue000','\uffff','\u{10000}','😀','\ud800','\udc00','\0','"','\\',''];let state=0x51a7;const pick=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return units[state%units.length]!;};for(let i=0;i<128;i++){const entries:Array<[string,unknown]>=[];for(let j=0;j<24;j++)entries.push([pick()+pick()+pick(),{[pick()]:[pick(),null,i,j],nested:{[pick()]:j}}]);compatible(Object.fromEntries(entries));}});
it.each(['notes.ast.json','notes.metadata.json','notes.resolution.json'])('preserves authenticated producer fixture canonicalization: %s',name=>{compatible(JSON.parse(fs.readFileSync(new URL('../../ai-context/tests/fixtures/'+name,import.meta.url),'utf8')));});
it('preserves existing invalid JSON input failure behavior',()=>{const circular:Record<string,unknown>={};circular.self=circular;expect(()=>canonical(circular)).toThrow();expect(()=>canonical({value:1n})).toThrow();});
