import {ReasoningError,type LLMProvider,type ProviderInput,type ProviderResult,type ReasoningConfig} from './model.js';
import {requireProvider} from './config.js';
export const OPENAI_ENDPOINT='https://api.openai.com/v1/responses';
export class OpenAIProvider implements LLMProvider {
 readonly provider='openai';readonly model:string;
 constructor(private readonly config:ReasoningConfig,private readonly transport:typeof fetch=fetch){this.model=config.model;}
 async generate(input:ProviderInput,signal:AbortSignal):Promise<ProviderResult>{
  requireProvider(this.config);if(signal.aborted)throw new ReasoningError('AI_CANCELLED',499);
  try {
   const response=await this.transport(OPENAI_ENDPOINT,{method:'POST',redirect:'error',signal,headers:{Authorization:`Bearer ${this.config.apiKey}`,'Content-Type':'application/json'},body:JSON.stringify({model:this.model,instructions:input.instructions,input:[{role:'user',content:input.data}],text:{format:{type:'json_schema',name:'codeatlas_answer_v1',strict:true,schema:input.schema}},max_output_tokens:input.maxOutputTokens,store:false})});
   if(!response.ok){await response.body?.cancel();const status=response.status;throw new ReasoningError(status===401?'AI_AUTHENTICATION_FAILED':status===403?'AI_PERMISSION_DENIED':status===429?'AI_RATE_LIMITED':status===400||status===404||status===422?'AI_PROVIDER_UNSUPPORTED':status>=500?'AI_PROVIDER_SERVICE_ERROR':'AI_PROVIDER_REQUEST_FAILED',status===429?429:502);}
   // Stream bounded bytes, not response.json() on an unbounded upstream body.
   if(!response.body)throw new ReasoningError('AI_PROVIDER_MALFORMED',502);
   const reader=response.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
   try{for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>131072)throw new ReasoningError('AI_OUTPUT_LIMIT',502);chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
   let raw:any;try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw new ReasoningError('AI_PROVIDER_MALFORMED',502);}
   if(raw.status==='incomplete')throw new ReasoningError('AI_OUTPUT_INCOMPLETE',502);
   if(raw.status!=='completed'||!Array.isArray(raw.output))throw new ReasoningError('AI_PROVIDER_MALFORMED',502);
   const texts:string[]=[];let refused=false;
   for(const item of raw.output){if(item?.type!=='message'||item.role!=='assistant'||item.status!=='completed'||!Array.isArray(item.content))throw new ReasoningError('AI_PROVIDER_MALFORMED',502);for(const c of item.content){if(c?.type==='refusal'&&typeof c.refusal==='string')refused=true;else if(c?.type==='output_text'&&typeof c.text==='string')texts.push(c.text);else throw new ReasoningError('AI_PROVIDER_MALFORMED',502);}}
   if((refused&&texts.length)||(!refused&&texts.length!==1))throw new ReasoningError('AI_PROVIDER_MALFORMED',502);
   const count=(n:unknown)=>Number.isSafeInteger(n)&&(n as number)>=0?n as number:null;
   return {text:refused?null:texts[0]!,refused,usage:{inputTokens:count(raw.usage?.input_tokens),outputTokens:count(raw.usage?.output_tokens)}};
  }catch(error){if(signal.aborted)throw new ReasoningError('AI_CANCELLED',499);if(error instanceof ReasoningError)throw error;throw new ReasoningError('AI_NETWORK_FAILURE',502);}
 }
}
