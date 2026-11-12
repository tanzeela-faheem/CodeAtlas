import * as v from '../../shared/validation.js';
import type { SourceReader } from '../analysis/source-reader.js';
import { canonical } from '../symbol-resolution/integration/contracts.js';
import { ContextInputs,type InputStores } from './inputs.js';
import { ContextRetrieval } from './retrieval.js';
import { parseContextRequest } from './request.js';
import { buildContext } from './builder.js';
import { validateGroundedContext } from './validation.js';
import { generatePromptContext } from './prompt.js';
import { CONTEXT_LIMITS,ContextError,checkpoint } from './model.js';
export class AIContextCoordinator {
 private active=false;
 constructor(private readonly stores:InputStores,private readonly reader:Pick<SourceReader,'read'>){}
 async create(project:string,analysis:string,raw:unknown,signal?:AbortSignal){v.projectId(project);v.analysisId(analysis);const request=JSON.parse(canonical(parseContextRequest(raw))) as import('./model.js').ContextRequest;if(this.active)throw new ContextError('CONTEXT_BUSY',409);this.active=true;const deadline=Date.now()+request.retrieval.maxDurationMs;
 try{checkpoint(deadline,signal);const inputs=await ContextInputs.load(this.stores,project,analysis,deadline,signal),retrieval=await new ContextRetrieval(inputs,request,this.reader).collect();checkpoint(deadline,signal);
 const context=buildContext(project,analysis,request,retrieval.provenance,retrieval.candidates,retrieval.coverage);validateGroundedContext(context,retrieval.candidates,retrieval.coverage,retrieval.provenance);const response={context,promptContext:generatePromptContext(context)};
 if(Buffer.byteLength(canonical(response))>CONTEXT_LIMITS.maxResponseBytes)throw new ContextError('CONTEXT_RESPONSE_LIMIT',413);checkpoint(deadline,signal);return response;
 }finally{this.active=false;}}
}
