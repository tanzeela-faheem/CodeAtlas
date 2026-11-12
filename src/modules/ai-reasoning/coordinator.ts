import * as v from '../../shared/validation.js';
import {AIContextCoordinator} from '../ai-context/coordinator.js';
import {parseReasoningRequest} from './request.js';
import {assessEvidence} from './sufficiency.js';
import {buildPrompt} from './prompt.js';
import {parseAnswer} from './answer.js';
import {reasoningConfig,requireProvider} from './config.js';
import {OpenAIProvider} from './openai-provider.js';
import {REASONING_VERSION,ReasoningError,type LLMProvider,type ModelAnswer,type ReasoningResponse,type ReasoningConfig,type ProviderResult} from './model.js';
export class ReasoningCoordinator {
 private active=0;
 constructor(private readonly context:Pick<AIContextCoordinator,'create'>,private readonly configure:()=>ReasoningConfig=reasoningConfig,private readonly makeProvider:(c:ReasoningConfig)=>LLMProvider=c=>new OpenAIProvider(c)){}
 async answer(project:string,analysis:string,raw:unknown,signal?:AbortSignal):Promise<ReasoningResponse>{
  v.projectId(project);v.analysisId(analysis);const request=parseReasoningRequest(raw);if(signal?.aborted)throw new ReasoningError('AI_CANCELLED',499);
  const {context}=await this.context.create(project,analysis,request.contextRequest,signal),sufficiency=assessEvidence(context,request);
  let provider:LLMProvider|null=null,usage:ProviderResult['usage']={inputTokens:null,outputTokens:null},durationMs=0,estimate:number|null=null,answer:ModelAnswer;
  if(sufficiency.status==='insufficient_evidence')answer={schemaVersion:1,status:'insufficient_evidence',claims:[],limitations:sufficiency.reasons,unansweredAspects:sufficiency.missingCategories};
  else {
   const config=this.configure();requireProvider(config);if(this.active>=config.maxConcurrent)throw new ReasoningError('AI_BUSY',409);
   const prompt=buildPrompt(context,request,config);estimate=prompt.estimatedInputTokens;provider=this.makeProvider(config);
   if(provider.provider!==config.provider||provider.model!==config.model)throw new ReasoningError('AI_PROVIDER_IDENTITY_MISMATCH',500);
   const controller=new AbortController(),cancel=()=>controller.abort();let timedOut=false;
   signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();const timer=setTimeout(()=>{timedOut=true;controller.abort();},config.timeoutMs);this.active++;const start=performance.now();
   try {
    // Race also bounds a transport that fails to cooperate with AbortSignal.
    const result=await new Promise<ProviderResult>((resolve,reject)=>{const abort=()=>reject(new ReasoningError(timedOut?'AI_TIMEOUT':'AI_CANCELLED',timedOut?504:499));controller.signal.addEventListener('abort',abort,{once:true});if(controller.signal.aborted){this.active--;abort();return;}Promise.resolve().then(()=>provider!.generate(prompt.input,controller.signal)).finally(()=>{this.active--;}).then(resolve,reject).finally(()=>controller.signal.removeEventListener('abort',abort));});
    if(controller.signal.aborted)throw new ReasoningError(timedOut?'AI_TIMEOUT':'AI_CANCELLED',timedOut?504:499);
    usage=result.usage;for(const n of [usage.inputTokens,usage.outputTokens])if(n!==null&&(!Number.isSafeInteger(n)||n<0))throw new ReasoningError('AI_PROVIDER_MALFORMED',502);
    if(usage.outputTokens!==null&&usage.outputTokens>config.maxOutputTokens)throw new ReasoningError('AI_OUTPUT_LIMIT',502);
    if(result.refused){if(result.text!==null)throw new ReasoningError('AI_PROVIDER_MALFORMED',502);answer={schemaVersion:1,status:'refused',claims:[],limitations:['PROVIDER_REFUSAL'],unansweredAspects:[]};}
    else{if(typeof result.text!=='string')throw new ReasoningError('AI_PROVIDER_MALFORMED',502);if(config.apiKey&&result.text.includes(config.apiKey))throw new ReasoningError('AI_ANSWER_INVALID',502);answer=parseAnswer(result.text,context);}
   }catch(error){if(controller.signal.aborted)throw new ReasoningError(timedOut?'AI_TIMEOUT':'AI_CANCELLED',timedOut?504:499);if(error instanceof ReasoningError)throw error;throw new ReasoningError('AI_PROVIDER_FAILURE',502);
   }finally{durationMs=Math.round(performance.now()-start);clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  }
  if(signal?.aborted)throw new ReasoningError('AI_CANCELLED',499);
  const cited=new Set(answer.claims.flatMap(c=>c.evidenceIds));
  const response:ReasoningResponse={schemaVersion:1,engineVersion:REASONING_VERSION,answer,sufficiency,provenance:{projectId:project,analysisId:analysis,contextId:context.contextId,retrieval:context.provenance,provider:provider?.provider??null,model:provider?.model??null,coverage:context.coverage,contextStatus:context.status},citations:context.evidence.filter(e=>cited.has(e.evidenceId)).map(e=>({evidenceId:e.evidenceId,kind:e.kind,classification:e.classification,producer:e.producer,navigation:e.navigation,limitations:e.limitations})),validation:{citations:'selected_context_only',structuredFacts:'checked',narrative:'model_interpretation_not_fact_checked',limitations:['Citation existence does not prove narrative factual support.','Structured checks validate recorded facts only; static evidence is not runtime tracing.','Repository evidence may be incomplete; historical source does not verify current bytes.','Prompt separation cannot guarantee model compliance.']},usage:{...usage,durationMs,estimatedInputTokens:estimate,tokenEstimateMethod:estimate===null?null:'conservative_utf8_bytes_plus_1024_framing_not_exact'}};
  if(Buffer.byteLength(JSON.stringify(response))>262144)throw new ReasoningError('AI_RESPONSE_LIMIT',413);return response;
 }
}
