import { digest } from '../../symbol-resolution/integration/contracts.js';
import { GraphError, type GraphDocument, type GraphProvenance } from '../model.js';
import type { GraphStore } from '../storage/GraphStore.js';

/** Immutable-analysis update boundary. Future incremental modes require new contracts. */
export interface GraphUpdatePolicy { mode:'immutable_analysis_snapshot' }
export class GraphUpdateEngine {
    readonly policy:GraphUpdatePolicy={mode:'immutable_analysis_snapshot'};
    constructor(private readonly store:GraphStore){}
    async reuse(provenance:GraphProvenance):Promise<GraphDocument|null>{
        let prior:GraphDocument;
        try{prior=await this.store.get(provenance.projectId,provenance.analysisId);}catch(e){if(e instanceof GraphError&&e.code==='GRAPH_NOT_FOUND')return null;throw e;}
        const s=prior.snapshot;
        const actual:GraphProvenance={projectId:s.projectId,analysisId:s.analysisId,sourceAnalysisHash:s.sourceAnalysisHash,metadataAnalysisHash:s.metadataAnalysisHash,resolutionAnalysisHash:s.resolutionAnalysisHash,relationshipAnalysisHash:s.relationshipAnalysisHash,architectureAnalysisHash:s.architectureAnalysisHash};
        if(digest(actual)!==digest(provenance))throw new GraphError('GRAPH_SNAPSHOT_CONFLICT',409);
        return prior;
    }
    async publish(document:GraphDocument):Promise<void>{await this.store.publish(document);}
}
