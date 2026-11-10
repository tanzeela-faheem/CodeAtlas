import * as v from '../../shared/validation.js';
import { digest } from '../symbol-resolution/integration/contracts.js';
import { buildGraph } from './core/GraphBuilder.js';
import { GRAPH_LIMITS, type GraphDocument } from './model.js';
/** Reconstruct the entire projection from retained, producer-validated evidence.
 * Rejects self-consistent forged endpoints/counts/IDs, not only accidental checksum errors.
 */
export function validateGraph(value:unknown):asserts value is GraphDocument {
    const o=v.object(value,'graph document',['snapshot','nodes','edges','candidates','evidence']);
    v.array(o.nodes,'graph nodes',GRAPH_LIMITS.maxNodes);v.array(o.edges,'graph edges',GRAPH_LIMITS.maxEdges);v.array(o.candidates,'graph candidates',GRAPH_LIMITS.maxCandidates);
    v.check(Buffer.byteLength(JSON.stringify(value))<=GRAPH_LIMITS.maxBytes,'graph byte limit');
    const expected=buildGraph((value as GraphDocument).evidence);
    v.check(digest(expected)===digest(value),'graph projection/provenance/counts');
}
