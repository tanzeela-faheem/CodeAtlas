import { digest } from '../symbol-resolution/integration/contracts.js';
import { Context,stableId } from './core/context.js';
import { detectLayers } from './detectors/layers.js';
import { detectMvc,detectClean,detectHexagonal } from './detectors/patterns.js';
import { detectMicroservices } from './detectors/microservices.js';
import { detectEvents } from './detectors/events.js';
import { detectDomains } from './detectors/domains.js';
import { buildDependencies,detectCycles } from './core/graph.js';
import { evaluateRules,validateConfiguration } from './core/rules.js';
import { VERSION,DEFAULT_LIMITS,ArchitectureError,type ArchitectureAnalysis,type DiscoveryInput,type Configuration,type Limits } from './model.js';
export function normalizedConfiguration(value:unknown):Configuration{
 validateConfiguration(value);const c=structuredClone(value);c.rules.sort((a,b)=>a.id.localeCompare(b.id));
 for(const r of c.rules){for(const key of ['from','to','selector']as const){const selector=(r as unknown as Record<string,{values:string[]}>)[key];if(selector)selector.values.sort();}const kinds=(r as unknown as {kinds?:string[]}).kinds;kinds?.sort();}
 if(Buffer.byteLength(JSON.stringify(c))>128*1024)throw new ArchitectureError('ARCHITECTURE_CONFIGURATION_LIMIT',413);return c;
}
export function resultId(provenance:DiscoveryInput['provenance']):string{return digest([VERSION,provenance]);}
export function discover(input:DiscoveryInput,configuration:Configuration,limits:Readonly<Limits>=DEFAULT_LIMITS,deadline=Date.now()+limits.maxDurationMs):ArchitectureAnalysis{
 const config=normalizedConfiguration(configuration);if(digest(config)!==input.provenance.configurationHash)throw new ArchitectureError('ARCHITECTURE_INPUT_INCOMPATIBLE');
 if(input.coverage.length>limits.maxFiles||input.files.reduce((n,f)=>n+f.metadata.entities.length,0)>limits.maxEntities||input.files.reduce((n,f)=>n+f.relationships.length,0)>limits.maxRelationships)throw new ArchitectureError('ARCHITECTURE_RESOURCE_LIMIT',413);
 const c=new Context(input,limits,deadline);c.initialize();
 for(const detector of [detectLayers,detectMvc,detectClean,detectHexagonal,detectMicroservices,detectEvents,detectDomains]){c.checkpoint();detector(c);}
 const dependencies=buildDependencies(c);c.checkpoint();const cycles=detectCycles(c.components.map(c=>c.id),dependencies,input.provenance,limits.maxComponents,limits.maxDependencies);
 if(cycles.length>limits.maxFindings)throw new ArchitectureError('ARCHITECTURE_RESOURCE_LIMIT',413);
 const {evaluations,violations}=evaluateRules(c,dependencies,config);c.checkpoint();
 const diagnostics=[...input.diagnostics,...evaluations.filter(e=>e.limitations.includes('UNSUPPORTED_RULE')).map(e=>({code:'UNSUPPORTED_ARCHITECTURAL_RULE',relativePath:null,message:`Rule ${e.ruleId} has no supported evaluator.`})),{code:'CROSS_FILE_DEPENDENCIES_UNAVAILABLE',relativePath:null,message:'Cycle and rule results cover observed local declaration dependencies only; import specifiers are never linked.'}];
 if(diagnostics.length>limits.maxDiagnostics)throw new ArchitectureError('ARCHITECTURE_RESOURCE_LIMIT',413);
 const doc:ArchitectureAnalysis={schemaVersion:1,analyzerVersion:VERSION,artifactId:resultId(input.provenance),provenance:input.provenance,configuration:config,status:input.coverage.some(f=>f.status!=='available'||f.upstreamStatus!=='complete')||c.findings.some(f=>f.classification!=='established')||evaluations.some(e=>e.status==='indeterminate')?'partial':'complete',coverage:input.coverage,components:c.components,evidence:c.evidence,findings:c.findings,dependencies,cycles,evaluations,violations,diagnostics,cycleCoverage:'observed_local_only'};
 if(Buffer.byteLength(JSON.stringify(doc))>limits.maxBytes)throw new ArchitectureError('ARCHITECTURE_RESOURCE_LIMIT',413);return doc;
}
