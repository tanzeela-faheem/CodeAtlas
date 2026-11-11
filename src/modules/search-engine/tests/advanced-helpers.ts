import { prepared,PROJECT,ANALYSIS } from './helpers.js';
import { FileAdvancedIndexStore } from '../advanced/storage.js';
import { AdvancedSearchCoordinator } from '../advanced/coordinator.js';
import { parseAdvancedRequest } from '../advanced/request.js';
export {PROJECT,ANALYSIS};
export async function advancedPrepared(){const s=await prepared(),advancedStore=new FileAdvancedIndexStore(s.workspaces),advanced=new AdvancedSearchCoordinator(s.store,s.search,advancedStore,s.reader,s.searchCoordinator);return {...s,advancedStore,advanced,query:(raw:unknown)=>advanced.query(PROJECT,ANALYSIS,parseAdvancedRequest(raw))};}
