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
 'lib/math.js':'\ufeffexport function add(a,b){ return a+b; }\r\nexport default function main(){return add(1,2);}\r\nexport const value=10; export class Thing {} export {value as "hyphen-name"};\r\nthrow "DO_NOT_EXECUTE";',
 'lib/other.js':'export const add=9; export const other=2; export default 3;',
 'lib/setup.js':'const ready=true; throw "DO_NOT_EXECUTE";',
 'barrels/direct.js':'export {add as sum, default as Main} from "../lib/math.js"; export * from "../lib/math.js";',
 'barrels/top.js':'export {sum as total,Main as Primary} from "./direct.js";',
 'conflict.js':'export * from "./lib/math.js"; export * from "./lib/other.js";',
 'same-origin.js':'export * from "./lib/math.js"; export * from "./barrels/direct.js";',
 'override.js':'export * from "./lib/math.js"; export * from "./lib/other.js"; export {add} from "./lib/math.js";',
 'namespace.js':'export * as toolkit from "./lib/math.js";',
 'cycles/a.js':'export * from "./b.js"; export const ax=1;',
 'cycles/b.js':'export * from "./a.js"; export const bx=2;',
 'cycles/left.js':'export {loop} from "./right.js";',
 'cycles/right.js':'export {loop} from "./left.js";',
 'consumer.jsx':'import Main,{add as sum,value,"hyphen-name" as hyphen} from "./lib/math.js"; import * as ns from "./lib/math.js"; import "./lib/setup.js"; import {} from "./lib/setup.js"; import {total} from "./barrels/top.js"; import {add as ambiguous} from "./conflict.js"; import {add as merged} from "./same-origin.js"; import {add as explicit} from "./override.js"; import {toolkit} from "./namespace.js"; import {bx} from "./cycles/a.js"; import {loop} from "./cycles/left.js"; import {missing} from "./lib/math.js"; import {own as ownStar, unknownFromStar} from "./missing-star.js"; import ghost from "./missing.js"; import external from "pkg"; import builtin from "node:fs"; import extensionless from "./lib/math"; import cjs from "./unknown.cjs"; const jsx=<Thing/>; import(variable); import("./lib/math.js"); require("./lib/math.js"); throw "DO_NOT_EXECUTE";',
 'local.js':'const local=1; export {local as alias}; export default local;',
 'anonymous.js':'export default function(){return 1;}',
 'anonymous-class.js':'export default class {};',
 'default-class.js':'export default class Named {}',
 'duplicates.js':'const a=1,b=2; export {a as same,b as same};',
 'duplicate-declaration.js':'export const repeated=1; export const repeated=2;',
 'missing-export.js':'export {notDeclared};',
 'destructure.js':'export const {x:aliasX,...rest}={x:1}; export let [first,second]=[1,2];',
 'unknown.cjs':'module.exports=require("./lib/math.js");',
 'mixed.js':'export const own=1; module . exports={own}; exports["other"]=own;',
 'copy-one.js':'export const shared=1;',
 'copy-two.js':'export const shared=1;',
 'Case.js':'export const Case=1;',
 'case.js':'export const lower=2;',
 'escaped.mjs':'import {add} from "./lib/m\\u0061th.js"; export {add};',
 'missing-star.js':'export * from "./missing.js"; export const own=1;',
 'broken.js':'export const valid=1; export function broken( {',
 'python.py':'def sample():\n    return 1\n',
};
const dir=new URL('./fixtures/',import.meta.url);fs.mkdirSync(dir,{recursive:true});
const files=Object.entries(sources).map(([relativePath,source])=>{const language=relativePath.endsWith('.py')?'Python':'JavaScript',parsed=composeParsers().manager.parse({projectId:p,relativePath,language,sourceCode:source});if(parsed.status==='failed')throw Error(parsed.code);const ast=new AstBuilder().build(parsed,{analysisId:a,language,contentHash:createHash('sha256').update(source).digest('hex'),createdAt:'2026-11-12T00:00:00.000Z'});return {relativePath,source,ast,reference:reference(ast)};});
const outcomes:AnalysisSummary['files']=files.map(f=>({relativePath:f.relativePath,status:f.ast.parseStatus==='success'?'parsed':'syntax_errors',artifact:f.reference}));outcomes.push({relativePath:'unsupported.ts',status:'unsupported',code:'UNSUPPORTED_LANGUAGE_OR_EXTENSION'});outcomes.sort((x,y)=>x.relativePath<y.relativePath?-1:1);const counts=emptyCounts();outcomes.forEach(f=>counts[f.status]++);
const source:AnalysisSummary={schemaVersion:1,projectId:p,analysisId:a,status:'completed_with_errors',startedAt:'2026-11-12T00:00:00.000Z',completedAt:'2026-11-12T00:00:01.000Z',counts,files:outcomes};fs.writeFileSync(new URL('.native.json',dir),JSON.stringify({source,files}));
const py=spawnSync(process.env.CODEATLAS_PYTHON_EXECUTABLE??'/home/dilawar-khan/codeatlaspythonbackend/.venv/bin/python',['-B',new URL('./generate-metadata.py',import.meta.url).pathname],{env:{...process.env,PYTHONPATH:process.env.CODEATLAS_PYTHON_REPOSITORY??'/home/dilawar-khan/codeatlaspythonbackend/codeatlas-backend',PYTHONDONTWRITEBYTECODE:'1'},encoding:'utf8'});if(py.status!==0)throw Error(py.stderr);
const produced=JSON.parse(fs.readFileSync(new URL('.metadata.json',dir),'utf8')) as {analysis:MetadataAnalysis;files:{relativePath:string;metadata:MetadataDocument;reference:MetadataReference}[]};validateMetadataAnalysis(produced.analysis);
const resolution:ResolutionAnalysis={schemaVersion:1,resolverVersion:RESOLVER_VERSION,projectId:p,analysisId:a,metadataAnalysisHash:digest(produced.analysis),sourceAnalysisHash:digest(source),extractionVersion:METADATA_VERSION,upstreamStatus:produced.analysis.status,upstreamDiagnostics:produced.analysis.diagnostics,status:'partial',startedAt:'2026-11-12T00:00:02.000Z',completedAt:'2026-11-12T00:00:03.000Z',files:[],counts:{complete:0,partial:0,unavailable:0,unsupported:0,failed:0}};
const inputFiles=source.files.map(outcome=>{const file=files.find(f=>f.relativePath===outcome.relativePath),metadata=produced.files.find(f=>f.relativePath===outcome.relativePath);let resolved=null;if(file&&metadata){validateMetadataDocument(metadata.metadata);validateMetadataReference(metadata.reference);resolved=new JavascriptResolver().resolve(file.ast,metadata.metadata,metadata.reference);}const status=resolved?.status??'unsupported';resolution.files.push({relativePath:outcome.relativePath,status,code:resolved?null:'UNSUPPORTED_LANGUAGE',artifact:resolved?resolutionReference(resolved):null,upstreamDiagnostics:[]});resolution.counts[status]++;return {relativePath:outcome.relativePath,ast:file?.ast??null,resolution:resolved,source:file&&file.ast.language==='JavaScript'&&!file.relativePath.endsWith('.cjs')?file.source:null,codes:[]};});validateResolutionAnalysis(resolution);
fs.writeFileSync(new URL('producer-input.json',dir),JSON.stringify({input:{source,resolution,files:inputFiles},metadataAnalysis:produced.analysis,metadataFiles:produced.files},null,2));fs.unlinkSync(new URL('.native.json',dir));fs.unlinkSync(new URL('.metadata.json',dir));console.log(JSON.stringify({files:outcomes.length,parser:'native tree-sitter',metadata:'actual Python JavaScriptExtractor',resolution:'actual JavascriptResolver',sourceExecuted:false}));
