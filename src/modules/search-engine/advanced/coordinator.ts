import * as v from '../../../shared/validation.js';
import { validateGraph } from '../../knowledge-graph/validation.js';
import type { GraphStore } from '../../knowledge-graph/storage/GraphStore.js';
import type { SourceReader } from '../../analysis/source-reader.js';
import type { SearchIndexStore } from '../storage.js';
import type { SearchCoordinator } from '../coordinator.js';
import { validateIndex } from '../validation.js';
import { SearchError,checkpoint } from '../model.js';
import { ADVANCED_LIMITS,type AdvancedRequest } from './model.js';
import { FileAdvancedIndexStore } from './storage.js';
import { buildAdvancedIndex,matchSnapshots } from './builder.js';
import { retrieveAdvanced } from './retrieval.js';
export class AdvancedSearchCoordinator {
 private active=false;
 constructor(private readonly graphs:GraphStore,private readonly base:SearchIndexStore,private readonly store:FileAdvancedIndexStore,private readonly reader:Pick<SourceReader,'read'>,private readonly baseBuilder:SearchCoordinator){}
 async load(project:string,analysis:string){v.projectId(project);v.analysisId(analysis);const index=await this.store.get(project,analysis),base=await this.base.get(project,analysis),graph=await this.graphs.get(project,analysis);validateIndex(base);validateGraph(graph);matchSnapshots(index,base,graph);return {index,base,graph};}
 async build(project:string,analysis:string){v.projectId(project);v.analysisId(analysis);if(this.active)throw new SearchError('SEARCH_BUSY',409);this.active=true;const deadline=Date.now()+ADVANCED_LIMITS.maxDurationMs;
 try{try{const cached=await this.load(project,analysis);checkpoint(deadline);return cached.index;}catch(e){if(!(e instanceof SearchError&&e.code==='SEARCH_V2_INDEX_MISSING'))throw e;}
 const base=await this.baseBuilder.build(project,analysis),graph=await this.graphs.get(project,analysis);validateIndex(base);validateGraph(graph);checkpoint(deadline);const index=await buildAdvancedIndex(base,graph,this.reader,deadline);checkpoint(deadline);await this.store.publish(index);return index;
 }finally{this.active=false;}}
 async query(project:string,analysis:string,request:AdvancedRequest){const {index,base,graph}=await this.load(project,analysis);return retrieveAdvanced(index,base,graph,request);}
}
