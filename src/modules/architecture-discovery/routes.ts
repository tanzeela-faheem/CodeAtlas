import { Router,type Response } from 'express';
import { projectId,analysisId,hash,DataValidationError,StorageError } from '../../shared/validation.js';
import { WorkspaceManagerService } from '../respository/services/workspace-manager.service.js';
import { FileProjectStore } from '../respository/services/project-store.js';
import { FileAnalysisStore } from '../analysis/summary-store.js';
import { FileRelationshipStore } from '../relationship-analysis/storage.js';
import { FileResolutionStore } from '../symbol-resolution/storage.js';
import { MetadataClient,type MetadataProvider } from '../symbol-resolution/integration/MetadataClient.js';
import { ResolutionError } from '../symbol-resolution/model.js';
import { RelationshipError } from '../relationship-analysis/model.js';
import { digest } from '../symbol-resolution/integration/contracts.js';
import { ArchitectureError,executionStatus,type ArchitectureAnalysis } from './model.js';
import { FileArchitectureStore } from './storage.js';
import { ArchitectureDiscoveryCoordinator } from './integration/ArchitectureDiscoveryCoordinator.js';
import { normalizedConfiguration } from './engine.js';
import { DEFAULT_CONFIGURATION } from './core/rules.js';
export function architectureSummary(d:ArchitectureAnalysis){return{schemaVersion:d.schemaVersion,analyzerVersion:d.analyzerVersion,artifactId:d.artifactId,provenance:d.provenance,status:d.status,executionStatus:executionStatus(d.coverage),cycleCoverage:d.cycleCoverage,counts:{files:d.coverage.length,availableFiles:d.coverage.filter(f=>f.status==='available').length,components:d.components.length,findings:d.findings.length,dependencies:d.dependencies.length,cycles:d.cycles.length,evaluations:d.evaluations.length,violations:d.violations.length,diagnostics:d.diagnostics.length}};}
export function architectureRoutes(workspaces:WorkspaceManagerService,metadata:MetadataProvider=new MetadataClient()){
 const router=Router(),store=new FileArchitectureStore(workspaces),coordinator=new ArchitectureDiscoveryCoordinator(new FileProjectStore(workspaces),new FileAnalysisStore(workspaces),new FileRelationshipStore(workspaces),new FileResolutionStore(workspaces),metadata,store);
 router.use((req,res,next)=>{if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??'')){res.status(403).json({code:'LOCAL_ONLY'});return;}next();});
 for(const[key,validate]of[['projectId',projectId],['analysisId',analysisId]]as const)router.param(key,(_req,res,next,id:string)=>{try{validate(id);next();}catch{res.status(400).json({code:'INVALID_ARCHITECTURE_ID'});}});
 const failure=(res:Response,error:unknown)=>{if(error instanceof ArchitectureError||error instanceof ResolutionError||error instanceof RelationshipError){res.status(error.httpStatus).json({code:error.code});return;}res.status(error instanceof DataValidationError?422:error instanceof StorageError?500:(error as NodeJS.ErrnoException)?.code==='ENOENT'?404:500).json({code:error instanceof DataValidationError||error instanceof StorageError?'ARCHITECTURE_INPUT_CORRUPT':(error as NodeJS.ErrnoException)?.code==='ENOENT'?'ARCHITECTURE_NOT_FOUND':'ARCHITECTURE_STORAGE_FAILED'});};
 const base='/:projectId/analysis/:analysisId/architecture';
 router.post(base,async(req,res)=>{let configuration;try{const body=req.body===undefined||(req.body!==null&&typeof req.body==='object'&&!Array.isArray(req.body)&&Object.keys(req.body).length===0)?DEFAULT_CONFIGURATION:req.body;configuration=normalizedConfiguration(body);}catch(error){if(error instanceof DataValidationError){res.status(400).json({code:'INVALID_ARCHITECTURE_CONFIGURATION'});return;}failure(res,error);return;}try{res.json(architectureSummary(await coordinator.analyze(String(req.params.projectId),String(req.params.analysisId),configuration)));}catch(error){failure(res,error);}});
 for(const suffix of['','/findings','/violations'])router.get(base+suffix,async(req,res)=>{try{if(Object.keys(req.query).some(k=>k!=='configurationHash'))throw new DataValidationError('query');const configurationHash=req.query.configurationHash??digest(DEFAULT_CONFIGURATION);hash(configurationHash);const doc=await store.get(String(req.params.projectId),String(req.params.analysisId),String(configurationHash));if(suffix==='')res.json(architectureSummary(doc));else if(suffix==='/findings')res.json(doc);else res.json({schemaVersion:1,artifactId:doc.artifactId,provenance:doc.provenance,status:doc.status,executionStatus:executionStatus(doc.coverage),configuration:doc.configuration,evaluations:doc.evaluations,violations:doc.violations,evidence:doc.evidence.filter(e=>doc.evaluations.some(r=>r.evidenceIds.includes(e.id)))});}catch(error){if(error instanceof DataValidationError){res.status(400).json({code:'INVALID_ARCHITECTURE_QUERY'});return;}failure(res,error);}});
 return router;
}
