import { Router,type Response } from 'express';
import * as v from '../../shared/validation.js';
import { WorkspaceManagerService } from '../respository/services/workspace-manager.service.js';
import { SourceReader } from '../analysis/source-reader.js';
import { FileGraphStore } from '../knowledge-graph/storage/GraphStore.js';
import { GraphError } from '../knowledge-graph/model.js';
import { FileSearchIndexStore } from './storage.js';
import { SearchCoordinator } from './coordinator.js';
import { LIMITS,SearchError,type SearchIndex } from './model.js';
import { parseQuery,retrieve } from './query.js';
import { FileAdvancedIndexStore } from './advanced/storage.js';
import { AdvancedSearchCoordinator } from './advanced/coordinator.js';
import { parseAdvancedRequest } from './advanced/request.js';
import type { AdvancedIndex } from './advanced/model.js';
function advancedSummary(i:AdvancedIndex){return {schemaVersion:2,builderVersion:i.builderVersion,indexId:i.indexId,baseIndexId:i.baseIndexId,projectId:i.projectId,analysisId:i.analysisId,sourceFiles:i.sources.length,positionCount:i.sources.reduce((n,s)=>n+s.positions.length,0),coverage:i.coverage,provenance:i.provenance};}
export function summary(i:SearchIndex){return {schemaVersion:i.schemaVersion,builderVersion:i.builderVersion,indexId:i.indexId,projectId:i.projectId,analysisId:i.analysisId,status:i.status,documentCount:i.documents.length,termCount:i.tables.lexical.length,coverage:i.coverage,provenance:i.provenance,diagnostics:i.diagnostics};}
export function searchRoutes(workspaces=new WorkspaceManagerService()){
 const router=Router(),store=new FileSearchIndexStore(workspaces),graphs=new FileGraphStore(workspaces),reader=new SourceReader(workspaces),coordinator=new SearchCoordinator(graphs,reader,store),advanced=new AdvancedSearchCoordinator(graphs,store,new FileAdvancedIndexStore(workspaces),reader,coordinator);
 router.use((req,res,next)=>{if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??'')){res.status(403).json({code:'LOCAL_ONLY'});return;}res.setHeader('Cache-Control','no-store');next();});
 for(const [key,validator] of [['projectId',v.projectId],['analysisId',v.analysisId]] as const)router.param(key,(_req,res,next,id:string)=>{try{validator(id);next();}catch{res.status(400).json({code:'INVALID_SEARCH_ID'});}});
 const send=(res:Response,value:unknown)=>{const text=JSON.stringify(value);if(Buffer.byteLength(text)>LIMITS.maxResponseBytes)throw new SearchError('SEARCH_RESPONSE_LIMIT',413);res.type('application/json').send(text);};
 const fail=(res:Response,e:unknown)=>{if(e instanceof SearchError||e instanceof GraphError){res.status(e.httpStatus).json({code:e.code});return;}res.status(e instanceof v.DataValidationError?422:500).json({code:e instanceof v.DataValidationError?'SEARCH_INPUT_INCOMPATIBLE':'SEARCH_STORAGE_FAILED'});};
 const base='/:projectId/analysis/:analysisId/search';
 router.post(base+'/index',async(req,res)=>{const isV2=req.body?.schemaVersion===2;try{if(isV2)v.object(req.body,'advanced build',['schemaVersion']);else v.object(req.body??{},'build',[]);v.object(req.query,'query',[]);}catch{res.status(400).json({code:'INVALID_SEARCH_REQUEST'});return;}try{send(res,isV2?advancedSummary(await advanced.build(String(req.params.projectId),String(req.params.analysisId))):summary(await coordinator.build(String(req.params.projectId),String(req.params.analysisId))));}catch(e){fail(res,e);}});
 router.get(base,async(req,res)=>{const isV2=req.query.schemaVersion==='2';try{if(isV2)v.object(req.query,'query',['schemaVersion']);else v.object(req.query,'query',[]);}catch{res.status(400).json({code:'INVALID_SEARCH_REQUEST'});return;}try{send(res,isV2?advancedSummary((await advanced.load(String(req.params.projectId),String(req.params.analysisId))).index):summary(await store.get(String(req.params.projectId),String(req.params.analysisId))));}catch(e){fail(res,e);}});
 router.post(base+'/query',async(req,res)=>{let q;const isV2=req.body?.schemaVersion===2;try{v.object(req.query,'query',[]);q=isV2?parseAdvancedRequest(req.body):parseQuery(req.body);}catch{res.status(400).json({code:'INVALID_SEARCH_QUERY'});return;}try{if(q.schemaVersion===2)send(res,await advanced.query(String(req.params.projectId),String(req.params.analysisId),q));else send(res,retrieve(await store.get(String(req.params.projectId),String(req.params.analysisId)),q));}catch(e){fail(res,e);}});
 return router;
}
