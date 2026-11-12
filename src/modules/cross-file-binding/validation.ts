import * as v from '../../shared/validation.js';
import {canonical,digest} from '../symbol-resolution/integration/contracts.js';
import {buildBindings,validateLimits} from './builder.js';
import {VERSION,LIMITS,BindingError,type BindingDocument} from './model.js';
export function validateDocument(raw:unknown):asserts raw is BindingDocument {
 const o=v.object(raw,'cross-file artifact',['schemaVersion','bindingVersion','artifactId','projectId','analysisId','moduleArtifactId','moduleDocumentHash','sourceAnalysisHash','resolutionAnalysisHash','metadataAnalysisHash','limits','status','bindings','references','exports','origins','namespaces','coverage','diagnostics','counts','limitations','input']);
 if(o.schemaVersion!==1||o.bindingVersion!==VERSION)throw new BindingError('CROSS_FILE_VERSION_INCOMPATIBLE',409);
 v.projectId(o.projectId);v.analysisId(o.analysisId);v.string(o.artifactId,'cross-file artifact ID');v.check(/^cf-[a-f0-9]{64}$/.test(o.artifactId),'cross-file artifact ID');validateLimits(o.limits);
 for(const k of ['moduleDocumentHash','sourceAnalysisHash','resolutionAnalysisHash','metadataAnalysisHash'])v.hash(o[k]);v.check(Buffer.byteLength(canonical(raw))<=LIMITS.maxBytes,'cross-file stored size');
 const doc=raw as BindingDocument;v.check(digest(buildBindings(doc.input,doc.limits))===digest(doc),'cross-file authenticated projection replay');
}
