/** Test-only composition root. Never registered by the production application. */
import express from 'express';
import {createApp} from '../../../app.js';
import {WorkspaceManagerService} from '../../respository/services/workspace-manager.service.js';
import {FileProjectStore} from '../../respository/services/project-store.js';
import {FileAnalysisStore} from '../../analysis/summary-store.js';
import {SourceReader} from '../../analysis/source-reader.js';
import {FileGraphStore} from '../../knowledge-graph/storage/GraphStore.js';
import {FileSearchIndexStore} from '../../search-engine/storage.js';
import {FileAdvancedIndexStore} from '../../search-engine/advanced/storage.js';
import {AIContextCoordinator} from '../../ai-context/coordinator.js';
import {ReasoningCoordinator} from '../coordinator.js';
import {reasoningRoutes} from '../routes.js';
import {ReasoningError,type LLMProvider} from '../model.js';
import {config,mockProvider} from './helpers.js';
export function makeMockApp(workspaces=new WorkspaceManagerService()){
 const app=express();app.use(express.json({limit:'128kb'}));
 const context=new AIContextCoordinator({projects:new FileProjectStore(workspaces),analyses:new FileAnalysisStore(workspaces),graphs:new FileGraphStore(workspaces),search:new FileSearchIndexStore(workspaces),advanced:new FileAdvancedIndexStore(workspaces)},new SourceReader(workspaces));
 const provider:LLMProvider={...mockProvider(),async generate(input,signal){const data=JSON.parse(input.data);if(data.context.userInput.question==='TEST_PROVIDER_RATE_LIMIT')throw new ReasoningError('AI_RATE_LIMITED',429);const result=await mockProvider().generate(input,signal),answer=JSON.parse(result.text!),records=data.context.repositoryEvidence.records;const edge=records.find((e:any)=>e.kind==='established_relationship');if(edge)answer.claims.push({claimId:'c2',text:'The selected producer records a static relationship.',evidenceIds:[edge.referenceId],qualification:'producer_fact',classifications:[edge.classification],fact:{type:'edge',graphEdgeId:edge.content.graphEdgeId,sourceGraphNodeId:edge.content.sourceGraphNodeId,targetGraphNodeId:edge.content.targetGraphNodeId,edgeKind:edge.content.edgeKind,guarantee:edge.content.guarantee}});const candidate=records.find((e:any)=>e.kind==='candidate_relationship');if(candidate)answer.claims.push({claimId:'c3',text:'This selected candidate remains uncertain.',evidenceIds:[candidate.referenceId],qualification:'uncertain',classifications:['uncertain'],fact:null});return {...result,text:JSON.stringify(answer)};}};
 app.use('/api/projects',reasoningRoutes(workspaces,new ReasoningCoordinator(context,config,()=>provider)));app.use(createApp(workspaces));return app;
}
