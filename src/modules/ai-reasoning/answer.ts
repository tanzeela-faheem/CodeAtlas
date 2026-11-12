import * as v from '../../shared/validation.js';
import {canonical} from '../symbol-resolution/integration/contracts.js';
import type {AIContextPackage,Evidence} from '../ai-context/model.js';
import {ReasoningError,type ModelAnswer,type Claim} from './model.js';
const fail=()=>{throw new ReasoningError('AI_ANSWER_INVALID',502);};
function texts(raw:unknown,label:string,max:number,length=1000):asserts raw is string[]{v.array(raw,label,max);for(const value of raw){v.string(value,label,false,length);v.check(value.trim().length>0,label);safeNarrative(value);}v.check(new Set(raw).size===raw.length,'duplicates');}
function safeNarrative(text:string){v.check(!/(?:https?:\/\/|file:\/\/|\]\(|`|(?:\/(?:home|Users|root|tmp|etc|var|opt)\/)|[A-Za-z]:\\)/i.test(text),'unsafe narrative reference');}
function checkFact(claim:Claim,evidence:Evidence[]){
 const raw=claim.fact;
 if(raw===null){v.check(claim.qualification!=='producer_fact','fact required');return;}
 v.check(claim.qualification==='producer_fact','fact qualification');
 const f=v.object(raw,'fact',['type'],['entityId','graphEdgeId','sourceGraphNodeId','targetGraphNodeId','edgeKind','guarantee','relativePath','startOffset','endOffset','contentHash']);
 if(f.type==='entity'){v.object(f,'entity fact',['type','entityId']);v.check(evidence.some(e=>e.kind==='metadata_entity'&&e.navigation.metadataEntityId===f.entityId&&e.producer.identity===f.entityId),'entity fact');}
 else if(f.type==='edge'){v.object(f,'edge fact',['type','graphEdgeId','sourceGraphNodeId','targetGraphNodeId','edgeKind','guarantee']);v.check(evidence.some(e=>{if(e.kind!=='established_relationship'||e.classification==='uncertain')return false;const c=e.content as Record<string,unknown>;return ['graphEdgeId','sourceGraphNodeId','targetGraphNodeId','edgeKind','guarantee'].every(k=>f[k]===c[k])&&f.guarantee===e.classification;}),'edge fact');}
 else if(f.type==='source'){v.object(f,'source fact',['type','relativePath','startOffset','endOffset','contentHash']);v.check(evidence.some(e=>e.kind==='source_excerpt'&&e.navigation.relativePath===f.relativePath&&e.navigation.range?.start.offset===f.startOffset&&e.navigation.range?.end.offset===f.endOffset&&e.navigation.contentHash===f.contentHash),'source fact');}
 else v.check(false,'fact type');
}
export function parseAnswer(text:string,context:AIContextPackage):ModelAnswer {
 try {
  v.check(Buffer.byteLength(text)<=65536,'answer bytes');const raw:unknown=JSON.parse(text),o=v.object(raw,'answer',['schemaVersion','status','claims','limitations','unansweredAspects']);v.check(o.schemaVersion===1,'schema');v.member(o.status,['answered','partially_answered','insufficient_evidence','refused'],'status');v.array(o.claims,'claims',24);texts(o.limitations,'limitations',16);texts(o.unansweredAspects,'unanswered aspects',16);
  const selected=new Map(context.evidence.map(e=>[e.evidenceId,e]));const ids=new Set<string>(),claims=new Set<string>();
  for(const value of o.claims){const c=v.object(value,'claim',['claimId','text','evidenceIds','qualification','classifications','fact']);v.string(c.claimId,'claimId',false,16);v.check(/^c[1-9][0-9]*$/.test(c.claimId)&&!ids.has(c.claimId),'unique claim');ids.add(c.claimId);v.string(c.text,'claim text',false,2000);v.check(c.text.trim().length>0,'empty claim');safeNarrative(c.text);texts(c.evidenceIds,'citations',12,100);v.check(c.evidenceIds.length>0,'citations required');v.member(c.qualification,['interpretation','producer_fact','uncertain'],'qualification');texts(c.classifications,'classifications',10,64);
   const evidence=c.evidenceIds.map(id=>{const e=selected.get(id);v.check(e,'selected citation');return e;});const classes=[...new Set(evidence.map(e=>e.classification))].sort();v.check(canonical([...c.classifications].sort())===canonical(classes),'classification fidelity');if(classes.includes('uncertain'))v.check(c.qualification==='uncertain'&&c.fact===null,'candidate qualification');checkFact(value as Claim,evidence);const signature=canonical([c.text,[...c.evidenceIds].sort(),c.qualification,c.fact]);v.check(!claims.has(signature),'duplicate claim content');claims.add(signature);
  }
  if(o.status==='answered')v.check(o.claims.length>0&&o.unansweredAspects.length===0,'answered status');
  else if(o.status==='partially_answered')v.check(o.claims.length>0&&o.limitations.length>0&&o.unansweredAspects.length>0,'partial status');
  else v.check(o.claims.length===0&&o.limitations.length>0,'nonanswer status');
  return raw as ModelAnswer;
 }catch{ return fail(); }
}
