import * as v from '../../../shared/validation.js';
import { ROLES,type Configuration,type Selector,type Rule,type DependencyRule,type CycleRule,type Dependency,type Evaluation,type Violation,type Component,type DiscoveryInput,type Limits } from '../model.js';
import { detectCycles } from './graph.js';
import { stableId,type Context } from './context.js';
export const DEFAULT_CONFIGURATION:Configuration={schemaVersion:1,rules:[]};
function selector(value:unknown):void{const s=v.object(value,'selector',['kind','values']);v.member(s.kind,['files','entities','roles'],'selector kind');v.array(s.values,'selector values',16);v.check(s.values.length>0&&new Set(s.values).size===s.values.length,'empty/duplicate selector');for(const x of s.values){if(s.kind==='files')v.sourcePath(x);else if(s.kind==='roles')v.member(x,ROLES,'role');else{v.string(x,'entity ID');v.check(/^meta-[a-f0-9]{64}$/.test(x),'entity ID');}}}
export function validateConfiguration(value:unknown):asserts value is Configuration{
 const c=v.object(value,'architecture configuration',['schemaVersion','rules']);v.check(c.schemaVersion===1,'configuration version');v.array(c.rules,'rules',64);const ids=new Set<string>();
 for(const item of c.rules){v.check(item!==null&&typeof item==='object','rule');const type=(item as Record<string,unknown>).type;const r=v.object(item,'rule',['id','type','severity','scope','evidence'],type==='forbid_dependency'?['from','to','kinds']:type==='forbid_cycles'?['selector','kinds']:[]);v.string(r.id,'rule ID',false,64);v.check(/^[A-Za-z][A-Za-z0-9_-]*$/.test(r.id)&&!ids.has(r.id),'rule ID/duplicate');ids.add(r.id);v.string(r.type,'rule type',false,64);v.check(/^[a-z_]+$/.test(r.type),'rule type');v.member(r.severity,['warning','error'],'severity');v.member(r.scope,['observed_local','repository'],'rule scope');v.check(r.evidence==='established_only','evidence threshold');
 if(type==='forbid_dependency'||type==='forbid_cycles'){v.array(r.kinds,'relationship kinds',3);v.check(r.kinds.length>0&&new Set(r.kinds).size===r.kinds.length,'kinds');r.kinds.forEach(k=>v.member(k,['calls','constructs','imports_syntax'],'dependency kind'));if(type==='forbid_dependency'){selector(r.from);selector(r.to);}else selector(r.selector);}
 }
}
export interface RuleContext {components:Component[];fileComponents:Map<string,Component>;input:Pick<DiscoveryInput,'provenance'|'coverage'>&{files:{inputs:DiscoveryInput['files'][number]['inputs']}[]};limits:Pick<Limits,'maxComponents'|'maxDependencies'>;checkpoint():void}
function select(c:RuleContext,s:Selector):Set<string>{
 const files=s.kind==='roles'?new Set([...c.fileComponents.values()].filter(f=>f.roles.some(r=>s.values.includes(r.role))).map(f=>f.name)):new Set(s.kind==='files'?s.values:[]);
 return new Set(c.components.filter(component=>component.kind==='entity'&&(s.kind==='entities'?s.values.includes(component.entityId!):component.files.some(f=>files.has(f)))).map(c=>c.id));
}
export function evaluateRules(c:RuleContext,dependencies:Dependency[],config:Configuration):{evaluations:Evaluation[];violations:Violation[]}{
 validateConfiguration(config);const evaluations:Evaluation[]=[],violations:Violation[]=[];
 for(const rule of [...config.rules].sort((a,b)=>a.id.localeCompare(b.id))){c.checkpoint();let status:Evaluation['status']='indeterminate',deps:Dependency[]=[],components:string[]=[],limitations:string[]=[],explanation='Unsupported rule type; no executable expressions are accepted.';
 if(rule.type==='forbid_dependency'||rule.type==='forbid_cycles'){
  const r=rule as DependencyRule|CycleRule;const from=select(c,r.type==='forbid_dependency'?r.from:r.selector),to=r.type==='forbid_dependency'?select(c,r.to):from;
  components=[...new Set([...from,...to])].sort();
  const relevant=dependencies.filter(d=>from.has(d.from)&&r.kinds.includes(d.kind));
  const selectors=r.type==='forbid_dependency'?[r.from,r.to]:[r.selector];
  // Include requested inventory paths even when no semantic entities could be loaded.
  const selectedFiles=new Set([...c.components.filter(x=>from.has(x.id)||to.has(x.id)).flatMap(x=>x.files),...selectors.flatMap(s=>s.kind==='files'?s.values:[])]);
  const missingSelection=selectors.some(s=>s.kind==='files'?s.values.some(p=>!c.fileComponents.has(p)):s.kind==='entities'?s.values.some(id=>!c.components.some(x=>x.kind==='entity'&&x.entityId===id)):false);
  const incomplete=missingSelection||c.input.coverage.some(f=>selectedFiles.has(f.relativePath)&&(f.status!=='available'||f.upstreamStatus!=='complete'))||c.input.files.some(f=>selectedFiles.has(f.inputs.sourceAst.relativePath)&&(f.inputs.sourceAst.parseStatus!=='success'||f.inputs.metadataArtifact.extractionStatus!=='complete'));
  const heuristic=(r.type==='forbid_dependency'?(r.from.kind==='roles'||r.to.kind==='roles'):r.selector.kind==='roles');
  const established=relevant.filter(d=>d.classification==='established'&&!!d.to);
  const prohibited=r.type==='forbid_dependency'?established.filter(d=>to.has(d.to!)):(()=>{const cycles=detectCycles([...from],established.filter(d=>from.has(d.to!)),c.input.provenance,c.limits.maxComponents,c.limits.maxDependencies);const ids=new Set(cycles.flatMap(c=>c.dependencyIds));return established.filter(d=>ids.has(d.id));})();
  deps=prohibited.length?prohibited:relevant;
  if(!from.size||!to.size){status=c.input.coverage.some(f=>f.status!=='available')?'indeterminate':'not_applicable';explanation='Selectors do not match available entities; absence is not claimed across coverage gaps.';}
  else if(heuristic){status='indeterminate';limitations.push('HEURISTIC_ROLE_SELECTOR');explanation='Role memberships are hypotheses and cannot establish a rule violation or pass.';}
  else if(prohibited.length){components=[...new Set(prohibited.flatMap(d=>[d.from,d.to!]))].sort();status='violation';explanation='Established local dependency evidence is a positive counterexample to this explicit rule.';}
  else if(r.scope==='repository'||incomplete||!relevant.length||relevant.some(d=>d.classification!=='established')){status='indeterminate';explanation='Available evidence cannot establish compliance for the requested scope.';limitations.push(r.scope==='repository'?'REPOSITORY_DEPENDENCIES_INCOMPLETE':incomplete?'PARTIAL_COVERAGE':!relevant.length?'NO_OBSERVATIONS':'UNRESOLVED_DEPENDENCIES');}
  else{status='pass';explanation='All observed local dependencies in the explicit selected scope satisfy this rule; no repository-wide compliance claim.';}
 }else limitations.push('UNSUPPORTED_RULE');
 const data={ruleId:rule.id,status,componentIds:components,dependencyIds:[...new Set(deps.map(d=>d.id))].sort(),evidenceIds:[...new Set(deps.flatMap(d=>d.evidenceIds))].sort(),limitations,explanation};const evaluation={id:stableId('ar',c.input.provenance,data),...data};evaluations.push(evaluation);
 if(status==='violation'){const data={ruleId:rule.id,severity:rule.severity,componentIds:components,dependencyIds:evaluation.dependencyIds,evidenceIds:evaluation.evidenceIds,explanation};violations.push({id:stableId('av',c.input.provenance,data),...data});}
 }
 return{evaluations,violations};
}
