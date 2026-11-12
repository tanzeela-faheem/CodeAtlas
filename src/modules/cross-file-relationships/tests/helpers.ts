import {buildBindings} from '../../cross-file-binding/builder.js';
import {CrossRelationshipCoordinator} from '../coordinator.js';
import {FileCrossRelationshipStore} from '../storage.js';
import {buildModules} from '../../module-linking/builder.js';
import {BindingCoordinator} from '../../cross-file-binding/coordinator.js';
import {FileBindingStore} from '../../cross-file-binding/storage.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {fixture} from '../../../test/fixtures.js';
import {WorkspaceManagerService} from '../../respository/services/workspace-manager.service.js';
import {FileProjectStore} from '../../respository/services/project-store.js';
import {FileAnalysisStore} from '../../analysis/summary-store.js';
import {FileAstStore} from '../../ast-management/store.js';
import {SourceReader} from '../../analysis/source-reader.js';
import {FileResolutionStore} from '../../symbol-resolution/storage.js';
import {ModuleCoordinator} from '../../module-linking/coordinator.js';
import {FileModuleStore} from '../../module-linking/storage.js';
import type {ModuleInput} from '../../module-linking/model.js';
export const PROJECT='PRJ-123ABC',ANALYSIS='AN-00000000-0000-0000-0000-000000000001';
export function producerInput():ModuleInput{return JSON.parse(readFileSync(new URL('./fixtures/producer-input.json',import.meta.url),'utf8')).input;}
export async function setup(publishPhase1=true,publishPhase2=true){const input=JSON.parse(readFileSync(new URL('./fixtures/storage-input.json',import.meta.url),'utf8')).input as ModuleInput,f=await fixture(),workspaces=new WorkspaceManagerService(f.storage),ws=await workspaces.createWorkspace(PROJECT),projects=new FileProjectStore(workspaces),source=new FileAnalysisStore(workspaces),asts=new FileAstStore(workspaces),resolution=new FileResolutionStore(workspaces),reader=new SourceReader(workspaces),store=new FileModuleStore(workspaces);
 await projects.save({schemaVersion:1,createdAt:input.source.startedAt,updatedAt:input.source.startedAt,result:{projectId:PROJECT,projectName:'Module fixture',sourceType:'local',status:'imported',workspacePath:ws.workspacePath,repositoryPath:ws.repositoryPath,importedAt:input.source.startedAt,message:'Controlled fixture'}});await source.save(input.source);
 for(const file of input.files){if(file.ast)await asts.save(file.ast);if(file.resolution)await resolution.saveFile(file.resolution);if(file.source!==null){const target=path.join(ws.repositoryPath,file.relativePath);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,file.source);}}
 await resolution.saveAnalysis(input.resolution);const moduleInputs={projects,source,asts,resolution,reader},phase1=buildModules(input);if(publishPhase1)await store.publish(phase1);const inputs={projects,source,resolution,modules:store},bindingStore=new FileBindingStore(workspaces);const phase2=buildBindings(phase1);if(publishPhase2)await bindingStore.publish(phase2);const relationshipInputs={...inputs,bindings:bindingStore},relationshipStore=new FileCrossRelationshipStore(workspaces);return {f,input,workspaces,ws,inputs:relationshipInputs,moduleStore:store,bindingStore,moduleCoordinator:new ModuleCoordinator(moduleInputs,store),bindingCoordinator:new BindingCoordinator(inputs,bindingStore),phase1,phase2,store:relationshipStore,coordinator:new CrossRelationshipCoordinator(relationshipInputs,relationshipStore)};
}
