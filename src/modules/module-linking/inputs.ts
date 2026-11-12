import path from 'node:path';
import * as v from '../../shared/validation.js';
import type {ProjectStore} from '../respository/services/project-store.js';
import {validateProjectState} from '../respository/services/project-validation.js';
import type {AnalysisStore} from '../analysis/summary-store.js';
import {validateAnalysisSummary} from '../analysis/summary-validation.js';
import type {AstStore} from '../ast-management/store.js';
import {validateAst,verifyAstSource} from '../ast-management/serializer.js';
import {validateAstReference,artifactId,legacyArtifactId} from '../ast-management/identity.js';
import type {ResolutionStore} from '../symbol-resolution/storage.js';
import {validateResolutionAnalysis,validateResolutionDocument,resolutionId} from '../symbol-resolution/validation.js';
import {canonical,digest} from '../symbol-resolution/integration/contracts.js';
import type {SourceReader} from '../analysis/source-reader.js';
import {ModuleError,LIMITS,bound,checkpoint,terminal,type ModuleInput,type Limits,type InputFile} from './model.js';
export interface InputStores{projects:ProjectStore;source:AnalysisStore;asts:AstStore;resolution:ResolutionStore;reader:Pick<SourceReader,'read'>}
export async function loadInputs(stores:InputStores,project:string,analysis:string,deadline:number,signal?:AbortSignal):Promise<ModuleInput>{
 const state=await stores.projects.get(project);validateProjectState(state,project);v.check(state.result.status==='imported','module imported project');
 const source=await stores.source.get(project,analysis);validateAnalysisSummary(source,project,analysis);if(!terminal(source.status))throw new ModuleError('MODULE_SOURCE_NOT_COMPLETE',409);
 let resolution;try{resolution=await(stores.resolution.getAnalysisManifest?.(project,analysis)??stores.resolution.getAnalysis(project,analysis));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')throw new ModuleError('MODULE_RESOLUTION_MISSING',424);throw e;}
 validateResolutionAnalysis(resolution);v.check(resolution.projectId===project&&resolution.analysisId===analysis&&['complete','partial'].includes(resolution.status),'module resolution ownership/state');
 const input:ModuleInput={source,resolution,files:[]};const sourceHash=digest(source);v.check(resolution.sourceAnalysisHash===sourceHash,'module resolution source snapshot');
 let bytes=Buffer.byteLength(canonical([source,resolution])),sourceBytes=0;bound(source.files.length<=LIMITS.maxModules);
 for(const outcome of [...source.files].sort((a,b)=>a.relativePath<b.relativePath?-1:1)){
  checkpoint(deadline,signal);const file:InputFile={relativePath:outcome.relativePath,ast:null,resolution:null,source:null,codes:[]};
  if(outcome.artifact){try{file.ast=await stores.asts.get(project,analysis,outcome.artifact.artifactId,outcome.artifact.contentHash);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')file.codes.push('AST_FILE_MISSING');else throw e;}}
  if(file.ast){const upstream=resolution.files.find(f=>f.relativePath===file.relativePath);if(upstream?.artifact){file.resolution=await stores.resolution.getFile(project,analysis,upstream.artifact.artifactId);}
   if(file.ast.language==='JavaScript'&&['.js','.jsx','.mjs'].includes(path.posix.extname(file.relativePath))){const read=await stores.reader.read(project,{absolutePath:'',relativePath:file.relativePath,extension:path.posix.extname(file.relativePath),language:file.ast.language,linesOfCode:0,isGenerated:false,contentHash:file.ast.contentHash},analysis);
    if(read.status==='read'){v.check(read.relativePath===file.relativePath&&read.analysisId===analysis&&read.contentHash===file.ast.contentHash,'module source reader identity');verifyAstSource(file.ast,read.sourceCode);file.source=read.sourceCode;sourceBytes+=Buffer.byteLength(read.sourceCode);bound(sourceBytes<=LIMITS.maxSourceBytes);}else file.codes.push(read.code);
   }
  }
  bytes+=Buffer.byteLength(canonical(file));bound(bytes<=LIMITS.maxInputBytes);input.files.push(file);
 }
 validateInputs(input,LIMITS);return input;
}
export function validateInputs(input:ModuleInput,limits:Limits){
 v.object(input,'module inputs',['source','resolution','files']);validateAnalysisSummary(input.source);v.check(terminal(input.source.status),'module terminal source');const {projectId:p,analysisId:a}=input.source;validateResolutionAnalysis(input.resolution);v.check(input.resolution.projectId===p&&input.resolution.analysisId===a&&['complete','partial'].includes(input.resolution.status)&&input.resolution.sourceAnalysisHash===digest(input.source),'module resolution manifest');
 bound(Array.isArray(input.files)&&input.files.length<=limits.maxModules);v.array(input.files,'module input files',limits.maxModules);v.check(input.files.length===input.source.files.length,'module inventory count');const seen=new Set<string>();let sourceBytes=0;
 for(const file of input.files){v.object(file,'module input file',['relativePath','ast','resolution','source','codes']);v.sourcePath(file.relativePath);v.check(!seen.has(file.relativePath),'duplicate module path');seen.add(file.relativePath);const outcome=input.source.files.find(f=>f.relativePath===file.relativePath);v.check(outcome,'module inventory membership');v.array(file.codes,'module input codes',16);for(const code of file.codes){v.string(code,'code');v.check(/^[A-Z][A-Z0-9_]*$/.test(code),'input code');}
  if(file.ast){validateAst(file.ast);bound(file.ast.nodes.length<=limits.maxNodesPerFile);v.check(outcome.artifact,'module AST manifest reference');const ref=outcome.artifact;validateAstReference(ref,p,a,file.relativePath);v.check([artifactId(file.ast),legacyArtifactId(file.ast)].includes(ref.artifactId)&&file.ast.projectId===p&&file.ast.analysisId===a&&file.ast.relativePath===file.relativePath&&file.ast.contentHash===ref.contentHash,'module AST identity');v.check((outcome.status==='parsed'&&file.ast.parseStatus==='success')||(outcome.status==='syntax_errors'&&file.ast.parseStatus==='syntax_errors'),'module AST outcome');
   if(file.source!==null){v.string(file.source,'module retained source',true,2000000);verifyAstSource(file.ast,file.source);sourceBytes+=Buffer.byteLength(file.source);}
   if(file.resolution){validateResolutionDocument(file.resolution);const doc=file.resolution,r=input.resolution.files.find(f=>f.relativePath===file.relativePath)?.artifact;v.check(r&&r.artifactId===resolutionId(doc)&&r.documentHash===digest(doc)&&doc.astArtifactId===ref.artifactId,'module lexical artifact identity');for(const k of ['projectId','analysisId','relativePath','language','parserId','parserVersion','grammarVersion','contentHash','coordinates','rootId','parseStatus'] as const)v.check(doc.sourceAst[k]===file.ast[k],'module lexical AST provenance');v.check((doc.sourceAst.normalizationVersion??'syntax-preorder-v1')===(file.ast.normalizationVersion??'syntax-preorder-v1'),'module normalization');
    const nodes=new Map(file.ast.nodes.map(n=>[n.id,n]));for(const symbol of doc.symbols){const node=nodes.get(symbol.bindingNodeId);v.check(node&&node.text===symbol.name,'module lexical binding AST');for(const d of symbol.declarations){const declaration=nodes.get(d.astNodeId);v.check(declaration&&digest(d.range)===digest({start:declaration.start,end:declaration.end}),'module declaration AST range');}}for(const reference of doc.references){const node=nodes.get(reference.astNodeId);v.check(node&&node.text===reference.name&&digest(reference.range)===digest({start:node.start,end:node.end}),'module reference AST');}
   }
  }else v.check(file.source===null&&file.resolution===null,'module evidence without AST');
 }
 bound(sourceBytes<=limits.maxSourceBytes&&Buffer.byteLength(canonical(input))<=limits.maxInputBytes);
}
