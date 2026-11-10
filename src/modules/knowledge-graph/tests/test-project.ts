import { fixture } from '../../../test/fixtures.js';
import { WorkspaceManagerService } from '../../respository/services/workspace-manager.service.js';
import { FileProjectStore } from '../../respository/services/project-store.js';
import { FileAnalysisStore } from '../../analysis/summary-store.js';
import { FileAstStore } from '../../ast-management/store.js';
import { FileResolutionStore } from '../../symbol-resolution/storage.js';
import { FileRelationshipStore } from '../../relationship-analysis/storage.js';
import { FileGraphStore } from '../storage/GraphStore.js';
import { GraphCoordinator } from '../integration/GraphCoordinator.js';
import { GraphError, type GraphInput } from '../model.js';
import { graphInput,PROJECT,ANALYSIS } from './test-input.js';
export async function setup(input:GraphInput=graphInput()){
 const f=await fixture(),workspaces=new WorkspaceManagerService(f.storage),ws=await workspaces.createWorkspace(PROJECT),projects=new FileProjectStore(workspaces),source=new FileAnalysisStore(workspaces),asts=new FileAstStore(workspaces),resolutions=new FileResolutionStore(workspaces),relationships=new FileRelationshipStore(workspaces),store=new FileGraphStore(workspaces);
 await projects.save({schemaVersion:1,createdAt:input.source.startedAt,updatedAt:input.source.startedAt,result:{projectId:PROJECT,projectName:'Graph fixture',sourceType:'local',status:'imported',workspacePath:ws.workspacePath,repositoryPath:ws.repositoryPath,importedAt:input.source.startedAt,message:'Fixture import'}});
 await source.save(input.source);
 for(const e of input.files){await asts.save(e.ast);if(e.resolution)await resolutions.saveFile(e.resolution);if(e.relationships)await relationships.saveFile(e.relationships);}
 await resolutions.saveAnalysis(input.resolutionAnalysis);
 await relationships.saveAnalysis(input.relationshipAnalysis);
 const calls={analysis:0,document:0};let offline=false;
 const provider={analysis:async()=>{calls.analysis++;if(offline)throw new GraphError('OFFLINE');return structuredClone(input.metadataAnalysis);},document:async(_p:string,_a:string,id:string)=>{calls.document++;if(offline)throw new GraphError('OFFLINE');const path=input.metadataAnalysis.files.find(f=>f.metadataArtifact?.artifactId===id)!.relativePath;return structuredClone(input.files.find(f=>f.ast.relativePath===path)!.metadata);}};
 const coordinator=new GraphCoordinator(projects,source,asts,resolutions,relationships,provider,store);
 return{f,workspaces,projects,source,asts,resolutions,relationships,store,provider,calls,coordinator,input,setOffline:()=>{offline=true;}};
}
export {PROJECT,ANALYSIS};
