import * as v from '../../shared/validation.js';
import {loadInputs,type InputStores} from './inputs.js';
import type {ModuleStore} from './storage.js';
import {buildModules} from './builder.js';
import {LIMITS,ModuleError,checkpoint} from './model.js';
import {status,query,parseQuery} from './query.js';
export class ModuleCoordinator{
 private active=false;
 constructor(private readonly inputs:InputStores,private readonly store:ModuleStore){}
 async build(project:string,analysis:string,raw:unknown={},signal?:AbortSignal){v.projectId(project);v.analysisId(analysis);v.object(raw,'module build',[]);if(this.active)throw new ModuleError('MODULE_BUSY',409);this.active=true;const deadline=Date.now()+LIMITS.maxDurationMs;try{checkpoint(deadline,signal);try{const cached=await this.store.get(project,analysis);checkpoint(deadline,signal);return status(cached);}catch(e){if(!(e instanceof ModuleError&&e.code==='MODULE_INDEX_MISSING'))throw e;}const input=await loadInputs(this.inputs,project,analysis,deadline,signal),document=buildModules(input,LIMITS,deadline,signal);checkpoint(deadline,signal);await this.store.publish(document);checkpoint(deadline,signal);return status(document);}finally{this.active=false;}}
 async status(project:string,analysis:string){return status(await this.store.get(project,analysis));}
 async query(project:string,analysis:string,raw:unknown){const request=parseQuery(raw);return query(await this.store.get(project,analysis),request);}
}
