import type { AIContextPackage, EvidenceClass } from '../ai-context/model.js';
export const REASONING_VERSION = 'grounded-reasoning-v1' as const;
export class ReasoningError extends Error {
 constructor(readonly code: string, readonly httpStatus = 422) { super(code); }
}
export interface ProviderInput {
 instructions: string; data: string; schema: unknown; maxOutputTokens: number;
}
export interface ProviderResult {
 text: string | null; refused: boolean;
 usage: {inputTokens:number|null;outputTokens:number|null};
}
export interface LLMProvider {
 readonly provider: string; readonly model: string;
 generate(input: ProviderInput, signal: AbortSignal): Promise<ProviderResult>;
}
export interface ReasoningConfig {
 enabled:boolean; provider:'openai'; model:string; apiKey:string|undefined;
 timeoutMs:number;maxOutputTokens:number;maxInputBytes:number;maxContextTokens:number;maxConcurrent:number;
}
export interface ReasoningRequest {
 schemaVersion:1; contextRequest:unknown; style:'concise'|'detailed';
 explanation:'overview'|'source'|'relationships';
}
export type Fact = {type:'entity';entityId:string}|{type:'edge';graphEdgeId:string;sourceGraphNodeId:string;targetGraphNodeId:string;edgeKind:string;guarantee:string}|{type:'source';relativePath:string;startOffset:number;endOffset:number;contentHash:string};
export interface Claim {
 claimId:string;text:string;evidenceIds:string[];qualification:'interpretation'|'producer_fact'|'uncertain';
 classifications:EvidenceClass[];fact:Fact|null;
}
export interface ModelAnswer {
 schemaVersion:1;status:'answered'|'partially_answered'|'insufficient_evidence'|'refused';
 claims:Claim[];limitations:string[];unansweredAspects:string[];
}
export interface Sufficiency {status:'ready_for_generation'|'insufficient_evidence';reasons:string[];missingCategories:string[];suggestions:string[]}
export interface ReasoningResponse {
 schemaVersion:1;engineVersion:typeof REASONING_VERSION;answer:ModelAnswer;sufficiency:Sufficiency;
 provenance:{projectId:string;analysisId:string;contextId:string;retrieval:AIContextPackage['provenance'];provider:string|null;model:string|null;coverage:AIContextPackage['coverage'];contextStatus:AIContextPackage['status']};
 citations:{evidenceId:string;kind:string;classification:EvidenceClass;producer:AIContextPackage['evidence'][number]['producer'];navigation:AIContextPackage['evidence'][number]['navigation'];limitations:string[]}[];
 validation:{citations:'selected_context_only';structuredFacts:'checked';narrative:'model_interpretation_not_fact_checked';limitations:string[]};
 usage:{inputTokens:number|null;outputTokens:number|null;durationMs:number;estimatedInputTokens:number|null;tokenEstimateMethod:string|null};
}
