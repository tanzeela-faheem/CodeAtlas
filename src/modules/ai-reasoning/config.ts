import {ReasoningError,type ReasoningConfig} from './model.js';
export const SUPPORTED_MODELS = ['gpt-4.1-mini','gpt-4.1-mini-2025-04-14'] as const;
export function reasoningConfig(env:NodeJS.ProcessEnv=process.env):ReasoningConfig {
 const enabled=env.CODEATLAS_AI_ENABLED==='true';
 if(env.CODEATLAS_AI_ENABLED!==undefined&&!['true','false'].includes(env.CODEATLAS_AI_ENABLED))throw new ReasoningError('AI_CONFIG_INVALID',503);
 const integer=(key:string,fallback:number,min:number,max:number)=>{const raw=env[key];const n=raw===undefined?fallback:Number(raw);if((raw!==undefined&&!/^\d+$/.test(raw))||!Number.isSafeInteger(n)||n<min||n>max)throw new ReasoningError('AI_CONFIG_INVALID',503);return n;};
 const provider=env.CODEATLAS_AI_PROVIDER??'openai',model=env.CODEATLAS_AI_MODEL??'';
 if(provider!=='openai'||(enabled&&!SUPPORTED_MODELS.includes(model as typeof SUPPORTED_MODELS[number])))throw new ReasoningError('AI_CONFIG_UNSUPPORTED',503);
 return {enabled,provider,model,apiKey:env.OPENAI_API_KEY,timeoutMs:integer('CODEATLAS_AI_TIMEOUT_MS',30000,100,120000),maxOutputTokens:integer('CODEATLAS_AI_MAX_OUTPUT_TOKENS',2048,128,8192),maxInputBytes:integer('CODEATLAS_AI_MAX_INPUT_BYTES',131072,4096,262144),maxContextTokens:integer('CODEATLAS_AI_MAX_CONTEXT_TOKENS',131072,4096,131072),maxConcurrent:integer('CODEATLAS_AI_MAX_CONCURRENT',1,1,4)};
}
export function requireProvider(config:ReasoningConfig){
 if(!config.enabled)throw new ReasoningError('AI_DISABLED',503);
 if(!config.apiKey||!config.apiKey.trim())throw new ReasoningError('AI_CREDENTIALS_MISSING',503);
 // Prevent malformed header values without exposing the credential.
 if(!/^[\x21-\x7e]+$/.test(config.apiKey))throw new ReasoningError('AI_CONFIG_INVALID',503);
}
