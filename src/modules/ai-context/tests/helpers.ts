import { prepared,PROJECT,ANALYSIS } from '../../search-engine/tests/helpers.js';
import { FileAdvancedIndexStore } from '../../search-engine/advanced/storage.js';
import { AdvancedSearchCoordinator } from '../../search-engine/advanced/coordinator.js';
import { AIContextCoordinator } from '../coordinator.js';
export {PROJECT,ANALYSIS};
export async function setupContext(indexes:'none'|'v1'|'v2'='v2'){
 const s=await prepared(),advanced=new FileAdvancedIndexStore(s.workspaces),stores={projects:s.projects,analyses:s.source,graphs:s.store,search:s.search,advanced};
 if(indexes!=='none')await s.searchCoordinator.build(PROJECT,ANALYSIS);if(indexes==='v2')await new AdvancedSearchCoordinator(s.store,s.search,advanced,s.reader,s.searchCoordinator).build(PROJECT,ANALYSIS);
 const graph=await s.store.get(PROJECT,ANALYSIS),node=graph.nodes.find(n=>n.metadataEntityId&&n.displayName==='caller')!;
 const request={schemaVersion:1,userQuestion:'Explain the recorded caller evidence',strategy:'focused',focus:[{type:'entity',entityId:node.metadataEntityId}]};
 return {...s,advanced,stores,graph,node,request,context:new AIContextCoordinator(stores,s.reader)};
}
export async function setupDocumentedContext(){
 const {documentedInput}=await import('./documented-input.js'),{setup}=await import('../../knowledge-graph/tests/test-project.js'),{SourceReader}=await import('../../analysis/source-reader.js'),{FileSearchIndexStore}=await import('../../search-engine/storage.js'),{SearchCoordinator}=await import('../../search-engine/coordinator.js'),fs=await import('node:fs/promises'),path=await import('node:path');
 const s=await setup(documentedInput());await fs.copyFile(new URL('./fixtures/notes.jsx',import.meta.url),path.join(s.f.storage,PROJECT,'repository','notes.jsx'));await s.coordinator.build(PROJECT,ANALYSIS);const reader=new SourceReader(s.workspaces),search=new FileSearchIndexStore(s.workspaces),advanced=new FileAdvancedIndexStore(s.workspaces),stores={projects:s.projects,analyses:s.source,graphs:s.store,search,advanced},baseBuilder=new SearchCoordinator(s.store,reader,search);await baseBuilder.build(PROJECT,ANALYSIS);await new AdvancedSearchCoordinator(s.store,search,advanced,reader,baseBuilder).build(PROJECT,ANALYSIS);
 const graph=await s.store.get(PROJECT,ANALYSIS),node=graph.nodes.find(n=>n.metadataEntityId&&n.displayName==='caller')!,request={schemaVersion:1,userQuestion:'Explain recorded caller evidence',strategy:'focused',focus:[{type:'entity',entityId:node.metadataEntityId}]};return {...s,reader,search,advanced,stores,graph,node,request,context:new AIContextCoordinator(stores,reader)};
}
