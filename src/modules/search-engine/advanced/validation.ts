import * as v from '../../../shared/validation.js';
import { digest } from '../../symbol-resolution/integration/contracts.js';
import { LIMITS } from '../model.js';
import { compare } from '../indexing.js';
import { ADVANCED_VERSION,ADVANCED_CONFIGURATION,ADVANCED_LIMITS,type AdvancedIndex } from './model.js';
import { advancedIdentity } from './builder.js';
import { sourceHash,positions,positionalTables } from './positions.js';
export function identity(raw:unknown,prefix:string):asserts raw is string {v.string(raw,'identity');v.check(new RegExp(`^${prefix}-[a-f0-9]{64}$`).test(raw),'advanced identity');}
export function validateAdvanced(raw:unknown):asserts raw is AdvancedIndex{
 const o=v.object(raw,'advanced search index',['schemaVersion','builderVersion','indexId','projectId','analysisId','baseIndexId','baseDocumentHash','provenance','configuration','coverage','sources','tokens','lexical']);
 v.check(o.schemaVersion===2&&o.builderVersion===ADVANCED_VERSION,'advanced version');v.projectId(o.projectId);v.analysisId(o.analysisId);identity(o.indexId,'sx');identity(o.baseIndexId,'si');v.hash(o.baseDocumentHash);
 const provenance=v.object(o.provenance,'provenance',['graphSnapshotId','graphDocumentHash','sourceAnalysisHash','metadataAnalysisHash','resolutionAnalysisHash','relationshipAnalysisHash']);identity(provenance.graphSnapshotId,'gs');for(const key of Object.keys(provenance))if(key!=='graphSnapshotId')v.hash(provenance[key]);v.check(digest(o.configuration)===digest(ADVANCED_CONFIGURATION),'advanced configuration');
 v.array(o.coverage,'coverage',ADVANCED_LIMITS.maxFiles);const covered=new Map<string,string>();let last='';for(const value of o.coverage){const c=v.object(value,'coverage',['relativePath','status','code']);v.sourcePath(c.relativePath);v.check(compare(last,c.relativePath)<0,'sorted coverage');last=c.relativePath;v.member(c.status,['indexed','unavailable','unsupported'],'source coverage');if(c.code!==null){v.string(c.code,'source code',false,128);v.check(/^[A-Z_]+$/.test(c.code),'source code');}v.check(c.status==='indexed'?c.code===null:c.code!==null,'coverage consistency');covered.set(c.relativePath,c.status);}
 v.array(o.sources,'historical sources',ADVANCED_LIMITS.maxFiles);let bytes=0,totalPositions=0;last='';
 for(const value of o.sources){const s=v.object(value,'historical source',['fileId','relativePath','contentHash','astArtifactId','text','positions']);identity(s.fileId,'sd');v.sourcePath(s.relativePath);v.check(compare(last,s.relativePath)<0&&covered.get(s.relativePath)==='indexed','source coverage/order');last=s.relativePath;v.hash(s.contentHash);v.hash(s.astArtifactId);v.string(s.text,'source',true,2_000_000);v.check(Buffer.byteLength(s.text)<=2_000_000,'per-file byte limit');bytes+=Buffer.byteLength(s.text);v.check(bytes<=ADVANCED_LIMITS.maxSourceBytes&&sourceHash(s.text)===s.contentHash,'source identity/bytes');
 v.array(s.positions,'positions',ADVANCED_LIMITS.maxPositions);totalPositions+=s.positions.length;v.check(totalPositions<=ADVANCED_LIMITS.maxPositions,'position limit');const docs=new Map<number,string>();
 for(const value of s.positions){const p=v.object(value,'position',['start','end','term','documentId']);v.integer(p.start,'start');v.integer(p.end,'end');v.check(p.end>p.start&&p.end<=s.text.length,'position span');if(p.term!==null)v.string(p.term,'token',false,2*LIMITS.maxToken);if(p.documentId!==null){identity(p.documentId,'sd');docs.set(p.start,p.documentId);}}
 v.check(digest(positions(s.text,docs))===digest(s.positions),'position derivation');
 }
 const index=raw as AdvancedIndex;v.check(index.sources.length===index.coverage.filter(c=>c.status==='indexed').length,'source inventory');const derived=positionalTables(index.sources);v.check(digest(derived.tokens)===digest(index.tokens)&&digest(derived.lexical)===digest(index.lexical),'positional postings');
 const {indexId:_,...body}=index;v.check(advancedIdentity(body)===index.indexId,'advanced content identity');v.check(Buffer.byteLength(JSON.stringify(raw))<=ADVANCED_LIMITS.maxBytes,'advanced byte limit');
}
