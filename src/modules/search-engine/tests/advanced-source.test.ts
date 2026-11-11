import { it,expect } from 'vitest';
import { advancedPrepared,PROJECT,ANALYSIS } from './advanced-helpers.js';
import { retrieveAdvanced } from '../advanced/retrieval.js';
import { parseAdvancedRequest } from '../advanced/request.js';
import { positions,positionalTables,sourceHash } from '../advanced/positions.js';
import { advancedIdentity } from '../advanced/builder.js';
import { validateAdvanced } from '../advanced/validation.js';
import type { AdvancedIndex } from '../advanced/model.js';
async function textFixture(text:string){const s=await advancedPrepared(),index=await s.advanced.build(PROJECT,ANALYSIS),base=await s.search.get(PROJECT,ANALYSIS),graph=await s.store.get(PROJECT,ANALYSIS),source=index.sources[0]!;
 // Deliberate unit fixture for matching only; this synthetic source is not claimed as producer integration.
 const {indexId:oldId,...rest}=index;const replacement={...source,text,contentHash:sourceHash(text),positions:positions(text,new Map())},body:Omit<AdvancedIndex,'indexId'>={...rest,coverage:[{relativePath:source.relativePath,status:'indexed',code:null}],sources:[replacement],...positionalTables([replacement])};
 const unit={...body,indexId:advancedIdentity(body)};validateAdvanced(unit);return {...s,unit,search:(request:Record<string,unknown>)=>retrieveAdvanced(unit,base,graph,parseAdvancedRequest({schemaVersion:2,...request}))};}
it('matches actual consecutive token sequences, repeated terms, parallel occurrences and deterministic pagination',async()=>{
 const s=await advancedPrepared();try{await s.advanced.build(PROJECT,ANALYSIS);const request={schemaVersion:2,mode:'token_phrase',query:'target target'};const result=await s.query(request);expect(result.total).toBeGreaterThan(0);const first=await s.query({...request,limit:1}),second=await s.query({...request,limit:1,offset:1});expect(first.results[0]).toEqual(result.results[0]);if(result.total>1)expect(second.results[0]).toEqual(result.results[1]);expect(await s.query(request)).toEqual(result);expect(result.results.every((r:any)=>r.classification==='token_phrase')).toBe(true);
 }finally{await s.f.cleanup();}
});
it('distinguishes token adjacency from exact text across punctuation, case and whitespace',async()=>{
 const s=await textFixture('User, authentication\r\nUser authentication\nuser\tAUTHENTICATION user auth');try{
 expect(s.search({mode:'token_phrase',query:'user authentication'}).total).toBe(3);const exact=s.search({mode:'text_phrase',query:'User authentication'});expect(exact.total).toBe(1);expect(exact.results[0]!.location.range!.start.offset).toBe(22);expect(s.search({mode:'text_phrase',query:'User, authentication'}).total).toBe(1);expect(s.search({mode:'text_phrase',query:'user authentication'}).total).toBe(0);expect(s.search({mode:'text_phrase',query:'ser authentication'}).total).toBe(1);expect(s.search({mode:'text_phrase',query:'ser authent'}).total).toBe(0);expect(s.search({mode:'token_phrase',query:'UserAuthentication'}).total).toBe(0);
 }finally{await s.f.cleanup();}
});
it('retains repeated token multiplicity, overlaps and bounds grouped occurrence previews',async()=>{
 const s=await textFixture('a a a a\r\na,a a');try{const all=s.search({mode:'token_phrase',query:'a a'});expect(all.total).toBe(6);expect(new Set(all.results.map((r:any)=>r.matchId)).size).toBe(6);const grouped=s.search({mode:'token_phrase',query:'a a',groupBy:'file',occurrenceLimit:2});expect(grouped.total).toBe(1);expect((grouped.results[0] as any).occurrenceCount).toBe(6);expect((grouped.results[0] as any).occurrences).toHaveLength(2);expect((grouped.results[0] as any).occurrencesTruncated).toBe(true);
 }finally{await s.f.cleanup();}
});
it('preserves NFC matching, UTF-16 Unicode/CRLF/mixed endings and end-exclusive source ranges',async()=>{
 const text='😀\r\nconst café = 1;\n// cafe\u0301,next\r\n';const s=await textFixture(text);try{const lexical=s.search({mode:'token_phrase',query:'CAFÉ'});expect(lexical.total).toBe(2);for(const result of lexical.results){const range=result.location.range!;expect(text.slice(range.start.offset,range.end.offset).normalize('NFC')).toBe('café');const prefix=text.slice(0,range.start.offset);expect(range.start.row).toBe(prefix.split('\n').length-1);expect(range.start.column).toBe(prefix.length-prefix.lastIndexOf('\n')-1);}
 const exact=s.search({mode:'text_phrase',query:'café = 1;'});expect(exact.total).toBe(1);expect(exact.results[0]!.location.range!.start).toEqual({offset:10,row:1,column:6});expect(s.search({mode:'text_phrase',query:'café,next'}).total).toBe(0);
 }finally{await s.f.cleanup();}
});
it('separates file-level lexical AND from phrase adjacency and honors row-scoped AND',async()=>{
 const s=await textFixture('UserController first\r\nbilling_records next\nUserController billing_records');try{expect(s.search({mode:'token_phrase',query:'UserController billing_records'}).total).toBe(1);const file=s.search({mode:'file_lexical',query:'user controller billing records'});expect(file.total).toBe(1);expect((file.results[0] as any).occurrenceCount).toBe(4);const path=s.unit.sources[0]!.relativePath;expect(s.search({mode:'file_lexical',query:'user billing',filters:{path,startRow:0,endRow:0}}).total).toBe(0);expect(s.search({mode:'file_lexical',query:'user billing',filters:{path,startRow:2,endRow:2}}).total).toBe(1);
 }finally{await s.f.cleanup();}
});
it('long tokens block adjacency; huge punctuation gaps preserve spans with bounded snippets',async()=>{
 const s=await textFixture('a '+'x'.repeat(257)+' b\na'+'.'.repeat(1000)+'b');try{expect(s.search({mode:'token_phrase',query:'a b'}).total).toBe(1);const result=s.search({mode:'token_phrase',query:'a b'}).results[0] as any;expect(result.occurrences[0].snippet.text.length).toBeLessThan(430);expect(result.occurrences[0].snippet.truncated).toBe(true);expect(result.location.range.end.offset-result.location.range.start.offset).toBe(1002);expect(s.search({mode:'text_phrase',query:'a.b'}).total).toBe(0);
 }finally{await s.f.cleanup();}
});
