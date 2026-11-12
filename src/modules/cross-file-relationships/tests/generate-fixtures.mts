import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {composeParsers} from '../../analysis/parser-composition.js';
import {AstBuilder} from '../../ast-management/builder.js';
import {reference} from '../../ast-management/identity.js';
import {JavascriptResolver} from '../../symbol-resolution/languages/javascript.js';
import {validateMetadataAnalysis,validateMetadataDocument,validateMetadataReference,digest} from '../../symbol-resolution/integration/contracts.js';
import {validateResolutionAnalysis,resolutionReference} from '../../symbol-resolution/validation.js';
import {emptyCounts,type AnalysisSummary} from '../../analysis/model.js';
import {RESOLVER_VERSION,METADATA_VERSION,type ResolutionAnalysis,type MetadataAnalysis,type MetadataDocument,type MetadataReference} from '../../symbol-resolution/model.js';
const p='PRJ-123ABC',a='AN-00000000-0000-0000-0000-000000000001';
const sources:Record<string,string>={
 "core.js": "﻿export function add(a,b){return a+b;}\r\nexport class Tool {}\r\nexport const value=1; export const {x:item,...rest}={x:2}; export {add as alias,value as \"hyphen-name\"}; export default function run(){return 1;}\r\nconst banner=\"😀\"; export const café=1; throw \"DO_NOT_EXECUTE\"; export {value as \"\\\\u0061dd\"};",
 "multi-declaration.js": "var repeated=1; var repeated=2; export {repeated};",
 "other.js": "export function add(){return 2;}",
 "barrel.js": "export {add as process,default as Main} from \"./core.js\"; export {add} from \"./core.js\";",
 "barrel2.js": "export {process as execute,Main} from \"./barrel.js\";",
 "local.js": "import {add as process} from \"./core.js\"; import * as math from \"./core.js\"; export {process as execute, math as nsLocal}; export default process;",
 "local2.js": "import {execute as go} from \"./local.js\"; export {go as final};",
 "star-local.js": "export * from \"./local2.js\";",
 "conflict.js": "export * from \"./core.js\"; export * from \"./other.js\";",
 "override.js": "export * from \"./core.js\"; export * from \"./other.js\"; export {add} from \"./core.js\";",
 "diamond.js": "export * from \"./core.js\"; export * from \"./barrel.js\";",
 "namespace-export.js": "export * as toolkit from \"./core.js\";",
 "namespace.js": "import * as math from \"./core.js\"; import * as conflict from \"./conflict.js\"; import {toolkit} from \"./namespace-export.js\"; import {nsLocal} from \"./local.js\"; math.add(1,2); math[\"add\"](); math[\"\\u0061dd\"](); math[key](); math.missing; math.add.name; math?.add; math.add=1; delete math.add; (math.add)=1; [math.add]=[]; function shadow(math){return math.add();} const other=math; other.add(); const {add:local}=math; const obj={add(){}}; obj.add(); conflict.add(); toolkit.add(); nsLocal.add(); math[\"default\"](); math.\\u0061dd;",
 "anonymous.js": "export default function(){return 1;}",
 "anonymous-class.js": "export default class {};",
 "expression.js": "function makeService(){} export default makeService();",
 "default-class.js": "export default class Named {}",
 "consumer.jsx": "const marker=\"😀\"; import {café} from \"./core.js\"; café; import missingDefault from \"./star-local.js\"; import {repeated} from \"./multi-declaration.js\"; missingDefault(); repeated; import Run,{add as sum,Tool,value,item,alias,\"hyphen-name\" as hyphen} from \"./core.js\"; import {add as other} from \"./other.js\"; import {execute as barrel} from \"./barrel2.js\"; import {final as viaLocal} from \"./star-local.js\"; import {add as ambiguous} from \"./conflict.js\"; import {add as explicit} from \"./override.js\"; import {add as diamond} from \"./diamond.js\"; import anonymous from \"./anonymous.js\"; import anonymousClass from \"./anonymous-class.js\"; import expression from \"./expression.js\"; import Named from \"./default-class.js\"; import {b} from \"./cycle-a.js\"; import {loop} from \"./local-cycle-a.js\"; import {add as cyclicAmbiguous} from \"./amb-cycle-a.js\"; import missing from \"./missing.js\"; import external from \"pkg\"; sum(1,2); sum(3,4); Run(); new Tool(); value; item; alias(); other(); barrel(); viaLocal(); ambiguous(); explicit(); diamond(); anonymous(); new anonymousClass(); expression(); new Named(); b; loop(); cyclicAmbiguous(); missing(); external(); hyphen; function shadow(sum){return sum(5,6);} {let sum=()=>0;sum();} try {throw 1;} catch(sum){sum();} function outer(){function nested(){return sum(7,8);} return nested();} function local(){const sum=1;return sum;} unknownName(); const view=<Thing/>; throw \"DO_NOT_EXECUTE\";",
 "cycle-a.js": "export * from \"./cycle-b.js\"; export const a=1;",
 "cycle-b.js": "export * from \"./cycle-a.js\"; export const b=2;",
 "local-cycle-a.js": "import {loop} from \"./local-cycle-b.js\"; export {loop};",
 "local-cycle-b.js": "import {loop} from \"./local-cycle-a.js\"; export {loop};",
 "amb-cycle-a.js": "export * from \"./amb-cycle-b.js\"; export * from \"./other.js\";",
 "amb-cycle-b.js": "export * from \"./amb-cycle-a.js\"; export * from \"./core.js\";",
 "duplicate.js": "const a=1,b=2; export {a as same,b as same};",
 "write.js": "import {add} from \"./core.js\"; add=1; add++;",
 "dynamic.js": "import {add} from \"./core.js\"; eval(\"unknown\"); add();",
 "missing-export.js": "export {notDeclared};",
 "broken.js": "export function broken( {",
 "setup.js": "throw \"DO_NOT_EXECUTE\";",
 "function-values.js": "export const arrow=()=>1; export let value=1; export default ()=>1;",
 "mutated.js": "export function changed(){} changed=unknownValue;",
 "unknown-write.js": "export function risky(){} unknown=1;",
 "callers.js": "import {add} from \"./core.js\"; add(1,2); function outer(){ function inner(){return add(3,4);} return inner();} const arrow=()=>add(5,6); const expression=function localName(){return add(7,8);}; const anonymous=function(){return add(9,10);}; class Local { method(){return add(11,12);} [add(13,14)](){return add(15,16);} field=add(17,18); static{add(19,20);} } function defaults(p=add(21,22)){return p;} throw \"DO_NOT_EXECUTE\";",
 "second.js": "import {add as sum} from \"./core.js\"; sum(1,2); sum(3,4); import {register} from \"./register.js\"; register(sum);",
 "unsupported-operations.js": "import {add} from \"./core.js\"; (add)(); (0,add)(); add?.(); add`tag`; const fn=add; fn(); register(add); function returns(){return add;} add; import(\"./core.js\"); require(variable);",
 "namespace-calls.js": "import * as math from \"./core.js\"; import * as anon from \"./anonymous.js\"; import * as expression from \"./expression.js\"; import * as values from \"./function-values.js\"; math.add(); math[\"add\"](); math[\"\\u0061dd\"](); math.default(); math[key](); math.add.call(null); const fn=math.add; fn(); const alias=math; alias.add(); math.add?.(); math?.add(); math.Tool(); math.value(); anon.default(); expression.default(); values.arrow();",
 "dependencies.js": "import Run,{add as first,value as val} from \"./core.js\"; import {add as second} from \"./core.js\"; import * as ns from \"./core.js\"; import \"./setup.js\"; import \"./setup.js\"; import \"./dependencies.js\"; import bare from \"pkg\"; import ext from \"./core\"; import ghost from \"./missing.js\"; export {add as forwarded} from \"./core.js\"; export * from \"./core.js\"; export * as toolkit from \"./core.js\"; export function own(){} import {own as self} from \"./dependencies.js\"; self();",
 "origins.js": "import {changed} from \"./mutated.js\"; import {risky} from \"./unknown-write.js\"; import Arrow,{arrow,value} from \"./function-values.js\"; import Tool from \"./anonymous-class.js\"; import * as namespace from \"./core.js\"; changed(); risky(); arrow(); value(); Arrow(); Tool(); new Tool(); namespace();",
 "broken-caller.js": "import {add} from \"./core.js\"; function broken( { add();",
 "unicode.js": "﻿const banner=\"😀\"; export function café(){return 1;}\r\nthrow \"DO_NOT_EXECUTE\";",
 "unicode-consumer.js": "﻿const marker=\"😀\"; import {café} from \"./unicode.js\";\r\nfunction caller(){return café();}\r\ncafé();",
 "namespace-broken.js": "export * as broken from \"./broken.js\";",
 "register.js": "export function register(callback){return callback;}"
};
if(process.env.CODEATLAS_FIXTURE_SET==='storage'){
 for(const key of Object.keys(sources))delete sources[key];
 Object.assign(sources,{'core.js':'\ufeffexport function add(){return 1;}\r\nthrow "DO_NOT_EXECUTE";','consumer.jsx':'import {add as sum} from "./core.js"; sum(); function caller(){return sum();}','second.js':'import {add} from "./core.js"; add();'});
}
const dir=new URL('./fixtures/',import.meta.url);fs.mkdirSync(dir,{recursive:true});
const files=Object.entries(sources).map(([relativePath,source])=>{const language=relativePath.endsWith('.py')?'Python':'JavaScript',parsed=composeParsers().manager.parse({projectId:p,relativePath,language,sourceCode:source});if(parsed.status==='failed')throw Error(parsed.code);const ast=new AstBuilder().build(parsed,{analysisId:a,language,contentHash:createHash('sha256').update(source).digest('hex'),createdAt:'2026-11-12T00:00:00.000Z'});return {relativePath,source,ast,reference:reference(ast)};});
const outcomes:AnalysisSummary['files']=files.map(f=>({relativePath:f.relativePath,status:f.ast.parseStatus==='success'?'parsed':'syntax_errors',artifact:f.reference}));outcomes.push({relativePath:'unsupported.ts',status:'unsupported',code:'UNSUPPORTED_LANGUAGE_OR_EXTENSION'});outcomes.sort((x,y)=>x.relativePath<y.relativePath?-1:1);const counts=emptyCounts();outcomes.forEach(f=>counts[f.status]++);
const source:AnalysisSummary={schemaVersion:1,projectId:p,analysisId:a,status:counts.syntax_errors?'completed_with_errors':'completed',startedAt:'2026-11-12T00:00:00.000Z',completedAt:'2026-11-12T00:00:01.000Z',counts,files:outcomes};fs.writeFileSync(new URL('.native.json',dir),JSON.stringify({source,files}));
const py=spawnSync(process.env.CODEATLAS_PYTHON_EXECUTABLE??'/home/dilawar-khan/codeatlaspythonbackend/.venv/bin/python',['-B',new URL('./generate-metadata.py',import.meta.url).pathname],{env:{...process.env,PYTHONPATH:process.env.CODEATLAS_PYTHON_REPOSITORY??'/home/dilawar-khan/codeatlaspythonbackend/codeatlas-backend',PYTHONDONTWRITEBYTECODE:'1'},encoding:'utf8'});if(py.status!==0)throw Error(py.stderr);
const produced=JSON.parse(fs.readFileSync(new URL('.metadata.json',dir),'utf8')) as {analysis:MetadataAnalysis;files:{relativePath:string;metadata:MetadataDocument;reference:MetadataReference}[]};validateMetadataAnalysis(produced.analysis);
const resolution:ResolutionAnalysis={schemaVersion:1,resolverVersion:RESOLVER_VERSION,projectId:p,analysisId:a,metadataAnalysisHash:digest(produced.analysis),sourceAnalysisHash:digest(source),extractionVersion:METADATA_VERSION,upstreamStatus:produced.analysis.status,upstreamDiagnostics:produced.analysis.diagnostics,status:'partial',startedAt:'2026-11-12T00:00:02.000Z',completedAt:'2026-11-12T00:00:03.000Z',files:[],counts:{complete:0,partial:0,unavailable:0,unsupported:0,failed:0}};
const inputFiles=source.files.map(outcome=>{const file=files.find(f=>f.relativePath===outcome.relativePath),metadata=produced.files.find(f=>f.relativePath===outcome.relativePath);let resolved=null;if(file&&metadata){validateMetadataDocument(metadata.metadata);validateMetadataReference(metadata.reference);resolved=new JavascriptResolver().resolve(file.ast,metadata.metadata,metadata.reference);}const status=resolved?.status??'unsupported';resolution.files.push({relativePath:outcome.relativePath,status,code:resolved?null:'UNSUPPORTED_LANGUAGE',artifact:resolved?resolutionReference(resolved):null,upstreamDiagnostics:[]});resolution.counts[status]++;return {relativePath:outcome.relativePath,ast:file?.ast??null,resolution:resolved,source:file&&file.ast.language==='JavaScript'&&!file.relativePath.endsWith('.cjs')?file.source:null,codes:[]};});validateResolutionAnalysis(resolution);
fs.writeFileSync(new URL(process.env.CODEATLAS_FIXTURE_SET==='storage'?'storage-input.json':'producer-input.json',dir),JSON.stringify({input:{source,resolution,files:inputFiles},metadataAnalysis:produced.analysis,metadataFiles:produced.files},null,2));fs.unlinkSync(new URL('.native.json',dir));fs.unlinkSync(new URL('.metadata.json',dir));console.log(JSON.stringify({files:outcomes.length,parser:'native tree-sitter',metadata:'actual Python JavaScriptExtractor',resolution:'actual JavascriptResolver',sourceExecuted:false}));
