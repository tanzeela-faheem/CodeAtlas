import fs from 'node:fs/promises';
import path from 'node:path';
import { setup,PROJECT,ANALYSIS } from '../../knowledge-graph/tests/test-project.js';
import { graphInput } from '../../knowledge-graph/tests/test-input.js';
import { SourceReader } from '../../analysis/source-reader.js';
import { FileSearchIndexStore } from '../storage.js';
import { SearchCoordinator } from '../coordinator.js';
export {PROJECT,ANALYSIS};
export async function prepared(){
 const s=await setup(graphInput(true));
 for(const file of s.input.files){const name=file.ast.relativePath;const target=path.join(s.f.storage,PROJECT,'repository',name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(new URL('../../knowledge-graph/tests/fixtures/'+name,import.meta.url),target);}
 await s.coordinator.build(PROJECT,ANALYSIS);const reader=new SourceReader(s.workspaces),search=new FileSearchIndexStore(s.workspaces),coordinator=new SearchCoordinator(s.store,reader,search);
 return {...s,reader,search,searchCoordinator:coordinator};
}
