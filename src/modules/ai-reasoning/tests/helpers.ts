import type {AIContextPackage} from '../../ai-context/model.js';
import type {LLMProvider,ModelAnswer,ProviderInput} from '../model.js';
import {reasoningConfig} from '../config.js';
export const config=()=>reasoningConfig({CODEATLAS_AI_ENABLED:'true',CODEATLAS_AI_MODEL:'gpt-4.1-mini',OPENAI_API_KEY:'test-only-placeholder'});
export function validAnswer(context:AIContextPackage):ModelAnswer {
 const e=context.evidence.find(e=>e.kind==='metadata_entity')??context.evidence[0]!;
 return {schemaVersion:1,status:'answered',claims:[{claimId:'c1',text:'The selected record provides syntactic evidence.',evidenceIds:[e.evidenceId],qualification:'interpretation',classifications:[e.classification],fact:null}],limitations:[],unansweredAspects:[]};
}
export function mockProvider(hook?:(input:ProviderInput)=>void):LLMProvider {
 return {provider:'openai',model:'gpt-4.1-mini',async generate(input,signal){hook?.(input);if(signal.aborted)throw Error('aborted');const data=JSON.parse(input.data),records=data.context.repositoryEvidence.records;const e=records.find((e:any)=>e.kind==='metadata_entity')??records[0];return {refused:false,text:JSON.stringify({schemaVersion:1,status:'answered',claims:[{claimId:'c1',text:'The selected record provides syntactic evidence.',evidenceIds:[e.referenceId],qualification:'interpretation',classifications:[e.classification],fact:null}],limitations:[],unansweredAspects:[]}),usage:{inputTokens:40,outputTokens:25}};}};
}
