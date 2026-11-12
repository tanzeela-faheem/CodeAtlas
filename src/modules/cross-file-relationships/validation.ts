import * as v from '../../shared/validation.js';
import {canonical,digest} from '../symbol-resolution/integration/contracts.js';
import {buildRelationships,validateLimits} from './builder.js';
import {VERSION,LIMITS,CrossRelationshipError,type RelationshipDocument} from './model.js';
export function validateDocument(raw:unknown):asserts raw is RelationshipDocument {
 const o=v.object(raw,'cross-relationship artifact',['schemaVersion','relationshipVersion','artifactId','projectId','analysisId','moduleArtifactId','moduleDocumentHash','bindingArtifactId','bindingDocumentHash','sourceAnalysisHash','resolutionAnalysisHash','metadataAnalysisHash','limits','status','calls','dependencies','candidates','contexts','coverage','diagnostics','counts','limitations','input']);
 if(o.schemaVersion!==1||o.relationshipVersion!==VERSION)throw new CrossRelationshipError('CROSS_REL_VERSION_INCOMPATIBLE',409);
 v.projectId(o.projectId);v.analysisId(o.analysisId);v.string(o.artifactId,'relationship artifact ID');v.check(/^xr-[a-f0-9]{64}$/.test(o.artifactId),'relationship artifact identity');validateLimits(o.limits);
 for(const key of ['moduleDocumentHash','bindingDocumentHash','sourceAnalysisHash','resolutionAnalysisHash','metadataAnalysisHash'])v.hash(o[key]);v.check(Buffer.byteLength(canonical(raw))<=LIMITS.maxBytes,'cross-relationship document bound');
 const doc=raw as RelationshipDocument;v.check(digest(buildRelationships(doc.input,doc.limits))===digest(doc),'cross-relationship authenticated projection replay');
}
