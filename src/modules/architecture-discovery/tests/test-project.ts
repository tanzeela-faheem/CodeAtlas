import { fixture as temporary } from '../../../test/fixtures.js';
import { WorkspaceManagerService } from '../../respository/services/workspace-manager.service.js';
import { FileProjectStore } from '../../respository/services/project-store.js';
import { FileAnalysisStore } from '../../analysis/summary-store.js';
import { FileAstStore } from '../../ast-management/store.js';
import { FileResolutionStore } from '../../symbol-resolution/storage.js';
import { FileRelationshipStore } from '../../relationship-analysis/storage.js';
import { RelationshipCoordinator } from '../../relationship-analysis/integration/RelationshipCoordinator.js';
import { validateAnalysisSummary } from '../../analysis/summary-validation.js';
import { validateResolutionAnalysis } from '../../symbol-resolution/validation.js';
import { validateMetadataAnalysis } from '../../symbol-resolution/integration/contracts.js';
import { FileArchitectureStore } from '../storage.js';
import { ArchitectureDiscoveryCoordinator } from '../integration/ArchitectureDiscoveryCoordinator.js';
import { fixture,json } from './test-evidence.js';
import { input } from './test-input.js';
export const PROJECT='PRJ-123ABC',ANALYSIS='AN-00000000-0000-0000-0000-000000000001';
export async function setup(unsupported=false){
 const f=await temporary(),workspaces=new WorkspaceManagerService(f.storage),ws=await workspaces.createWorkspace(PROJECT),projects=new FileProjectStore(workspaces),source=new FileAnalysisStore(workspaces),asts=new FileAstStore(workspaces),resolutions=new FileResolutionStore(workspaces),relationships=new FileRelationshipStore(workspaces),store=new FileArchitectureStore(workspaces);
 const sourceAnalysis=json('source-analysis');validateAnalysisSummary(sourceAnalysis);await source.save(sourceAnalysis);const resolutionAnalysis=json('resolution-analysis');validateResolutionAnalysis(resolutionAnalysis);const metadataAnalysis=json('metadata-analysis');validateMetadataAnalysis(metadataAnalysis);
 const fixtures=['billing_model','billing_service','events','library_only','misleading_emit'].map(fixture);
 for(const e of fixtures){await asts.save(e.ast);await resolutions.saveFile(e.resolution);}await resolutions.saveAnalysis(resolutionAnalysis);
 const calls={analysis:0,document:0};const provider={analysis:async()=>{calls.analysis++;return structuredClone(metadataAnalysis);},document:async(_p:string,_a:string,id:string)=>{calls.document++;return structuredClone(fixtures.find(e=>e.doc.inputs.metadataArtifact.artifactId===id)!.metadata);}};
 await new RelationshipCoordinator(source,asts,resolutions,provider,relationships,unsupported?[]:undefined).analyze(PROJECT,ANALYSIS);calls.analysis=0;calls.document=0;
 const profile=input(sourceAnalysis.files.map(f=>f.relativePath)).profile;profile.detectedAt=sourceAnalysis.startedAt;for(const x of[profile.languages,profile.buildSystems,profile.packageManagers,profile.structure,profile.multiLanguage])x.detectedAt=sourceAnalysis.startedAt;for(const file of profile.languages.sourceFiles)file.contentHash=fixtures.find(e=>e.ast.relativePath===file.relativePath)!.ast.contentHash;
 await projects.save({schemaVersion:1,createdAt:sourceAnalysis.startedAt,updatedAt:sourceAnalysis.startedAt,result:{projectId:PROJECT,projectName:profile.projectName,sourceType:'local',status:'imported',workspacePath:ws.workspacePath,repositoryPath:ws.repositoryPath,importedAt:sourceAnalysis.startedAt,message:'Fixture import',projectProfile:profile}});
 return{f,workspaces,projects,source,asts,resolutions,relationships,store,provider,calls,coordinator:new ArchitectureDiscoveryCoordinator(projects,source,relationships,resolutions,provider,store)};
}
