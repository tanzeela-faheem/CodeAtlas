import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { analysisDirectory } from '../../shared/workspace-artifacts.js';
import { contained } from '../../shared/storage.js';
import * as v from '../../shared/validation.js';
import { WorkspaceManagerService } from '../respository/services/workspace-manager.service.js';
import { canonical,digest } from '../symbol-resolution/integration/contracts.js';
import { LIMITS,SEARCH_VERSION,SearchError,type SearchIndex } from './model.js';
import { validateIndex } from './validation.js';
export interface SearchIndexStore {get(project:string,analysis:string):Promise<SearchIndex>;publish(index:SearchIndex):Promise<void>}
/** Shared bounded immutable file operations; format-specific pointers stay independent. */
export class SearchArtifactFiles{
 constructor(private readonly workspaces=new WorkspaceManagerService()){}
 protected async directory(project:string,analysis:string,create=false){v.projectId(project);v.analysisId(analysis);const base=await analysisDirectory(this.workspaces,project,analysis),dir=path.join(base,'search');if(create)try{await fs.mkdir(dir,{mode:0o700});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}if((await fs.lstat(dir)).isSymbolicLink())throw new SearchError('SEARCH_STORAGE_CORRUPT',500);return contained(base,dir);}
 protected async read(dir:string,name:string){const file=path.join(dir,name);if((await fs.lstat(file)).isSymbolicLink())throw new Error('symlink');await contained(dir,file);const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=await handle.stat();if(!stat.isFile()||stat.size>LIMITS.maxBytes+1024)throw new Error('storage size');const chunks:Buffer[]=[];let size=0;for(;;){const buffer=Buffer.alloc(Math.min(65536,LIMITS.maxBytes+1025-size)),r=await handle.read(buffer);if(!r.bytesRead)break;size+=r.bytesRead;if(size>LIMITS.maxBytes+1024)throw new Error('storage size');chunks.push(buffer.subarray(0,r.bytesRead));}return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))) as unknown;}finally{await handle.close();}}
 protected async immutable(dir:string,name:string,payload:unknown){const text=canonical(payload);if(Buffer.byteLength(text)>LIMITS.maxBytes+1024)throw new SearchError('SEARCH_RESOURCE_LIMIT',413);const tmp=path.join(dir,`.${randomUUID()}.tmp`);try{await fs.writeFile(tmp,text,{flag:'wx',mode:0o600});try{await fs.link(tmp,path.join(dir,name));}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;if(canonical(await this.read(dir,name))!==text)throw new SearchError('SEARCH_INDEX_CONFLICT',409);}}finally{await fs.rm(tmp,{force:true});}}
}
export class FileSearchIndexStore extends SearchArtifactFiles implements SearchIndexStore{
 async publish(raw:SearchIndex){const index=v.validatedSnapshot(raw,validateIndex),dir=await this.directory(index.projectId,index.analysisId,true);const pointer={schemaVersion:1,projectId:index.projectId,analysisId:index.analysisId,indexId:index.indexId,documentHash:digest(index)};await this.immutable(dir,`${index.indexId}.search.json`,{documentHash:digest(index),index});await this.immutable(dir,'summary.json',{documentHash:digest(pointer),pointer});}
 async get(project:string,analysis:string):Promise<SearchIndex>{v.projectId(project);v.analysisId(analysis);let pointerRead=false;try{const dir=await this.directory(project,analysis),envelope=v.object(await this.read(dir,'summary.json'),'pointer envelope',['documentHash','pointer']);pointerRead=true;const pointer=v.object(envelope.pointer,'search pointer',['schemaVersion','projectId','analysisId','indexId','documentHash']);v.hash(envelope.documentHash);v.hash(pointer.documentHash);v.string(pointer.indexId,'index ID');v.check(/^si-[a-f0-9]{64}$/.test(pointer.indexId)&&pointer.schemaVersion===1&&pointer.projectId===project&&pointer.analysisId===analysis&&digest(pointer)===envelope.documentHash,'pointer');const result=v.object(await this.read(dir,`${pointer.indexId}.search.json`),'index envelope',['documentHash','index']);if(typeof (result.index as SearchIndex)?.builderVersion==='string'&&(result.index as SearchIndex).builderVersion!==SEARCH_VERSION)throw new SearchError('SEARCH_VERSION_INCOMPATIBLE',409);validateIndex(result.index);v.check(result.documentHash===pointer.documentHash&&digest(result.index)===pointer.documentHash&&result.index.indexId===pointer.indexId&&result.index.projectId===project&&result.index.analysisId===analysis,'index checksum');return result.index;
 }catch(e){if(e instanceof SearchError&&e.code==='SEARCH_VERSION_INCOMPATIBLE')throw e;if(!pointerRead&&(e as NodeJS.ErrnoException).code==='ENOENT')throw new SearchError('SEARCH_INDEX_MISSING',404);throw new SearchError('SEARCH_STORAGE_CORRUPT',500);}}
}
