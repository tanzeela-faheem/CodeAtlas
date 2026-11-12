import path from 'node:path';
import {digest} from '../symbol-resolution/integration/contracts.js';
import * as v from '../../shared/validation.js';
import type { SourceReader } from '../analysis/source-reader.js';
import { verifyAstSource } from '../ast-management/serializer.js';
import type { Range } from '../symbol-resolution/model.js';
import { sourceRange,lineStarts } from '../search-engine/advanced/positions.js';
import { ContextError,checkpoint,type ContextRequest,type ContextCoverage } from './model.js';
import type { ContextInputs } from './inputs.js';
export function clippedPrefix(text:string,length:number){let end=Math.min(text.length,length);if(end<text.length&&end>0&&/[\uD800-\uDBFF]/.test(text[end-1]!)&&/[\uDC00-\uDFFF]/.test(text[end]!))end--;return text.slice(0,end);}
export function relativeRange(text:string,origin:Range['start']):Range{let row=origin.row,column=origin.column;for(let i=0;i<text.length;i++){if(text[i]==='\n'){row++;column=0;}else column++;}return {start:origin,end:{offset:origin.offset+text.length,row,column}};}
export class CodeSnippetRetriever {
 private cache=new Map<string,Promise<{text:string|null;status:'verified_current'|'historical'|'unavailable'|'unsupported';code:string|null}>>();
 readonly coverage:ContextCoverage['sources']=[];
 constructor(private readonly inputs:ContextInputs,private readonly reader:Pick<SourceReader,'read'>,private readonly request:ContextRequest){}
 private async read(relativePath:string){const {graph}=this.inputs.data,file=graph.evidence.files.find(f=>f.ast.relativePath===relativePath),ref=graph.evidence.source.files.find(f=>f.relativePath===relativePath)?.artifact;
 if(!file||!ref){const outcome={relativePath,text:null,status:(graph.evidence.source.files.find(f=>f.relativePath===relativePath)?.status==='unsupported'?'unsupported':'unavailable') as 'unsupported'|'unavailable',code:ref?'SOURCE_AST_EVIDENCE_UNAVAILABLE':'SOURCE_SNAPSHOT_UNAVAILABLE'};this.coverage.push({relativePath,status:outcome.status,code:outcome.code});return outcome;}
 checkpoint(this.inputs.deadline,this.inputs.signal);
 const read=await this.reader.read(graph.snapshot.projectId,{absolutePath:'',relativePath,extension:path.posix.extname(relativePath),language:'JavaScript',linesOfCode:0,isGenerated:false,contentHash:ref.contentHash},graph.snapshot.analysisId);
 if(read.status==='read'){v.check(read.relativePath===relativePath&&read.analysisId===graph.snapshot.analysisId&&read.contentHash===ref.contentHash,'context source read identity');verifyAstSource(file.ast,read.sourceCode);this.inputs.account(read.sourceCode);this.coverage.push({relativePath,status:'verified_current',code:null});return {text:read.sourceCode,status:'verified_current' as const,code:null};}
 if(this.request.sourcePolicy==='allow_historical'){const index=await this.inputs.historical();const source=index?.sources.find(s=>s.relativePath===relativePath);if(source){v.check(source.contentHash===ref.contentHash&&source.astArtifactId===ref.artifactId,'context historical source');verifyAstSource(file.ast,source.text);this.coverage.push({relativePath,status:'historical',code:read.code});return {text:source.text,status:'historical' as const,code:read.code};}}
 this.coverage.push({relativePath,status:'unavailable',code:read.code});return {text:null,status:'unavailable' as const,code:read.code};}
 async get(relativePath:string){let promise=this.cache.get(relativePath);if(!promise){promise=this.read(relativePath);this.cache.set(relativePath,promise);}return promise;}
 async range(relativePath:string,range:Range){const source=await this.get(relativePath);if(source.text===null)throw new ContextError('CONTEXT_FOCUS_RANGE_UNAVAILABLE',424);v.check(range.end.offset<=source.text.length&&digest(sourceRange(lineStarts(source.text),range.start.offset,range.end.offset))===digest(range),'context focused source range');return source;}
 async excerpt(relativePath:string,range:Range){const source=await this.get(relativePath);if(source.text===null)return null;v.check(range.end.offset<=source.text.length&&digest(sourceRange(lineStarts(source.text),range.start.offset,range.end.offset))===digest(range),'context excerpt range');const text=clippedPrefix(source.text.slice(range.start.offset,range.end.offset),this.request.budget.maxSnippetCharacters);return {text,range:relativeRange(text,range.start),originalRange:range,truncated:text.length<range.end.offset-range.start.offset,availability:source.status};}
}
