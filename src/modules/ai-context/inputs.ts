import * as v from '../../shared/validation.js';
import type { ProjectStore } from '../respository/services/project-store.js';
import { validateProjectState } from '../respository/services/project-validation.js';
import type { AnalysisStore } from '../analysis/summary-store.js';
import { validateAnalysisSummary } from '../analysis/summary-validation.js';
import type { GraphStore } from '../knowledge-graph/storage/GraphStore.js';
import { validateGraph } from '../knowledge-graph/validation.js';
import type { SearchIndexStore } from '../search-engine/storage.js';
import { validateIndex } from '../search-engine/validation.js';
import type { FileAdvancedIndexStore } from '../search-engine/advanced/storage.js';
import { validateAdvanced } from '../search-engine/advanced/validation.js';
import { matchSnapshots } from '../search-engine/advanced/builder.js';
import { digest } from '../symbol-resolution/integration/contracts.js';
import { ContextError,CONTEXT_LIMITS,checkpoint,type GroundingInputs,type ContextProvenance } from './model.js';
export interface InputStores {projects:ProjectStore;analyses:AnalysisStore;graphs:GraphStore;search:SearchIndexStore;advanced:Pick<FileAdvancedIndexStore,'get'>}
export class ContextInputs {
 readonly graphHash:string;private searchHash:string|null=null;private advancedHash:string|null=null;
 private bytes=0;
 private searchTried=false;private advancedTried=false;
 private constructor(readonly stores:InputStores,readonly data:GroundingInputs,readonly deadline:number,readonly signal?:AbortSignal){this.graphHash=digest(data.graph);}
 static async load(stores:InputStores,project:string,analysis:string,deadline:number,signal?:AbortSignal){
 v.projectId(project);v.analysisId(analysis);checkpoint(deadline,signal);
 const state=await stores.projects.get(project),summary=await stores.analyses.get(project,analysis);validateProjectState(state,project);v.check(state.result.status==='imported','context imported project');validateAnalysisSummary(summary);
 const graph=await stores.graphs.get(project,analysis);validateGraph(graph);
 v.check(summary.projectId===project&&summary.analysisId===analysis&&graph.snapshot.projectId===project&&graph.snapshot.analysisId===analysis&&digest(summary)===graph.snapshot.sourceAnalysisHash,'context project/analysis snapshot');
 // ProjectProfile is mutable detection state, not part of the selected immutable
 // graph/source snapshot. Do not mix it into or invalidate historical context.
 const inputs=new ContextInputs(stores,{graph,search:null,advanced:null},deadline,signal);inputs.account(graph);checkpoint(deadline,signal);return inputs;
 }
 account(value:unknown){this.bytes+=Buffer.byteLength(JSON.stringify(value));if(this.bytes>CONTEXT_LIMITS.maxInputBytes)throw new ContextError('CONTEXT_INPUT_LIMIT',413);checkpoint(this.deadline,this.signal);}
 get provenance():ContextProvenance {const {graph,search,advanced}=this.data,s=graph.snapshot;return {graphSnapshotId:s.snapshotId,graphDocumentHash:this.graphHash,sourceAnalysisHash:s.sourceAnalysisHash,metadataAnalysisHash:s.metadataAnalysisHash,resolutionAnalysisHash:s.resolutionAnalysisHash,relationshipAnalysisHash:s.relationshipAnalysisHash,searchIndexId:search?.indexId??null,searchDocumentHash:this.searchHash,advancedIndexId:advanced?.indexId??null,advancedDocumentHash:this.advancedHash};}
 async base(required=false){if(!this.searchTried){this.searchTried=true;try{const graph=this.data.graph,base=await this.stores.search.get(graph.snapshot.projectId,graph.snapshot.analysisId);validateIndex(base);this.account(base);v.check(base.projectId===graph.snapshot.projectId&&base.analysisId===graph.snapshot.analysisId&&base.provenance.graphSnapshotId===graph.snapshot.snapshotId&&base.provenance.graphDocumentHash===this.graphHash,'context Search snapshot');for(const key of ['sourceAnalysisHash','metadataAnalysisHash','resolutionAnalysisHash','relationshipAnalysisHash'] as const)v.check(base.provenance[key]===graph.snapshot[key],'context Search producer hash');
 const manifest=new Map(graph.evidence.source.files.map(f=>[f.relativePath,f])),entities=new Map(graph.evidence.files.flatMap(f=>f.metadata.entities.map(e=>[e.entityId,e] as const)));
 v.check(base.coverage.length===manifest.size&&base.coverage.every(f=>manifest.has(f.relativePath)),'context Search inventory');for(const d of base.documents){const ref=manifest.get(d.relativePath)?.artifact;v.check(d.astArtifactId===(ref?.artifactId??null)&&d.contentHash===(ref?.contentHash??null),'context Search AST reference');if(d.metadataEntityId){const e=entities.get(d.metadataEntityId);v.check(e&&e.relativePath===d.relativePath&&e.kind===d.entityKind&&(e.name??undefined)===d.fields.name&&(e.qualifiedName??undefined)===d.fields.qualifiedName&&digest(e.sourceRange)===digest(d.range),'context Search metadata identity');}}
 this.data.search=base;this.searchHash=digest(base);
 }catch(e){if((e as {code?:string}).code!=='SEARCH_INDEX_MISSING')throw e;}}
 if(required&&!this.data.search)throw new ContextError('CONTEXT_SEARCH_MISSING',424);return this.data.search;}
 async historical(required=false){if(!this.advancedTried){this.advancedTried=true;const base=await this.base(required);if(base)try{const graph=this.data.graph,index=await this.stores.advanced.get(graph.snapshot.projectId,graph.snapshot.analysisId);validateAdvanced(index);matchSnapshots(index,base,graph);this.account(index);this.data.advanced=index;this.advancedHash=digest(index);}catch(e){if((e as {code?:string}).code!=='SEARCH_V2_INDEX_MISSING')throw e;}}
 if(required&&!this.data.advanced)throw new ContextError('CONTEXT_SEARCH_V2_MISSING',424);return this.data.advanced;}
}
