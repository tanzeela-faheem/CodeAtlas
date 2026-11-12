import type {AIContextPackage,Category,EvidenceKind} from '../ai-context/model.js';
import type {ReasoningRequest,Sufficiency} from './model.js';
const kinds:Record<Category,EvidenceKind>={metadata:'metadata_entity',graph:'graph_node',relationships:'established_relationship',candidates:'candidate_relationship',documentation:'documentation',source:'source_excerpt',search:'search_match'};
export function assessEvidence(context:AIContextPackage,request:ReasoningRequest):Sufficiency {
 const reasons:string[]=[],missingCategories:string[]=context.request.categories.filter(category=>!context.evidence.some(e=>e.kind===kinds[category]));
 if(!context.evidence.length)reasons.push('NO_SELECTED_EVIDENCE');
 // Explicit focus must survive selection, rather than merely existing upstream.
 for(const f of context.request.focus){const found=context.evidence.some(e=>f.type==='entity'?e.navigation.metadataEntityId===f.entityId:f.type==='graph_node'?e.navigation.graphNodeId===f.nodeId:e.navigation.relativePath===f.relativePath);if(!found)reasons.push('FOCUS_NOT_SELECTED');}
 if(context.request.strategy!=='focused'&&context.coverage.search.returned===0)reasons.push('NO_SEARCH_MATCHES');
 const required:Category[]=request.explanation==='source'?['source']:request.explanation==='relationships'?['relationships']:[];
 for(const category of required)if(!context.evidence.some(e=>e.kind===kinds[category])){if(!missingCategories.includes(category))missingCategories.push(category);reasons.push('REQUIRED_CATEGORY_UNAVAILABLE');}
 // Candidate-only retrieval cannot support a general factual overview.
 if(context.evidence.length&&context.evidence.every(e=>e.kind==='candidate_relationship'))reasons.push('ONLY_UNCERTAIN_CANDIDATES');
 return {status:reasons.length?'insufficient_evidence':'ready_for_generation',reasons:[...new Set(reasons)],missingCategories,suggestions:reasons.length?['Use an exact recorded entity or graph-node focus.','Use a narrower supported Search query or increase explicit Context evidence budgets.']:[]};
}
