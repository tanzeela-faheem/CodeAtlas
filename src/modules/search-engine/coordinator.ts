import * as v from '../../shared/validation.js';
import type { GraphStore } from '../knowledge-graph/storage/GraphStore.js';
import { validateGraph } from '../knowledge-graph/validation.js';
import { digest } from '../symbol-resolution/integration/contracts.js';
import type { SourceReader } from '../analysis/source-reader.js';
import type { SearchIndexStore } from './storage.js';
import { LIMITS,SearchError,checkpoint } from './model.js';
import { buildSearchIndex } from './builder.js';
export class SearchCoordinator {
 private active=false;
 constructor(private readonly graphs:GraphStore,private readonly reader:Pick<SourceReader,'read'>,private readonly store:SearchIndexStore){}
 async build(project:string,analysis:string){v.projectId(project);v.analysisId(analysis);if(this.active)throw new SearchError('SEARCH_BUSY',409);this.active=true;const deadline=Date.now()+LIMITS.maxDurationMs;
 try{const graph=await this.graphs.get(project,analysis);validateGraph(graph);v.check(graph.snapshot.projectId===project&&graph.snapshot.analysisId===analysis,'search graph ownership');checkpoint(deadline);
 try{const existing=await this.store.get(project,analysis);if(existing.provenance.graphDocumentHash!==digest(graph))throw new SearchError('SEARCH_SNAPSHOT_CONFLICT',409);return existing;}catch(e){if(!(e instanceof SearchError&&e.code==='SEARCH_INDEX_MISSING'))throw e;}
 const index=await buildSearchIndex(graph,this.reader,deadline);checkpoint(deadline);await this.store.publish(index);return index;
 }finally{this.active=false;}}
}
