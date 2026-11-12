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
import {ModuleCoordinator} from '../coordinator.js';
import {FileModuleStore} from '../storage.js';
import type {ModuleInput} from '../model.js';
export const PROJECT='PRJ-123ABC',ANALYSIS='AN-00000000-0000-0000-0000-000000000001';
export function producerInput():ModuleInput{return JSON.parse(readFileSync(new URL('./fixtures/producer-input.json',import.meta.url),'utf8')).input;}
export async function setup(){const input=producerInput(),f=await fixture(),workspaces=new WorkspaceManagerService(f.storage),ws=await workspaces.createWorkspace(PROJECT),projects=new FileProjectStore(workspaces),source=new FileAnalysisStore(workspaces),asts=new FileAstStore(workspaces),resolution=new FileResolutionStore(workspaces),reader=new SourceReader(workspaces),store=new FileModuleStore(workspaces);
 await projects.save({schemaVersion:1,createdAt:input.source.startedAt,updatedAt:input.source.startedAt,result:{projectId:PROJECT,projectName:'Module fixture',sourceType:'local',status:'imported',workspacePath:ws.workspacePath,repositoryPath:ws.repositoryPath,importedAt:input.source.startedAt,message:'Controlled fixture'}});await source.save(input.source);
 for(const file of input.files){if(file.ast)await asts.save(file.ast);if(file.resolution)await resolution.saveFile(file.resolution);if(file.source!==null){const target=path.join(ws.repositoryPath,file.relativePath);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,file.source);}}
 await resolution.saveAnalysis(input.resolution);const inputs={projects,source,asts,resolution,reader};return {f,input,workspaces,ws,inputs,store,coordinator:new ModuleCoordinator(inputs,store)};
}
