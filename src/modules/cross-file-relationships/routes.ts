import {Router} from 'express';
import * as v from '../../shared/validation.js';
import {WorkspaceManagerService} from '../respository/services/workspace-manager.service.js';
import {FileProjectStore} from '../respository/services/project-store.js';
import {FileAnalysisStore} from '../analysis/summary-store.js';
import {FileResolutionStore} from '../symbol-resolution/storage.js';
import {ResolutionError} from '../symbol-resolution/model.js';
import {CrossRelationshipCoordinator} from './coordinator.js';
import {BindingError} from '../cross-file-binding/model.js';
import {FileBindingStore} from '../cross-file-binding/storage.js';
import {FileModuleStore} from '../module-linking/storage.js';
import {ModuleError} from '../module-linking/model.js';
import {FileCrossRelationshipStore} from './storage.js';
import {LIMITS,CrossRelationshipError} from './model.js';
import {parseQuery} from './query.js';
export function crossRelationshipRoutes(w=new WorkspaceManagerService()){
 const router=Router(),coordinator=new CrossRelationshipCoordinator({projects:new FileProjectStore(w),source:new FileAnalysisStore(w),resolution:new FileResolutionStore(w),modules:new FileModuleStore(w),bindings:new FileBindingStore(w)},new FileCrossRelationshipStore(w));
 router.use((req,res,next)=>{if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??'')){res.status(403).json({code:'LOCAL_ONLY'});return;}res.setHeader('Cache-Control','no-store');next();});
 for(const [key,validate] of [['projectId',v.projectId],['analysisId',v.analysisId]] as const)router.param(key,(_req,res,next,id:string)=>{try{validate(id);next();}catch{res.status(400).json({code:'INVALID_CROSS_REL_ID'});}});
 const base='/:projectId/analysis/:analysisId/cross-file/relationships';
 for(const [method,suffix,operation] of [['post','/index','build'],['get','','status'],['post','/query','query']] as const)router[method](base+suffix,async(req,res)=>{
  try{v.object(req.query,'cross-relationship query parameters',[]);if(operation==='build')v.object(req.body,'cross-relationship build',[]);if(operation==='query')parseQuery(req.body);}catch{res.status(400).json({code:'INVALID_CROSS_REL_REQUEST'});return;}
  const controller=new AbortController(),abort=()=>controller.abort(),close=()=>{if(!res.writableEnded)abort();};req.once('aborted',abort);res.once('close',close);
  try{const p=String(req.params.projectId),a=String(req.params.analysisId),value=operation==='build'?await coordinator.build(p,a,req.body,controller.signal):operation==='status'?await coordinator.status(p,a):await coordinator.query(p,a,req.body);if(controller.signal.aborted||res.destroyed)return;const text=JSON.stringify(value);if(Buffer.byteLength(text)>LIMITS.maxResponseBytes)throw new CrossRelationshipError('CROSS_REL_RESPONSE_LIMIT',413);res.type('application/json').send(text);}
  catch(e){if(controller.signal.aborted||res.destroyed)return;if(e instanceof CrossRelationshipError||e instanceof BindingError||e instanceof ModuleError||e instanceof ResolutionError){res.status(e.httpStatus).json({code:e.code});return;}if(e instanceof v.StorageError){res.status(500).json({code:e.code});return;}const missing=(e as NodeJS.ErrnoException).code==='ENOENT';res.status(e instanceof v.DataValidationError?422:missing?404:500).json({code:e instanceof v.DataValidationError?'CROSS_REL_INPUT_INCOMPATIBLE':missing?'CROSS_REL_SCOPE_MISSING':'CROSS_REL_BUILD_FAILED'});}
  finally{req.removeListener('aborted',abort);res.removeListener('close',close);}
 });return router;
}
