import { it,expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepared,PROJECT,ANALYSIS } from './helpers.js';
import { buildSearchIndex } from '../builder.js';
import { buildTables } from '../indexing.js';
import { LIMITS,type SearchDocument } from '../model.js';
import { retrieve,parseQuery } from '../query.js';
it('enforces file, document, source-byte, artifact-byte and deadline budgets before publication',async()=>{
 const s=await prepared();try{const graph=await s.store.get(PROJECT,ANALYSIS);for(const policy of [{maxFiles:1},{maxDocuments:1},{maxSourceBytes:1},{maxBytes:1},{maxTerms:1},{maxPostings:1}])await expect(buildSearchIndex(graph,s.reader,Date.now()+60000,{...LIMITS,...policy})).rejects.toMatchObject({code:'SEARCH_RESOURCE_LIMIT'});await expect(s.search.get(PROJECT,ANALYSIS)).rejects.toMatchObject({code:'SEARCH_INDEX_MISSING'});await expect(buildSearchIndex(graph,s.reader,Infinity,{...LIMITS,maxFiles:1001})).rejects.toThrow('Invalid search limits');
 expect(()=>buildTables(Array.from({length:LIMITS.maxDocuments+1},()=>({} as SearchDocument)))).toThrow('SEARCH_RESOURCE_LIMIT');
 }finally{await s.f.cleanup();}
});
it('rejects oversized artifacts and symlinked search storage without accessing unrelated files',async()=>{
 const s=await prepared();try{const index=await s.searchCoordinator.build(PROJECT,ANALYSIS),dir=path.join(s.f.storage,PROJECT,'analysis',ANALYSIS,'search'),file=path.join(dir,`${index.indexId}.search.json`);const outside=path.join(s.f.root,'unrelated.txt');await fs.writeFile(outside,'KEEP');await fs.unlink(file);await fs.symlink(outside,file);await expect(s.search.get(PROJECT,ANALYSIS)).rejects.toMatchObject({code:'SEARCH_STORAGE_CORRUPT'});expect(await fs.readFile(outside,'utf8')).toBe('KEEP');await fs.unlink(file);const handle=await fs.open(file,'w');await handle.truncate(LIMITS.maxBytes+1025);await handle.close();await expect(s.search.get(PROJECT,ANALYSIS)).rejects.toMatchObject({code:'SEARCH_STORAGE_CORRUPT'});
 }finally{await s.f.cleanup();}
});
it('bounds query response bytes rather than returning oversized coverage or text',async()=>{
 const s=await prepared();try{const index=await s.searchCoordinator.build(PROJECT,ANALYSIS);index.diagnostics=['x'.repeat(LIMITS.maxResponseBytes)];expect(()=>retrieve(index,parseQuery({schemaVersion:1,query:'target',mode:'exact'}))).toThrow('SEARCH_RESPONSE_LIMIT');
 }finally{await s.f.cleanup();}
});
