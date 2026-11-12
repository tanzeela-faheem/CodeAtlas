import { canonical,digest } from '../symbol-resolution/integration/contracts.js';
import { CONTEXT_VERSION,ContextError,type AIContextPackage,type ContextRequest,type ContextCoverage,type ContextProvenance,type Evidence,type EvidenceKind } from './model.js';
export const contextIdentity=(value:Omit<AIContextPackage,'contextId'>)=>'ctx-'+digest([CONTEXT_VERSION,value]);
/** Fixed-point accounting includes the envelope and numeric totals themselves. */
export function finalize(value:AIContextPackage):AIContextPackage{
 let previous='';for(let i=0;i<12;i++){const text=canonical(value),next={characters:text.length,bytes:Buffer.byteLength(text),evidenceRecords:value.evidence.length,sourceExcerpts:value.evidence.filter(e=>e.kind==='source_excerpt').length,documentationRecords:value.evidence.filter(e=>e.kind==='documentation').length};const key=canonical(next);value.totals=next;if(key===previous){const {contextId:_,...body}=value;value.contextId=contextIdentity(body);return value;}previous=key;}
 throw new ContextError('CONTEXT_ACCOUNTING_FAILED',500);
}
export function buildContext(projectId:string,analysisId:string,request:ContextRequest,provenance:ContextProvenance,candidates:Evidence[],rawCoverage:ContextCoverage):AIContextPackage{
 const coverage=JSON.parse(canonical(rawCoverage)) as ContextCoverage,byKind:AIContextPackage['counts']['byKind']=Object.create(null);
 for(const e of candidates){const count=byKind[e.kind]??{retrieved:0,selected:0,omitted:0};count.retrieved++;byKind[e.kind]=count;}
 const result:AIContextPackage={schemaVersion:1,engineVersion:CONTEXT_VERSION,contextId:'ctx-'+'0'.repeat(64),projectId,analysisId,request,provenance,status:'partial',evidence:[],coverage,counts:{retrieved:candidates.length,selected:0,omitted:candidates.length,byKind},totals:{characters:0,bytes:0,evidenceRecords:0,sourceExcerpts:0,documentationRecords:0}};
 const fits=()=>{finalize(result);return result.totals.characters<=request.budget.maxCharacters&&result.totals.bytes<=request.budget.maxBytes;};
 while(!fits()&&coverage.graph.files.length){coverage.graph.files.pop();coverage.graph.fileDetailsOmitted++;}
 if(!fits())throw new ContextError('CONTEXT_ENVELOPE_EXCEEDS_BUDGET',413);
 const omitted=new Map<EvidenceKind,number>();
 for(const item of candidates){let eligible=result.evidence.length<request.budget.maxEvidence;if(item.kind==='source_excerpt')eligible=eligible&&result.evidence.filter(e=>e.kind==='source_excerpt').length<request.retrieval.maxSnippets;if(item.kind==='documentation')eligible=eligible&&result.evidence.filter(e=>e.kind==='documentation').length<request.retrieval.maxDocumentation;
 if(eligible){result.evidence.push(JSON.parse(canonical(item)) as Evidence);byKind[item.kind]!.selected++;result.counts.selected++;result.counts.omitted--;if(fits())continue;result.evidence.pop();byKind[item.kind]!.selected--;result.counts.selected--;result.counts.omitted++;}
 omitted.set(item.kind,(omitted.get(item.kind)??0)+1);
 }
 for(const [kind,count] of omitted)coverage.omissions.push({code:'CONTEXT_SELECTION_BUDGET',kind,count});
 for(const count of Object.values(byKind))count.omitted=count.retrieved-count.selected;
 if(!result.evidence.length)coverage.diagnostics.push('NO_EVIDENCE_SELECTED');
 const partial=coverage.graph.evidenceCoverage!=='supported_subset'||coverage.omissions.length>0||coverage.traversal.truncated||coverage.search.truncated||coverage.sources.some(s=>s.status!=='verified_current')||!result.evidence.length||coverage.graph.fileDetailsOmitted>0;
 result.status=partial?'partial':'complete';coverage.diagnostics=[...new Set(coverage.diagnostics)].sort();
 // Reserve/report omissions may grow the envelope. Drop the lowest-ranked item,
 // preserving exact whole evidence records and recalculating all counters.
 while(!fits()&&result.evidence.length){const item=result.evidence.pop()!;byKind[item.kind]!.selected--;byKind[item.kind]!.omitted++;result.counts.selected--;result.counts.omitted++;let omission=coverage.omissions.find(o=>o.code==='CONTEXT_SELECTION_BUDGET'&&o.kind===item.kind);if(!omission){omission={code:'CONTEXT_SELECTION_BUDGET',kind:item.kind,count:0};coverage.omissions.push(omission);}omission.count++;result.status='partial';}
 if(!fits())throw new ContextError('CONTEXT_ENVELOPE_EXCEEDS_BUDGET',413);return result;
}
