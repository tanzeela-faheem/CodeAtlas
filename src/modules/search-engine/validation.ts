import * as v from '../../shared/validation.js';
import { digest } from '../symbol-resolution/integration/contracts.js';
import { NODE_KINDS } from '../knowledge-graph/model.js';
import { LIMITS,SEARCH_VERSION,FIELDS,type SearchIndex,type SearchDocument } from './model.js';
import { documentId,indexIdentity,buildTables,CONFIGURATION,compare } from './indexing.js';
function id(value:unknown,prefix:string){v.string(value,'identity');v.check(new RegExp(`^${prefix}-[a-f0-9]{64}$`).test(value),'identity');}
function point(raw:unknown){const p=v.object(raw,'point',['offset','row','column']);for(const value of Object.values(p))v.integer(value,'coordinate');}
function range(raw:unknown){const r=v.object(raw,'range',['start','end']);point(r.start);point(r.end);const {start,end}=raw as NonNullable<SearchDocument['range']>;v.check(end.offset>=start.offset&&end.row>=start.row&&(end.row!==start.row||end.column>=start.column),'range order');}
export function validateIndex(raw:unknown):asserts raw is SearchIndex{
 const o=v.object(raw,'search index',['schemaVersion','builderVersion','indexId','projectId','analysisId','provenance','configuration','status','coverage','documents','tables','diagnostics']);
 v.check(o.schemaVersion===1&&o.builderVersion===SEARCH_VERSION,'search version');v.projectId(o.projectId);v.analysisId(o.analysisId);id(o.indexId,'si');
 const p=v.object(o.provenance,'provenance',['graphSnapshotId','graphDocumentHash','sourceAnalysisHash','metadataAnalysisHash','resolutionAnalysisHash','relationshipAnalysisHash']);id(p.graphSnapshotId,'gs');for(const k of Object.keys(p))if(k!=='graphSnapshotId')v.hash(p[k]);v.check(digest(o.configuration)===digest(CONFIGURATION),'search configuration');
 v.member(o.status,['complete','partial'],'coverage status');v.array(o.coverage,'coverage',LIMITS.maxFiles);const paths=new Set<string>();
 for(const c of o.coverage){const a=v.object(c,'coverage',['relativePath','source','metadata','codes']);v.sourcePath(a.relativePath);v.check(!paths.has(a.relativePath),'duplicate coverage');paths.add(a.relativePath);v.member(a.source,['indexed','unavailable','unsupported'],'source status');v.member(a.metadata,['complete','partial','unavailable'],'metadata status');v.array(a.codes,'coverage codes',64);for(const code of a.codes){v.string(code,'code',false,128);v.check(/^[A-Z_]+$/.test(code),'code');}}
 v.array(o.documents,'documents',LIMITS.maxDocuments);const seen=new Set<string>(),fileCounts=new Map<string,number>();let previous='';
 for(const rawDocument of o.documents){const d=v.object(rawDocument,'search document',['id','projectId','analysisId','type','entityKind','language','relativePath','range','fields','metadataEntityId','astArtifactId','astNodeId','symbolId','graphNodeId','moduleId','contentHash','snippet','limitations']) as unknown as SearchDocument;
 id(d.id,'sd');v.check(!seen.has(d.id)&&compare(previous,d.id)<0,'unique sorted documents');seen.add(d.id);previous=d.id;v.check(d.projectId===o.projectId&&d.analysisId===o.analysisId,'document ownership');v.member(d.type,['file','entity','source_occurrence'],'record kind');v.sourcePath(d.relativePath);v.check(paths.has(d.relativePath),'document coverage');if(d.language!==null)v.string(d.language,'language',false,128);if(d.range!==null)range(d.range);
 const fields=v.object(d.fields,'fields',[],FIELDS);v.check(Object.keys(fields).length>0,'empty fields');for(const val of Object.values(fields))v.string(val,'field',false,2*1024*1024);
 for(const [key,prefix] of [['metadataEntityId','meta'],['graphNodeId','gn'],['moduleId','meta']] as const)if(d[key]!==null)id(d[key],prefix);
 if(d.astArtifactId!==null)v.hash(d.astArtifactId);if(d.contentHash!==null)v.hash(d.contentHash);for(const k of ['astNodeId','symbolId'] as const)if(d[k]!==null)v.string(d[k],k);
 if(d.entityKind!==null)v.member(d.entityKind,NODE_KINDS.filter(k=>k!=='binding'),'metadata kind');
 v.check(d.type==='entity'?!!d.metadataEntityId&&!!d.entityKind&&!!d.astArtifactId&&!!d.astNodeId&&!!d.range:d.metadataEntityId===null&&d.entityKind===null,'record identity');
 if(d.type==='source_occurrence')v.check(!!d.range&&!!d.contentHash&&!!d.astArtifactId&&d.graphNodeId===null&&d.astNodeId===null&&d.symbolId===null&&!!d.snippet&&Object.keys(fields).join(',')==='text','occurrence identity');else v.check(d.snippet===null,'snippet ownership');
 if(d.snippet!==null){const sn=v.object(d.snippet,'snippet',['text','startOffset','matchStart','matchEnd']);v.string(sn.text,'snippet',false,LIMITS.maxToken+124);for(const k of ['startOffset','matchStart','matchEnd'])v.integer(sn[k],'snippet coordinate');v.check(d.range&&d.range.start.offset===d.snippet.startOffset+d.snippet.matchStart&&d.range.end.offset===d.snippet.startOffset+d.snippet.matchEnd&&d.snippet.text.slice(d.snippet.matchStart,d.snippet.matchEnd)===d.fields.text,'snippet match');}
 v.array(d.limitations,'limitations',16);for(const l of d.limitations)v.string(l,'limitation',false,512);
 if(d.type==='file')fileCounts.set(d.relativePath,(fileCounts.get(d.relativePath)??0)+1);
 const {id:_,...body}=d;v.check(documentId(body)===d.id,'document identity');
 }
 v.array(o.diagnostics,'diagnostics',64);for(const d of o.diagnostics)v.string(d,'diagnostic',false,512);
 const index=raw as SearchIndex;
 v.check(index.status===(index.coverage.every(c=>c.source==='indexed'&&c.metadata==='complete'&&c.codes.length===0)?'complete':'partial'),'status derivation');
 const {indexId:_,tables:__,...body}=index;v.check(indexIdentity(body)===index.indexId,'index identity');v.check(digest(buildTables(index.documents))===digest(index.tables),'search postings derivation');
 v.check(index.coverage.every(c=>fileCounts.get(c.relativePath)===1),'file inventory');
 v.check(Buffer.byteLength(JSON.stringify(raw))<=LIMITS.maxBytes,'index size');
}
