import * as v from '../../shared/validation.js';
import {digest,canonical} from '../symbol-resolution/integration/contracts.js';
import {buildModules,validateLimits} from './builder.js';
import {MODULE_VERSION,MODULE_POLICY,LIMITS,ModuleError,type ModuleDocument} from './model.js';
export function validateDocument(raw:unknown):asserts raw is ModuleDocument{
 const o=v.object(raw,'module artifact',['schemaVersion','linkerVersion','policy','artifactId','projectId','analysisId','inputHash','sourceAnalysisHash','resolutionAnalysisHash','metadataAnalysisHash','limits','status','modules','imports','exports','exportEntries','links','diagnostics','inputs','counts','limitations']);
 if(o.schemaVersion!==1||o.linkerVersion!==MODULE_VERSION||o.policy!==MODULE_POLICY)throw new ModuleError('MODULE_VERSION_INCOMPATIBLE',409);
 v.projectId(o.projectId);v.analysisId(o.analysisId);v.string(o.artifactId,'module artifact ID');v.check(/^mx-[a-f0-9]{64}$/.test(o.artifactId),'module artifact ID');validateLimits(o.limits);
 for(const key of ['inputHash','sourceAnalysisHash','resolutionAnalysisHash','metadataAnalysisHash'])v.hash(o[key]);v.check(Buffer.byteLength(canonical(raw))<=LIMITS.maxBytes,'module serialized bound');
 const document=raw as ModuleDocument;const rebuilt=buildModules(document.inputs,document.limits);v.check(digest(rebuilt)===digest(document),'module authenticated producer projection');
}
