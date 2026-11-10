import { Router, type Response } from 'express';
import * as v from '../../shared/validation.js';
import { WorkspaceManagerService } from '../respository/services/workspace-manager.service.js';
import { FileProjectStore } from '../respository/services/project-store.js';
import { FileAnalysisStore } from '../analysis/summary-store.js';
import { FileAstStore } from '../ast-management/store.js';
import { FileResolutionStore } from '../symbol-resolution/storage.js';
import { FileRelationshipStore } from '../relationship-analysis/storage.js';
import { MetadataClient, type MetadataProvider } from '../symbol-resolution/integration/MetadataClient.js';
import { ResolutionError } from '../symbol-resolution/model.js';
import { RelationshipError } from '../relationship-analysis/model.js';
import { GraphError } from './model.js';
import { FileGraphStore } from './storage/GraphStore.js';
import { GraphCoordinator } from './integration/GraphCoordinator.js';
import { GraphIndex } from './core/GraphIndex.js';
import { GraphQueryEngine } from './core/GraphQueryEngine.js';
import { GraphTraversalEngine } from './core/GraphTraversalEngine.js';
export const MAX_GRAPH_RESPONSE_BYTES=1024*1024;
function send(res:Response,value:unknown):void {
    const text=JSON.stringify(value);if(Buffer.byteLength(text)>MAX_GRAPH_RESPONSE_BYTES)throw new GraphError('GRAPH_RESPONSE_LIMIT',413);
    res.type('application/json').send(text);
}
function query(raw:unknown):Record<string,unknown>{
    v.check(raw!==null&&typeof raw==='object'&&!Array.isArray(raw),'graph query');
    const result={...raw as Record<string,unknown>};
    for(const key of ['offset','limit'])if(result[key]!==undefined){v.string(result[key],key);v.check(/^\d{1,6}$/.test(result[key]),'numeric query');result[key]=Number(result[key]);}
    return result;
}
export function graphRoutes(workspaces:WorkspaceManagerService,metadata:MetadataProvider=new MetadataClient()){
    const router=Router(),store=new FileGraphStore(workspaces);
    const coordinator=new GraphCoordinator(new FileProjectStore(workspaces),new FileAnalysisStore(workspaces),new FileAstStore(workspaces),new FileResolutionStore(workspaces),new FileRelationshipStore(workspaces),metadata,store);
    router.use((req,res,next)=>{if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??'')){res.status(403).json({code:'LOCAL_ONLY'});return;}next();});
    for(const [key,validator] of [['projectId',v.projectId],['analysisId',v.analysisId]] as const)router.param(key,(_req,res,next,id:string)=>{try{validator(id);next();}catch{res.status(400).json({code:'INVALID_GRAPH_ID'});}});
    const fail=(res:Response,e:unknown)=>{
        if(e instanceof GraphError||e instanceof ResolutionError||e instanceof RelationshipError){res.status(e.httpStatus).json({code:e.code});return;}
        if(e instanceof v.DataValidationError){res.status(422).json({code:'GRAPH_INPUT_INCOMPATIBLE'});return;}
        res.status(500).json({code:'GRAPH_STORAGE_FAILED'});
    };
    const base='/:projectId/analysis/:analysisId/graph';
    router.post(base,async(req,res)=>{
        try{v.object(req.body??{},'graph build',[]);v.object(req.query,'graph build query',[]);}catch{res.status(400).json({code:'INVALID_GRAPH_REQUEST'});return;}
        try{send(res,(await coordinator.build(String(req.params.projectId),String(req.params.analysisId))).snapshot);}catch(e){fail(res,e);}
    });
    router.get(base,async(req,res)=>{
        try{v.object(req.query,'graph status query',[]);}catch{res.status(400).json({code:'INVALID_GRAPH_QUERY'});return;}
        try{send(res,(await store.get(String(req.params.projectId),String(req.params.analysisId))).snapshot);}catch(e){fail(res,e);}
    });
    for(const suffix of ['/nodes','/nodes/:nodeId','/nodes/:nodeId/neighbors','/edges','/candidates'])router.get(base+suffix,async(req,res)=>{
        try{
            const doc=await store.get(String(req.params.projectId),String(req.params.analysisId)),engine=new GraphQueryEngine(new GraphIndex(doc));let value:unknown;
            try{
                const q=query(req.query);
                if(suffix==='/nodes')value=engine.nodes(q);
                else if(suffix==='/edges')value=engine.edges(q);
                else if(suffix==='/candidates')value=engine.candidates(q);
                else if(suffix.endsWith('/neighbors'))value=engine.neighbors(req.params.nodeId,q);
                else{v.object(q,'node lookup query',[]);value=engine.node(req.params.nodeId);}
            }catch(e){if(e instanceof v.DataValidationError){res.status(400).json({code:'INVALID_GRAPH_QUERY'});return;}throw e;}
            send(res,value);
        }catch(e){fail(res,e);}
    });
    router.post(base+'/traverse',async(req,res)=>{
        try{
            const doc=await store.get(String(req.params.projectId),String(req.params.analysisId));let value:unknown;
            try{v.object(req.query,'traversal query',[]);value=new GraphTraversalEngine(new GraphIndex(doc)).traverse(req.body);}catch(e){if(e instanceof v.DataValidationError){res.status(400).json({code:'INVALID_GRAPH_TRAVERSAL'});return;}throw e;}
            send(res,value);
        }catch(e){fail(res,e);}
    });
    return router;
}
