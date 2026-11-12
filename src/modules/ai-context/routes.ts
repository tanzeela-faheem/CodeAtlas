import { Router } from 'express';
import * as v from '../../shared/validation.js';
import { WorkspaceManagerService } from '../respository/services/workspace-manager.service.js';
import { FileProjectStore } from '../respository/services/project-store.js';
import { FileAnalysisStore } from '../analysis/summary-store.js';
import { SourceReader } from '../analysis/source-reader.js';
import { FileGraphStore } from '../knowledge-graph/storage/GraphStore.js';
import { FileSearchIndexStore } from '../search-engine/storage.js';
import { FileAdvancedIndexStore } from '../search-engine/advanced/storage.js';
import { GraphError } from '../knowledge-graph/model.js';
import { SearchError } from '../search-engine/model.js';
import { ContextError,CONTEXT_LIMITS } from './model.js';
import { parseContextRequest } from './request.js';
import { AIContextCoordinator } from './coordinator.js';
export function contextRoutes(workspaces=new WorkspaceManagerService()){
 const router=Router(),coordinator=new AIContextCoordinator({projects:new FileProjectStore(workspaces),analyses:new FileAnalysisStore(workspaces),graphs:new FileGraphStore(workspaces),search:new FileSearchIndexStore(workspaces),advanced:new FileAdvancedIndexStore(workspaces)},new SourceReader(workspaces));
 router.use((req,res,next)=>{if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??'')){res.status(403).json({code:'LOCAL_ONLY'});return;}res.setHeader('Cache-Control','no-store');next();});
 for(const [key,validator] of [['projectId',v.projectId],['analysisId',v.analysisId]] as const)router.param(key,(_req,res,next,id:string)=>{try{validator(id);next();}catch{res.status(400).json({code:'INVALID_CONTEXT_ID'});}});
 router.post('/:projectId/analysis/:analysisId/ai/context',async(req,res)=>{try{v.object(req.query,'context query',[]);parseContextRequest(req.body);}catch{res.status(400).json({code:'INVALID_CONTEXT_REQUEST'});return;}
 const controller=new AbortController(),abort=()=>controller.abort();req.once('aborted',abort);const close=()=>{if(!res.writableEnded)abort();};res.once('close',close);
 try{const value=await coordinator.create(String(req.params.projectId),String(req.params.analysisId),req.body,controller.signal);if(controller.signal.aborted||res.destroyed)return;const text=JSON.stringify(value);if(Buffer.byteLength(text)>CONTEXT_LIMITS.maxResponseBytes)throw new ContextError('CONTEXT_RESPONSE_LIMIT',413);res.type('application/json').send(text);
 }catch(error){if(controller.signal.aborted||res.destroyed)return;if(error instanceof ContextError||error instanceof GraphError||error instanceof SearchError){res.status(error.httpStatus).json({code:error.code});return;}const missing=(error as NodeJS.ErrnoException)?.code==='ENOENT';res.status(error instanceof v.DataValidationError?422:missing?404:500).json({code:error instanceof v.DataValidationError?'CONTEXT_INPUT_INCOMPATIBLE':missing?'CONTEXT_SCOPE_MISSING':'CONTEXT_RETRIEVAL_FAILED'});
 }finally{req.removeListener('aborted',abort);res.removeListener('close',close);}});
 return router;
}
