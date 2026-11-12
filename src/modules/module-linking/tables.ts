import {recordId} from './extraction.js';
import {bound,checkpoint,type ModuleRecord,type ExportRecord,type ImportRecord,type ExportEntry,type Candidate,type Origin,type ImportLink,type Diagnostic,type Limits,type Status} from './model.js';
export function linkTables(modules:ModuleRecord[],imports:ImportRecord[],exports:ExportRecord[],unknown:Set<string>,limits:Limits,deadline:number,signal?:AbortSignal){
 const byModule=new Map(modules.map(m=>[m.id,m])),explicit=new Map<string,Map<string,ExportRecord[]>>(),stars=new Map<string,ExportRecord[]>(),names=new Map(modules.map(m=>[m.id,new Set<string>()])),complete=new Map(modules.map(m=>[m.id,m.syntaxComplete&&!unknown.has(m.id)]));let operations=0;
 const work=()=>{bound(++operations<=limits.maxStates);checkpoint(deadline,signal);};
 for(const e of exports){if(e.form==='star'){const list=stars.get(e.moduleId)??[];list.push(e);stars.set(e.moduleId,list);}else if(e.exportedName!==null){const map=explicit.get(e.moduleId)??new Map<string,ExportRecord[]>(),list=map.get(e.exportedName)??[];list.push(e);map.set(e.exportedName,list);explicit.set(e.moduleId,map);names.get(e.moduleId)!.add(e.exportedName);}}
 let changed=true;while(changed){changed=false;for(const m of modules)for(const star of stars.get(m.id)??[]){work();const target=star.source?.status==='established'?star.source.targetModuleId:null;if(!target||!complete.get(target)){if(complete.get(m.id)){complete.set(m.id,false);changed=true;}}if(target)for(const name of names.get(target)??[]){work();if(name!=='default'&&!names.get(m.id)!.has(name)){names.get(m.id)!.add(name);changed=true;}}}bound([...names.values()].reduce((n,set)=>n+set.size,0)<=limits.maxExportEntries);}
 const entries:ExportEntry[]=[],cache=new Map<string,ExportEntry>(),diagnostics:Diagnostic[]=[];
 const key=(module:string,name:string)=>JSON.stringify([module,name]);
 function resolve(moduleId:string,exportedName:string):ExportEntry{
  const initialKey=key(moduleId,exportedName),cached=cache.get(initialKey);if(cached)return cached;
  const candidates=new Map<string,Candidate>(),codes=new Set<string>(),blockers:Status[]=[],visited=new Set<string>();let cycleEncountered=false,alternateRoutes=false,truncated=false,duplicate=false;
  const queue=[{module:moduleId,name:exportedName,chain:[] as string[],states:[] as string[],depth:0}];
  for(let index=0;index<queue.length;index++){
   work();const state=queue[index]!,stateKey=key(state.module,state.name);
   if(state.states.includes(stateKey)){cycleEncountered=true;continue;}
   if(visited.has(stateKey)){alternateRoutes=true;continue;}visited.add(stateKey);
   const m=byModule.get(state.module)!;if(!m.syntaxComplete){blockers.push('partial_evidence');codes.add('TARGET_MODULE_SYNTAX_INCOMPLETE');}
   const direct=explicit.get(state.module)?.get(state.name),records=direct??(state.name==='default'?[]:stars.get(state.module)??[]);
   if(direct&&direct.length>1){duplicate=true;codes.add('DUPLICATE_EXPLICIT_EXPORT');}
   if(!records.length&&!complete.get(state.module)){blockers.push('partial_evidence');codes.add('EXPORT_NAME_COVERAGE_INCOMPLETE');}
   for(const record of records){work();const chain=[...state.chain,record.id];if(['named_reexport','star'].includes(record.form)){
     if(record.status!=='established'||record.source?.status!=='established'||!record.source.targetModuleId){blockers.push(record.status);record.codes.forEach(c=>codes.add(c));continue;}
     if(state.depth>=limits.maxDepth){truncated=true;blockers.push('partial_evidence');codes.add('REEXPORT_DEPTH_LIMIT');continue;}
     queue.push({module:record.source.targetModuleId,name:record.form==='star'?state.name:record.importedName!,chain,states:[...state.states,stateKey],depth:state.depth+1});
    }else if(record.status==='established'&&record.origin){const prior=candidates.get(record.origin.key);if(prior){alternateRoutes=true;}else {bound(candidates.size<limits.maxCandidates);candidates.set(record.origin.key,{origin:record.origin,chain});}}
    else {blockers.push(record.status);record.codes.forEach(c=>codes.add(c));}
   }
  }
  const list=[...candidates.values()].sort((a,b)=>a.origin.key<b.origin.key?-1:1);
  const status:Status=duplicate||list.length>1?'ambiguous_export':blockers.includes('ambiguous_export')?'ambiguous_export':blockers.length?(blockers.includes('unsupported_syntax')?'unsupported_syntax':blockers.includes('unsupported_resolution')?'unsupported_resolution':blockers.includes('unresolved_module')?'unresolved_module':'partial_evidence'):list.length===1?'established':'unresolved_export';
  if(status==='unresolved_export')codes.add(cycleEncountered?'REEXPORT_CYCLE_WITHOUT_ORIGIN':'EXPORT_NOT_FOUND');if(status==='ambiguous_export')codes.add('EXPORT_ORIGIN_AMBIGUOUS');if(cycleEncountered)codes.add('REEXPORT_CYCLE_ENCOUNTERED');
  const result:ExportEntry={id:recordId('mt',moduleId,exportedName),moduleId,exportedName,knownName:names.get(moduleId)!.has(exportedName),status,candidates:list,codes:[...codes].sort(),truncated,cycleEncountered,alternateRoutes};cache.set(initialKey,result);return result;
 }
 for(const m of modules)for(const name of [...names.get(m.id)!].sort()){bound(entries.length<limits.maxExportEntries);entries.push(resolve(m.id,name));}
 const links:ImportLink[]=[];
 for(const record of imports){work();let status=record.status,association:ImportLink['association']='none',exportEntryId:string|null=null,candidates:Candidate[]=[],codes=[...record.codes];const target=record.source.targetModuleId;
  if(status==='established'&&target){if(!byModule.get(target)!.syntaxComplete){status='partial_evidence';codes.push('TARGET_MODULE_SYNTAX_INCOMPLETE');}
   else if(record.form==='side_effect')association='side_effect';else if(record.form==='namespace'){association='namespace';const origin:Origin={key:recordId('mo','namespace',target),moduleId:target,kind:'namespace',symbolId:null,declarations:[],namespaceModuleId:target,expressionAstNodeId:null};candidates=[{origin,chain:[]}];}
   else if(record.form==='named'||record.form==='default'){const entry=resolve(target,record.importedName!);if(!entries.some(e=>e.id===entry.id)){bound(entries.length<limits.maxExportEntries);entries.push(entry);}exportEntryId=entry.id;status=entry.status;candidates=entry.candidates;codes=[...new Set([...codes,...entry.codes])];association=status==='established'?'export_binding':'none';}
  }
  links.push({id:recordId('ml',record.id),moduleId:record.moduleId,importId:record.id,targetModuleId:target,exportEntryId,status,association,candidates,codes:codes.sort()});
 }
 for(const m of modules){m.exportComplete=complete.get(m.id)!&&entries.filter(e=>e.moduleId===m.id&&e.knownName).every(e=>e.status==='established'&&!e.truncated);}
 for(const record of [...imports,...exports,...entries,...links]){for(const code of record.codes){bound(diagnostics.length<limits.maxDiagnostics);diagnostics.push({code,moduleId:record.moduleId,recordId:record.id});}}
 return {entries,links,diagnostics,operations};
}
