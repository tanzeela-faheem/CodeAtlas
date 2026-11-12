import { canonical,digest } from '../symbol-resolution/integration/contracts.js';
import { CONTEXT_VERSION,type ContextRequest,type ContextProvenance,type DraftEvidence,type Evidence,type EvidenceKind,type Omission,type Navigation } from './model.js';
export const blankNavigation=():Navigation=>({relativePath:null,range:null,contentHash:null,metadataEntityId:null,moduleId:null,astArtifactId:null,astNodeId:null,symbolId:null,graphNodeId:null,graphEdgeId:null,relationshipId:null,metadataArtifactId:null,resolutionArtifactId:null,relationshipArtifactId:null,searchDocumentId:null,searchMatchId:null});
export const evidenceIdentity=(e:Omit<Evidence,'evidenceId'>)=>'ev-'+digest([CONTEXT_VERSION,e]);
export class EvidenceCollection {
 private readonly records=new Map<string,DraftEvidence>();
 readonly omissions:Omission[]=[];
 private omitCounts=new Map<string,Omission>();
 constructor(readonly request:ContextRequest){}
 omit(code:string,kind:EvidenceKind|null,count=1){if(!count)return;const key=code+':'+kind,old=this.omitCounts.get(key);if(old)old.count+=count;else {const item={code,kind,count};this.omitCounts.set(key,item);this.omissions.push(item);}}
 add(record:DraftEvidence){
 const key=canonical([record.kind,record.producer.identity,record.navigation.relativePath,record.navigation.range,record.classification]);const existing=this.records.get(key);
 if(existing){const {ranking:_,...a}=existing,{ranking:__,...b}=record;if(digest(a)!==digest(b))throw new Error('Conflicting producer evidence');existing.ranking={score:Math.max(existing.ranking.score,record.ranking.score),reasons:[...new Set([...existing.ranking.reasons,...record.ranking.reasons])].sort()};return;}
 if(this.records.size>=this.request.retrieval.maxRetrievedRecords){this.omit('RETRIEVAL_RECORD_LIMIT',record.kind);return;}
 if(Buffer.byteLength(canonical(record))>this.request.budget.maxItemBytes){this.omit('EVIDENCE_ITEM_LIMIT',record.kind);return;}
 this.records.set(key,JSON.parse(canonical(record)) as DraftEvidence);
 }
 seal(projectId:string,analysisId:string,provenance:ContextProvenance):Evidence[]{const provenanceId=digest(provenance);return [...this.records.values()].map(record=>{const item={...record,projectId,analysisId,provenanceId};return {...item,evidenceId:evidenceIdentity(item)};}).filter(item=>{if(Buffer.byteLength(canonical(item))<=this.request.budget.maxItemBytes)return true;this.omit('EVIDENCE_ITEM_LIMIT',item.kind);return false;}).sort((a,b)=>b.ranking.score-a.ranking.score||(a.evidenceId<b.evidenceId?-1:1));}
}
