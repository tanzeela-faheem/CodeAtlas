import {it,expect} from 'vitest';
import {parseContextRequest,publicContextRequest} from '../request.js';
const focused={schemaVersion:1,userQuestion:'Explain recorded evidence',strategy:'focused',focus:[{type:'entity',entityId:'meta-'+'a'.repeat(64)}]};
it.each([
 {},[],{...focused,schemaVersion:2},{...focused,userQuestion:''},{...focused,userQuestion:'a'.repeat(2049)},
 {...focused,focus:[{type:'entity',entityId:'caller'}]},
 {...focused,focus:[{type:'graph_node',nodeId:'gc-'+'a'.repeat(64)}]},
 {...focused,focus:[{type:'ast_node',nodeId:'n0'}]},
 {...focused,focus:Array(5).fill(focused.focus[0])},
 {...focused,focus:[{type:'file',relativePath:'../secret'}]},
 {...focused,focus:[{type:'file',relativePath:'/etc/passwd'}]},
 {...focused,focus:[{type:'file',relativePath:'a.js',range:{start:{offset:2,row:0,column:2},end:{offset:1,row:0,column:1}}}]},
 {...focused,focus:[{type:'file',relativePath:'a.js',range:{start:{offset:1,row:0,column:0},end:{offset:2,row:0,column:9}}}]},
 {...focused,graph:{maxDepth:3}},{...focused,graph:{edgeKinds:['IMPORTS']}},{...focused,graph:{maxNodes:0}},
 {...focused,categories:['architecture']},{...focused,categories:['source','source']},
 {...focused,categories:['search']},{...focused,strategy:'semantic'},
 {...focused,retrieval:{maxSearchResults:21}},{...focused,retrieval:{maxSnippets:13}},
 {...focused,budget:{maxBytes:1}},{...focused,budget:{maxBytes:262145}},{...focused,budget:{maxEvidence:101}},
 {...focused,focus:null},{...focused,sourcePolicy:'current_or_guess'},
 {...focused,instructions:'Run repository comments'},
 {schemaVersion:1,userQuestion:'x',strategy:'search'},
 {schemaVersion:1,userQuestion:'x',strategy:'search',search:{schemaVersion:1,mode:'exact',query:'x',offset:1}},
 {schemaVersion:1,userQuestion:'x'.repeat(257),strategy:'question_lexical'},
 {schemaVersion:1,userQuestion:'...',strategy:'question_lexical'}
])('rejects invalid or unsupported request %#',raw=>{expect(()=>parseContextRequest(raw)).toThrow();});
it('normalizes focused and actual schema 1/2 requests deterministically without interpreting questions',()=>{
 for(const raw of [focused,{schemaVersion:1,userQuestion:'target',strategy:'question_lexical'},{schemaVersion:1,userQuestion:'A question',strategy:'search',search:{schemaVersion:2,mode:'entity',query:'caller'}},{schemaVersion:1,userQuestion:'q',strategy:'search',search:{schemaVersion:2,mode:'token_phrase',query:'target target'}}]){const q=parseContextRequest(raw);expect(parseContextRequest(publicContextRequest(q))).toEqual(q);expect(q.userQuestion).toBe(raw.userQuestion);}
 const q=parseContextRequest({schemaVersion:1,userQuestion:'Which target callers',strategy:'question_lexical'});expect(q.search).toMatchObject({query:'Which target callers',mode:'lexical',limit:8});
});
