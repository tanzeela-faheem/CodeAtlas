import {Router} from 'express';
import * as v from '../../shared/validation.js';
import {WorkspaceManagerService} from '../respository/services/workspace-manager.service.js';
import {FileProjectStore} from '../respository/services/project-store.js';
import {FileAnalysisStore} from '../analysis/summary-store.js';
import {SourceReader} from '../analysis/source-reader.js';
import {FileGraphStore} from '../knowledge-graph/storage/GraphStore.js';
import {FileSearchIndexStore} from '../search-engine/storage.js';
import {FileAdvancedIndexStore} from '../search-engine/advanced/storage.js';
import {AIContextCoordinator} from '../ai-context/coordinator.js';
import {ContextError} from '../ai-context/model.js';
import {GraphError} from '../knowledge-graph/model.js';
import {SearchError} from '../search-engine/model.js';
import {ReasoningCoordinator} from './coordinator.js';
import {ReasoningError} from './model.js';
import {parseReasoningRequest} from './request.js';
export function reasoningRoutes(workspaces=new WorkspaceManagerService(),injected?:ReasoningCoordinator){
 const router=Router(),coordinator=injected??new ReasoningCoordinator(new AIContextCoordinator({projects:new FileProjectStore(workspaces),analyses:new FileAnalysisStore(workspaces),graphs:new FileGraphStore(workspaces),search:new FileSearchIndexStore(workspaces),advanced:new FileAdvancedIndexStore(workspaces)},new SourceReader(workspaces)));
 router.use((req,res,next)=>{if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??'')){res.status(403).json({code:'LOCAL_ONLY'});return;}res.setHeader('Cache-Control','no-store');next();});
 for(const [key,validator] of [['projectId',v.projectId],['analysisId',v.analysisId]] as const)router.param(key,(_req,res,next,id:string)=>{try{validator(id);next();}catch{res.status(400).json({code:'INVALID_REASONING_ID'});}});
 router.post('/:projectId/analysis/:analysisId/ai/answer',async(req,res)=>{
  try{v.object(req.query,'query',[]);parseReasoningRequest(req.body);}catch{res.status(400).json({code:'INVALID_REASONING_REQUEST'});return;}
  const controller=new AbortController(),abort=()=>controller.abort(),close=()=>{if(!res.writableEnded)abort();};req.once('aborted',abort);res.once('close',close);
  try{const value=await coordinator.answer(String(req.params.projectId),String(req.params.analysisId),req.body,controller.signal);if(!res.destroyed&&!controller.signal.aborted)res.json(value);}
  catch(error){if(res.destroyed||controller.signal.aborted)return;if(error instanceof ReasoningError||error instanceof ContextError||error instanceof GraphError||error instanceof SearchError){res.status(error.httpStatus).json({code:error.code});return;}const missing=(error as NodeJS.ErrnoException)?.code==='ENOENT';res.status(error instanceof v.DataValidationError?422:missing?404:500).json({code:error instanceof v.DataValidationError?'AI_CONTEXT_INCOMPATIBLE':missing?'AI_SCOPE_MISSING':'AI_RETRIEVAL_FAILED'});}
  finally{req.removeListener('aborted',abort);res.removeListener('close',close);}
 });return router;
}
