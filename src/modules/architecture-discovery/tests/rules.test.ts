import { expect,it } from 'vitest';
import { validateConfiguration,evaluateRules } from '../core/rules.js';
import { Context } from '../core/context.js';
import { buildDependencies } from '../core/graph.js';
import { detectLayers } from '../detectors/layers.js';
import { fixture } from './test-evidence.js';
import { input } from './test-input.js';
import type { Configuration,DependencyRule } from '../model.js';
function setup(){const f=fixture('events'),i=input(['events.jsx']);i.files=[f.file];const c=new Context(i);c.initialize();detectLayers(c);return{c,f,deps:buildDependencies(c)};}
const base={id:'local',type:'forbid_dependency',scope:'observed_local',evidence:'established_only',severity:'error',kinds:['calls']} as const;
it('explicit established recursive calls violate only configured rules',()=>{const{c,f,deps}=setup();const entity=f.metadata.entities.find(e=>e.name==='recursive')!;const config:Configuration={schemaVersion:1,rules:[{...base,kinds:['calls'],from:{kind:'entities',values:[entity.entityId]},to:{kind:'entities',values:[entity.entityId]}}]};const result=evaluateRules(c,deps,config);expect(result.evaluations[0]!.status).toBe('violation');expect(result.violations).toHaveLength(1);expect(result.violations[0]!.evidenceIds.length).toBeGreaterThan(0);});
it('allowed observed local dependencies pass only when observed, while repository scope stays indeterminate',()=>{const{c,f,deps}=setup();const entity=f.metadata.entities.find(e=>e.name==='recursive')!,other=f.metadata.entities.find(e=>e.name==='UserController')!;const r:DependencyRule={...base,kinds:['calls'],from:{kind:'entities',values:[entity.entityId]},to:{kind:'entities',values:[other.entityId]}};expect(evaluateRules(c,deps,{schemaVersion:1,rules:[r]}).evaluations[0]!.status).toBe('pass');expect(evaluateRules(c,deps,{schemaVersion:1,rules:[{...r,scope:'repository'}]}).evaluations[0]!.status).toBe('indeterminate');expect(evaluateRules(c,[],{schemaVersion:1,rules:[r]}).evaluations[0]!.status).toBe('indeterminate');});
it('unknown targets, candidate roles and missing selectors never become verified compliance',()=>{const{c,f,deps}=setup();const module=f.metadata.entities.find(e=>e.kind==='module')!,other=f.metadata.entities.find(e=>e.name==='UserController')!;const r:DependencyRule={...base,kinds:['calls'],from:{kind:'entities',values:[module.entityId]},to:{kind:'entities',values:[other.entityId]}};expect(evaluateRules(c,deps,{schemaVersion:1,rules:[r]}).evaluations[0]!.status).toBe('indeterminate');expect(evaluateRules(c,deps,{schemaVersion:1,rules:[{...r,to:{kind:'roles',values:['presentation']}}]}).violations).toEqual([]);expect(evaluateRules(c,deps,{schemaVersion:1,rules:[{...r,from:{kind:'files',values:['absent.js']}}]}).evaluations[0]!.status).toBe('not_applicable');});
it('cycle rules evaluate actual SCC support and unknown rules produce diagnostics, not execution',()=>{const{c,deps}=setup();const result=evaluateRules(c,deps,{schemaVersion:1,rules:[{...base,type:'forbid_cycles',selector:{kind:'files',values:['events.jsx']},kinds:['calls']},{id:'unknown',type:'future_rule',severity:'warning',scope:'repository',evidence:'established_only'}]});expect(result.violations).toHaveLength(1);expect(result.evaluations.find(e=>e.ruleId==='unknown')!.limitations).toContain('UNSUPPORTED_RULE');});
it('rule schemas reject unsafe selectors, duplicate IDs, code and unsupported evidence thresholds',()=>{const valid={schemaVersion:1,rules:[{...base,from:{kind:'files',values:['a.js']},to:{kind:'files',values:['b.js']}}]};expect(()=>validateConfiguration(valid)).not.toThrow();for(const mutate of [(c:any)=>c.rules.push(c.rules[0]),(c:any)=>c.rules[0].from.values=['../escape'],(c:any)=>c.rules[0].from={kind:'regex',values:['.*']},(c:any)=>c.rules[0].expression='process.exit()',(c:any)=>c.rules[0].evidence='candidate',(c:any)=>c.schemaVersion=2]){const c=structuredClone(valid);mutate(c);expect(()=>validateConfiguration(c)).toThrow();}});
it('explicit import constraints stay indeterminate and cannot create a target by matching source strings',()=>{const{c,deps}=setup();const rule={...base,kinds:['imports_syntax' as const],from:{kind:'files' as const,values:['events.jsx']},to:{kind:'files' as const,values:['events.jsx']}};const result=evaluateRules(c,deps,{schemaVersion:1,rules:[rule]});expect(result.evaluations[0]!.status).toBe('indeterminate');expect(result.violations).toEqual([]);});
it.each(['unsupported','failed','unavailable'] as const)('selected %s file without entities prevents a pass for the remaining observed files',status=>{
 const {c,f,deps}=setup(),recursive=f.metadata.entities.find(e=>e.name==='recursive')!,other=f.metadata.entities.find(e=>e.name==='UserController')!;
 const unavailable=new Context(input(['gap.js']));unavailable.initialize();const file=unavailable.fileComponents.get('gap.js')!;c.components.push(file);c.fileComponents.set(file.name,file);
 c.input.coverage.push({relativePath:'gap.js',status,upstreamStatus:status,code:'GAP',relationship:null,inputs:null});
 const rule:DependencyRule={...base,kinds:['calls'],from:{kind:'files',values:['events.jsx','gap.js']},to:{kind:'entities',values:[other.entityId]}};
 const observed=deps.filter(d=>d.from===c.entityComponents.get(recursive.entityId)!.id);
 const result=evaluateRules(c,observed,{schemaVersion:1,rules:[rule]});expect(result.evaluations[0]!.status).toBe('indeterminate');expect(result.evaluations[0]!.limitations).toContain('PARTIAL_COVERAGE');
});
it('partial upstream relationships and partially missing selectors cannot establish a local pass',()=>{
 const {c,f,deps}=setup(),recursive=f.metadata.entities.find(e=>e.name==='recursive')!,other=f.metadata.entities.find(e=>e.name==='UserController')!;
 const rule:DependencyRule={...base,kinds:['calls'],from:{kind:'entities',values:[recursive.entityId]},to:{kind:'entities',values:[other.entityId]}};
 c.input.coverage[0]!.upstreamStatus='partial';expect(evaluateRules(c,deps,{schemaVersion:1,rules:[rule]}).evaluations[0]!.status).toBe('indeterminate');
 c.input.coverage[0]!.upstreamStatus='complete';
 for(const changed of [{...rule,from:{kind:'files' as const,values:['events.jsx','absent.js']}},{...rule,to:{kind:'entities' as const,values:[other.entityId,'meta-'+'a'.repeat(64)]}}])expect(evaluateRules(c,deps,{schemaVersion:1,rules:[changed]}).evaluations[0]!.status).toBe('indeterminate');
});
it('positive counterexamples survive partial coverage and multiple conflicting candidate hints remain indeterminate',()=>{
 const {c,f,deps}=setup(),entity=f.metadata.entities.find(e=>e.name==='recursive')!;
 c.input.coverage[0]!.upstreamStatus='partial';c.fileComponents.get('events.jsx')!.roles.push({role:'application',classification:'candidate',evidenceIds:[]},{role:'presentation',classification:'candidate',evidenceIds:[]});
 const exact:DependencyRule={...base,kinds:['calls'],from:{kind:'entities',values:[entity.entityId]},to:{kind:'entities',values:[entity.entityId]}};
 const config:Configuration={schemaVersion:1,rules:[exact,{...exact,id:'candidate',from:{kind:'roles',values:['application']},to:{kind:'roles',values:['presentation']}}]};
 const result=evaluateRules(c,deps,config);expect(result.evaluations.map(e=>e.status)).toEqual(['indeterminate','violation']);expect(result.violations).toHaveLength(1);expect(evaluateRules(c,[...deps].reverse(),{...config,rules:[...config.rules].reverse()})).toEqual(result);
});
