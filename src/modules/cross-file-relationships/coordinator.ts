import * as v from '../../shared/validation.js';
import type {ProjectStore} from '../respository/services/project-store.js';
import type {AnalysisStore} from '../analysis/summary-store.js';
import type {ResolutionStore} from '../symbol-resolution/storage.js';
import type {ModuleStore} from '../module-linking/storage.js';
import type {BindingStore} from '../cross-file-binding/storage.js';
import type {CrossRelationshipStore} from './storage.js';
import {validateProjectState} from '../respository/services/project-validation.js';
import {validateAnalysisSummary} from '../analysis/summary-validation.js';
import {validateResolutionAnalysis} from '../symbol-resolution/validation.js';
import {digest} from '../symbol-resolution/integration/contracts.js';
import {ModuleError} from '../module-linking/model.js';
import {buildRelationships} from './builder.js';
import {BindingError} from '../cross-file-binding/model.js';
import {CrossRelationshipError,LIMITS,checkpoint} from './model.js';
import {status,query,parseQuery} from './query.js';
export interface Inputs {projects:ProjectStore;source:AnalysisStore;resolution:ResolutionStore;modules:ModuleStore;bindings:BindingStore}
export class CrossRelationshipCoordinator {
 private active=false;
 constructor(private readonly inputs:Inputs,private readonly store:CrossRelationshipStore){}
 async build(p:string,a:string,raw:unknown={},signal?:AbortSignal){v.projectId(p);v.analysisId(a);v.object(raw,'cross-relationship build',[]);if(this.active)throw new CrossRelationshipError('CROSS_REL_BUSY',409);this.active=true;const deadline=Date.now()+LIMITS.maxDurationMs;
  try{checkpoint(deadline,signal);try{const cached=await this.store.get(p,a);checkpoint(deadline,signal);return status(cached);}catch(e){if(!(e instanceof CrossRelationshipError&&e.code==='CROSS_REL_INDEX_MISSING'))throw e;}
   const project=await this.inputs.projects.get(p);validateProjectState(project,p);v.check(project.result.status==='imported','cross-relationship imported project');
   const source=await this.inputs.source.get(p,a);validateAnalysisSummary(source,p,a);if(!['completed','completed_with_errors'].includes(source.status))throw new CrossRelationshipError('CROSS_REL_SOURCE_NOT_COMPLETE',409);
   let input;try{input=await this.inputs.modules.get(p,a);}catch(e){if(e instanceof ModuleError&&e.code==='MODULE_INDEX_MISSING')throw new CrossRelationshipError('CROSS_REL_MODULE_INDEX_MISSING',424);throw e;}
   v.check(input.projectId===p&&input.analysisId===a&&digest(source)===input.sourceAnalysisHash,'cross-relationship source/module snapshot');
   let lexical;try{lexical=await(this.inputs.resolution.getAnalysisManifest?.(p,a)??this.inputs.resolution.getAnalysis(p,a));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')throw new CrossRelationshipError('CROSS_REL_RESOLUTION_MISSING',424);throw e;}
   validateResolutionAnalysis(lexical);v.check(lexical.projectId===p&&lexical.analysisId===a&&digest(lexical)===input.resolutionAnalysisHash,'cross-relationship lexical manifest snapshot');checkpoint(deadline,signal);
   let binding;try{binding=await this.inputs.bindings.get(p,a);}catch(e){if(e instanceof BindingError&&e.code==='CROSS_FILE_INDEX_MISSING')throw new CrossRelationshipError('CROSS_REL_BINDING_INDEX_MISSING',424);throw e;}v.check(binding.projectId===p&&binding.analysisId===a&&binding.moduleArtifactId===input.artifactId&&binding.moduleDocumentHash===digest(input)&&digest(binding.input)===digest(input),'cross-relationship Phase 1/2 snapshot');const doc=buildRelationships(binding,LIMITS,deadline,signal);checkpoint(deadline,signal);await this.store.publish(doc);checkpoint(deadline,signal);return status(doc);
  }finally{this.active=false;}
 }
 async status(p:string,a:string){return status(await this.store.get(p,a));}
 async query(p:string,a:string,raw:unknown){const q=parseQuery(raw);return query(await this.store.get(p,a),q);}
}
