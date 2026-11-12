import {canonical} from '../symbol-resolution/integration/contracts.js';
import * as v from '../../shared/validation.js';
import {recordId,lookup} from '../module-linking/extraction.js';
import type {ModuleDocument,Origin,Status as ModuleStatus} from '../module-linking/model.js';
import {importSymbol} from './proof.js';
import {bound,checkpoint,type Limits,type Outcome,type Status,type Step,type Candidate,type Target,type ExportAssociation} from './model.js';
export const translate=(s:ModuleStatus):Status=>s==='ambiguous_export'?'ambiguous_target':s==='unresolved_module'?'unresolved_import':s==='unresolved_export'?'unresolved_export':s==='unsupported_syntax'?'unsupported_syntax':s==='unsupported_resolution'?'unsupported_resolution':'partial_evidence';
export function exportResolver(input:ModuleDocument,limits:Limits,deadline:number,signal?:AbortSignal){
 const modules=new Map(input.modules.map(m=>[m.id,m])),files=new Map(input.inputs.files.map(f=>[f.relativePath,f])),records=new Map(input.modules.map(m=>[m.id,input.exports.filter(e=>e.moduleId===m.id)])),entries=new Map(input.exportEntries.map(e=>[JSON.stringify([e.moduleId,e.exportedName]),e])),exportById=new Map(input.exports.map(e=>[e.id,e])),linkByImport=new Map(input.links.map(l=>[l.importId,l]));
 const targets=new Map<string,Target>(),cache=new Map<string,ExportAssociation>();let operations=0,importedLocalSteps=0;
 let outputBytes=Buffer.byteLength(canonical(input));
 const charge=(value:unknown)=>{outputBytes+=Buffer.byteLength(canonical(value));bound(outputBytes<=limits.maxBytes);};
 const work=()=>{bound(++operations<=limits.maxStates);checkpoint(deadline,signal);};
 function target(origin:Origin):Target {
  const id=recordId('ct',input.artifactId,origin.key),previous=targets.get(id);if(previous)return previous;
  bound(targets.size<limits.maxExports);const module=modules.get(origin.moduleId)!,file=files.get(module.relativePath)!,codes:string[]=[];
  v.check(file.ast&&module.astArtifactId,'cross-file origin AST');let status:Status,decl:string|null=null,metadata:string|null=null;
  if(origin.kind==='namespace')status='established_namespace';
  else if(origin.kind==='default_expression'){v.check(file.ast.nodes.some(n=>n.id===origin.expressionAstNodeId),'cross-file expression slot');status='established_export_slot';codes.push('EXPRESSION_SLOT_NOT_CALLEE_IDENTITY');}
  else {const symbol=file.resolution?.symbols.find(s=>s.id===origin.symbolId);v.check(symbol&&symbol.import===null,'cross-file declaration symbol');
   if(origin.declarations.length===1){const d=origin.declarations[0]!;v.check(symbol.declarations.some(x=>x.astNodeId===d.astNodeId&&x.metadataEntityId===d.metadataEntityId),'cross-file exact declaration');decl=d.astNodeId;metadata=d.metadataEntityId;status='established_declaration';}
   else {status='established_export_slot';codes.push('DECLARATION_NOT_UNIQUE');}
  }
  const value:Target={id,moduleId:module.id,relativePath:module.relativePath,origin,status,declarationAstNodeId:decl,metadataEntityId:metadata,expressionAstNodeId:origin.expressionAstNodeId,astArtifactId:module.astArtifactId!,resolutionArtifactId:module.resolutionArtifactId,metadataArtifactId:module.metadataArtifact?.artifactId??null,codes};charge(value);targets.set(id,value);return value;
 }
 function resolve(moduleId:string,name:string):ExportAssociation {
  const root=JSON.stringify([moduleId,name]),prior=cache.get(root);if(prior)return prior;bound(cache.size<limits.maxExports);
  const candidates=new Map<string,Candidate>(),codes=new Set<string>(),blockers:Status[]=[],visited=new Set<string>();let cycleEncountered=false,alternateRoutes=false,truncated=false,duplicate=false;
  const queue=[{moduleId,name,steps:[] as Step[],states:[] as string[],depth:0}];
  const add=(origin:Origin,steps:Step[])=>{const t=target(origin);if(candidates.has(t.id)){alternateRoutes=true;return;}bound(candidates.size<limits.maxCandidates);candidates.set(t.id,{targetId:t.id,originKey:origin.key,steps});};
  for(let cursor=0;cursor<queue.length;cursor++){
   work();const state=queue[cursor]!,key=JSON.stringify([state.moduleId,state.name]);
   if(state.states.includes(key)){cycleEncountered=true;continue;}if(visited.has(key)){alternateRoutes=true;continue;}visited.add(key);
   const module=modules.get(state.moduleId)!;if(!module.syntaxComplete){blockers.push('partial_evidence');codes.add('TARGET_SYNTAX_INCOMPLETE');continue;}
   const phase1=entries.get(key);
   // Reuse an already established Phase 1 witness verbatim when it fits this traversal budget.
   if(phase1?.status==='established'&&phase1.candidates.length===1&&state.depth+Math.max(0,phase1.candidates[0]!.chain.length-1)<=limits.maxDepth){
    const c=phase1.candidates[0]!,steps:Step[]=[];let witnessName=state.name;for(const id of c.chain){const e=exportById.get(id)!;steps.push({kind:'export',moduleId:e.moduleId,exportId:id,exportEntryId:entries.get(JSON.stringify([e.moduleId,witnessName]))?.id??null,importId:null,importLinkId:null,symbolId:null,referenceId:null});if(e.form==='named_reexport')witnessName=e.importedName!;}add(c.origin,[...state.steps,...steps]);alternateRoutes ||= phase1.alternateRoutes;cycleEncountered ||= phase1.cycleEncountered;continue;
   }
   const own=records.get(module.id)!,explicit=own.filter(e=>e.exportedName===state.name),selected=explicit.length?explicit:state.name==='default'?[]:own.filter(e=>e.form==='star');
   if(explicit.length>1){duplicate=true;codes.add('DUPLICATE_EXPLICIT_EXPORT');}
   if(!selected.length){if(state.name==='default'&&!own.some(e=>e.form==='unsupported')){codes.add('DEFAULT_NOT_EXPORTED');continue;}if(phase1?.status&&phase1.status!=='established'){blockers.push(translate(phase1.status));phase1.codes.forEach(c=>codes.add(c));}else if(!module.exportComplete){blockers.push('partial_evidence');codes.add('EXPORT_NAME_COVERAGE_INCOMPLETE');}continue;}
   for(const e of selected){work();const step:Step={kind:'export',moduleId:module.id,exportId:e.id,exportEntryId:phase1?.id??null,importId:null,importLinkId:null,symbolId:null,referenceId:null},steps=[...state.steps,step];
    if(e.status==='established'&&e.origin){add(e.origin,steps);continue;}
    let targetModule:string|null=null,targetName:string|null=null;
    if(e.form==='local'&&e.codes.includes('IMPORTED_LOCAL_EXPORT_DEFERRED')){
     const file=files.get(module.relativePath)!,q=lookup(file),node=q.nodes.get(e.syntax.astNodeId)!,nameNode=q.field(node,'name'),ref=file.resolution?.references.find(r=>r.astNodeId===nameNode?.id&&r.usage==='export');
     const imports=ref?.status==='resolved'?input.imports.filter(i=>i.moduleId===module.id&&i.localSymbolId===ref.symbolId):[],imp=imports.length===1?imports[0]:undefined,symbol=imp?importSymbol(input,imp):null,link=imp?linkByImport.get(imp.id):undefined;
     if(!imp||!symbol||!ref||!link){blockers.push('partial_evidence');codes.add('IMPORTED_LOCAL_PROOF_UNAVAILABLE');continue;}
     if(imp.status!=='established'||imp.source.status!=='established'||!imp.source.targetModuleId){blockers.push(translate(imp.status));imp.codes.forEach(c=>codes.add(c));continue;}
     const importedStep:Step={kind:'imported_local',moduleId:module.id,exportId:e.id,exportEntryId:phase1?.id??null,importId:imp.id,importLinkId:link.id,symbolId:symbol.id,referenceId:ref.id};steps.push(importedStep);importedLocalSteps++;
     if(imp.form==='namespace'){if(link.status==='established'&&link.candidates.length===1)add(link.candidates[0]!.origin,steps);else{blockers.push('partial_evidence');codes.add('NAMESPACE_ORIGIN_UNAVAILABLE');}continue;}
     targetModule=imp.source.targetModuleId;targetName=imp.importedName;
    }else if(['named_reexport','star'].includes(e.form)&&e.status==='established'&&e.source?.status==='established'){
     targetModule=e.source.targetModuleId;targetName=e.form==='star'?state.name:e.importedName;
    }else {blockers.push(translate(e.status));e.codes.forEach(c=>codes.add(c));continue;}
    if(!targetModule||targetName===null){blockers.push('partial_evidence');codes.add('EXPORT_TARGET_UNAVAILABLE');continue;}
    if(state.depth>=limits.maxDepth){truncated=true;blockers.push('partial_evidence');codes.add('CROSS_FILE_DEPTH_LIMIT');continue;}
    queue.push({moduleId:targetModule,name:targetName,steps,states:[...state.states,key],depth:state.depth+1});
   }
  }
  const list=[...candidates.values()].sort((a,b)=>a.targetId<b.targetId?-1:1);
  const status:Status=duplicate||list.length>1||blockers.includes('ambiguous_target')?'ambiguous_target':blockers.length?(blockers.includes('unsupported_syntax')?'unsupported_syntax':blockers.includes('unsupported_resolution')?'unsupported_resolution':blockers.includes('unresolved_import')?'unresolved_import':'partial_evidence'):list.length===1?targets.get(list[0]!.targetId)!.status:'unresolved_export';
  if(!list.length&&!blockers.length)codes.add(cycleEncountered?'CYCLE_WITHOUT_ORIGIN':'EXPORT_NOT_FOUND');if(cycleEncountered)codes.add('CYCLE_ENCOUNTERED');if(status==='ambiguous_target')codes.add('EXPORT_TARGET_AMBIGUOUS');
  const value:ExportAssociation={id:recordId('ce',input.artifactId,moduleId,name),moduleId,relativePath:modules.get(moduleId)!.relativePath,exportedName:name,phase1ExportEntryId:entries.get(root)?.id??null,status,targetId:status.startsWith('established_')?list[0]!.targetId:null,candidates:list,codes:[...codes].sort(),truncated,cycleEncountered,alternateRoutes};charge(value);cache.set(root,value);return value;
 }
 return {resolve,target,work,charge,targets,cache,get importedLocalSteps(){return importedLocalSteps;}};
}
export function outcome(value:Outcome):Outcome {return {status:value.status,targetId:value.targetId,candidates:value.candidates,codes:[...value.codes],truncated:value.truncated,cycleEncountered:value.cycleEncountered,alternateRoutes:value.alternateRoutes};}
export const emptyOutcome=(status:Status,codes:string[]):Outcome=>({status,targetId:null,candidates:[],codes,truncated:false,cycleEncountered:false,alternateRoutes:false});
