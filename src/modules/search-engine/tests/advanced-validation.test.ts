import { it,expect } from 'vitest';
import { parseAdvancedRequest } from '../advanced/request.js';
it.each([
 {},[],{schemaVersion:2,mode:'entity',query:'x',graph:null},{schemaVersion:2,mode:'entity',query:'x',entity:null},{schemaVersion:2,mode:'regex',query:'x'},
 {schemaVersion:2,mode:'entity'},
 {schemaVersion:2,mode:'text_phrase',query:'...'},
 {schemaVersion:2,mode:'token_phrase',query:'x'.repeat(257)},
 {schemaVersion:2,mode:'token_phrase',query:('x ').repeat(33)},
 {schemaVersion:2,mode:'token_phrase',query:'x',graph:[{nodeId:'gn-'+'a'.repeat(64),edgeKind:'CALLS',direction:'incoming'}]},
 {schemaVersion:2,mode:'file_lexical',query:'x',groupBy:'occurrence'},
 {schemaVersion:2,mode:'file_lexical',query:'x',entity:{name:'x'}},
 {schemaVersion:2,mode:'file_lexical',query:'x',filters:{entityKind:'function'}},
 {schemaVersion:2,mode:'entity',query:'x',entity:{attributes:{async:true}}},
 {schemaVersion:2,mode:'entity',query:'x',entity:{parentMode:'descendant'}},
 {schemaVersion:2,mode:'entity',entity:{parentId:'x'}},
 {schemaVersion:2,mode:'entity',query:'x',graph:[{nodeId:'x',direction:'incoming',edgeKind:'CALLS'}]},
 {schemaVersion:2,mode:'entity',query:'x',graph:[{nodeId:'gn-'+'a'.repeat(64),direction:'both',edgeKind:'CALLS'}]},
 {schemaVersion:2,mode:'entity',query:'x',graph:[{nodeId:'gn-'+'a'.repeat(64),direction:'incoming',edgeKind:'IMPORTS'}]},
 {schemaVersion:2,mode:'entity',query:'x',graph:Array(5).fill({nodeId:'gn-'+'a'.repeat(64),direction:'incoming',edgeKind:'CALLS'})},
 {schemaVersion:2,mode:'entity',query:'x',graph:[{nodeId:'gn-'+'a'.repeat(64),direction:'incoming',edgeKind:'CALLS',neighborKind:'binding'}]},
 {schemaVersion:2,mode:'entity',query:'x',filters:{path:'../bad'}},
 {schemaVersion:2,mode:'entity',query:'x',limit:101},
 {schemaVersion:2,mode:'entity',query:'x',offset:-1},
 {schemaVersion:2,mode:'token_phrase',query:'x',occurrenceLimit:21},
 {schemaVersion:2,mode:'entity',query:'x',groupBy:'file'},
 {schemaVersion:2,mode:'entity',query:'x',filters:{documentKind:'file'}},
 {schemaVersion:2,mode:'entity',query:'x',filters:{startRow:2}}
])('strictly rejects incompatible or excessive advanced request %j',raw=>{expect(()=>parseAdvancedRequest(raw)).toThrow();});
it('accepts bounded structured conjunctions with explicit direct-parent and graph semantics',()=>{const q=parseAdvancedRequest({schemaVersion:2,mode:'entity',query:'UserController',entity:{parentId:'meta-'+'a'.repeat(64),parentMode:'direct'},graph:[{nodeId:'gn-'+'b'.repeat(64),direction:'incoming',edgeKind:'CALLS',neighborKind:'function'}],filters:{path:'src/a.js',startRow:1,endRow:20},offset:1,limit:5});expect(q.match).toBe('lexical');expect(q.groupBy).toBe('entity');expect(q.graph).toHaveLength(1);});
