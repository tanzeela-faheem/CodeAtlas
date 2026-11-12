import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { contained } from '../../../shared/storage.js';
import { analysisDirectory } from '../../../shared/workspace-artifacts.js';
import { object, hash, validatedSnapshot, projectId, analysisId } from '../../../shared/validation.js';
import { WorkspaceManagerService } from '../../respository/services/workspace-manager.service.js';
import { canonical, digest } from '../../symbol-resolution/integration/contracts.js';
import { GRAPH_VERSION, GRAPH_LIMITS, GraphError, type GraphDocument } from '../model.js';
import { graphIdentity } from '../contracts.js';
import { validateGraph } from '../validation.js';

export interface GraphStore {
    publish(document:GraphDocument):Promise<void>;
    get(projectId:string,analysisId:string):Promise<GraphDocument>;
}
export class FileGraphStore implements GraphStore {
    constructor(private readonly workspaces=new WorkspaceManagerService()){}
    private async directory(project:string,analysis:string,create=false):Promise<string>{
        projectId(project);analysisId(analysis);
        const base=await analysisDirectory(this.workspaces,project,analysis),dir=path.join(base,'graph');
        if(create)await fs.mkdir(dir,{recursive:true,mode:0o700});
        return contained(base,dir);
    }
    private async read(dir:string,name:string):Promise<unknown>{
        const file=await contained(dir,path.join(dir,name)),handle=await fs.open(file,'r');
        try{
            const stat=await handle.stat();if(!stat.isFile()||stat.size>GRAPH_LIMITS.maxBytes+1024)throw new Error('graph storage size/type');
            const chunks:Buffer[]=[];let total=0;
            for(;;){const chunk=Buffer.alloc(Math.min(65536,GRAPH_LIMITS.maxBytes+1025-total));const {bytesRead}=await handle.read(chunk);if(!bytesRead)break;total+=bytesRead;if(total>GRAPH_LIMITS.maxBytes+1024)throw new Error('graph read bound');chunks.push(chunk.subarray(0,bytesRead));}
            return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))) as unknown;
        }finally{await handle.close();}
    }
    private async immutable(dir:string,name:string,payload:unknown,conflict:string):Promise<void>{
        const text=canonical(payload);if(Buffer.byteLength(text)>GRAPH_LIMITS.maxBytes+1024)throw new GraphError('GRAPH_STORAGE_LIMIT',413);
        const tmp=path.join(dir,`.${randomUUID()}.tmp`);
        try{
            await fs.writeFile(tmp,text,{flag:'wx',mode:0o600});
            try{await fs.link(tmp,path.join(dir,name));}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;if(canonical(await this.read(dir,name))!==text)throw new GraphError(conflict,409);}
        }finally{await fs.rm(tmp,{force:true});}
    }
    async publish(value:GraphDocument):Promise<void>{
        const doc=validatedSnapshot(value,validateGraph),s=doc.snapshot;
        try{const prior=await this.get(s.projectId,s.analysisId);if(prior.snapshot.snapshotId!==s.snapshotId)throw new GraphError('GRAPH_SNAPSHOT_CONFLICT',409);if(digest(prior)!==digest(doc))throw new GraphError('GRAPH_ARTIFACT_CONFLICT',409);return;}catch(e){if(!(e instanceof GraphError&&e.code==='GRAPH_NOT_FOUND'))throw e;}
        const dir=await this.directory(s.projectId,s.analysisId,true),documentHash=digest(doc),pointer={schemaVersion:1,projectId:s.projectId,analysisId:s.analysisId,snapshotId:s.snapshotId,documentHash};
        await this.immutable(dir,s.storage.artifact,{documentHash,document:doc},'GRAPH_ARTIFACT_CONFLICT');
        await this.immutable(dir,'summary.json',{documentHash:digest(pointer),pointer},'GRAPH_SNAPSHOT_CONFLICT');
    }
    async get(project:string,analysis:string):Promise<GraphDocument>{
        projectId(project);analysisId(analysis);let pointerRead=false;
        try{
            const dir=await this.directory(project,analysis),index=object(await this.read(dir,'summary.json'),'graph pointer envelope',['documentHash','pointer']);pointerRead=true;
            hash(index.documentHash);const p=object(index.pointer,'graph pointer',['schemaVersion','projectId','analysisId','snapshotId','documentHash']);graphIdentity(p.snapshotId,'gs');hash(p.documentHash);
            if(p.schemaVersion!==1||p.projectId!==project||p.analysisId!==analysis||digest(p)!==index.documentHash)throw new Error('graph pointer ownership');
            const result=object(await this.read(dir,`${p.snapshotId}.graph.json`),'graph envelope',['documentHash','document']);hash(result.documentHash);
            const version=(result.document as GraphDocument)?.snapshot?.graphBuilderVersion;
            if(typeof version==='string'&&version!==GRAPH_VERSION)throw new GraphError('GRAPH_VERSION_INCOMPATIBLE',409);
            validateGraph(result.document);const doc=result.document;
            if(result.documentHash!==p.documentHash||digest(doc)!==p.documentHash||doc.snapshot.snapshotId!==p.snapshotId||doc.snapshot.projectId!==project||doc.snapshot.analysisId!==analysis)throw new Error('graph checksum/ownership');
            return doc;
        }catch(e){
            if(e instanceof GraphError&&e.code==='GRAPH_VERSION_INCOMPATIBLE')throw e;
            if(!pointerRead&&(e as NodeJS.ErrnoException).code==='ENOENT')throw new GraphError('GRAPH_NOT_FOUND',404);
            throw new GraphError('GRAPH_STORAGE_CORRUPT',500);
        }
    }
}
