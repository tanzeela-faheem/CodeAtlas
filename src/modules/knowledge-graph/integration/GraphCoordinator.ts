import { setImmediate as yieldToLoop } from 'node:timers/promises';
import { check, projectId, analysisId, validatedSnapshot } from '../../../shared/validation.js';
import type { ProjectStore } from '../../respository/services/project-store.js';
import { validateProjectState } from '../../respository/services/project-validation.js';
import type { AnalysisStore } from '../../analysis/summary-store.js';
import { validateAnalysisSummary } from '../../analysis/summary-validation.js';
import type { AstStore } from '../../ast-management/store.js';
import type { ResolutionStore } from '../../symbol-resolution/storage.js';
import { validateResolutionAnalysis } from '../../symbol-resolution/validation.js';
import type { RelationshipStore } from '../../relationship-analysis/storage.js';
import { validateRelationshipAnalysis } from '../../relationship-analysis/validation.js';
import type { MetadataProvider } from '../../symbol-resolution/integration/MetadataClient.js';
import { digest, validateMetadataAnalysis } from '../../symbol-resolution/integration/contracts.js';
import type { GraphStore } from '../storage/GraphStore.js';
import { GRAPH_LIMITS, GraphError, graphCheckpoint, type GraphInput, type GraphFile, type GraphGap, type GraphLimits, type GraphDocument } from '../model.js';
import { validateManifests, validateFile, contractContext } from '../contracts.js';
import { buildGraph } from '../core/GraphBuilder.js';
import { GraphUpdateEngine } from '../core/GraphUpdateEngine.js';
const missing=(e:unknown)=>(e as NodeJS.ErrnoException)?.code==='ENOENT';
export class GraphCoordinator {
    private active=false;
    private readonly limits:Readonly<GraphLimits>;
    private readonly updates:GraphUpdateEngine;
    constructor(private readonly projects:ProjectStore,private readonly source:AnalysisStore,private readonly asts:AstStore,private readonly resolutions:ResolutionStore,private readonly relationships:RelationshipStore,private readonly metadata:MetadataProvider,store:GraphStore,limits:GraphLimits={...GRAPH_LIMITS}){
        for(const k of Object.keys(GRAPH_LIMITS) as (keyof GraphLimits)[])if(!Number.isSafeInteger(limits[k])||limits[k]<=0||limits[k]>GRAPH_LIMITS[k])throw new Error('Invalid graph limits');
        this.limits=Object.freeze({...limits});this.updates=new GraphUpdateEngine(store);
    }
    async build(project:string,analysis:string):Promise<GraphDocument>{
        projectId(project);analysisId(analysis);if(this.active)throw new GraphError('GRAPH_BUSY',409);this.active=true;
        const deadline=Date.now()+this.limits.maxDurationMs;
        try{
            const state=await this.projects.get(project).catch(e=>{if(missing(e))throw new GraphError('GRAPH_PROJECT_MISSING',404);throw e;});validateProjectState(state,project);
            const source=validatedSnapshot(await this.source.get(project,analysis).catch(e=>{if(missing(e))throw new GraphError('GRAPH_SOURCE_MISSING',424);throw e;}),validateAnalysisSummary);
            check(source.projectId===project&&source.analysisId===analysis,'graph source ownership');if(!['completed','completed_with_errors'].includes(source.status))throw new GraphError('GRAPH_SOURCE_NOT_READY',409);
            if(source.files.length>this.limits.maxFiles)throw new GraphError('GRAPH_RESOURCE_LIMIT',413);
            const profile=state.result.projectProfile;
            if(profile){const inventory=new Map(profile.languages.sourceFiles.map(f=>[f.relativePath,f]));check(inventory.size===source.files.length&&source.files.every(f=>inventory.has(f.relativePath)&&(!f.artifact||!inventory.get(f.relativePath)!.contentHash||inventory.get(f.relativePath)!.contentHash===f.artifact.contentHash)),'graph profile source snapshot');}
            const [rawResolution,rawRelationship]=await Promise.all([
                this.resolutions.getAnalysisManifest?.(project,analysis)??this.resolutions.getAnalysis(project,analysis),
                this.relationships.getAnalysisManifest?.(project,analysis)??this.relationships.getAnalysis(project,analysis)
            ]).catch(e=>{if(missing(e))throw new GraphError('GRAPH_PREREQUISITE_MISSING',424);throw e;});
            const resolutionAnalysis=validatedSnapshot(rawResolution,validateResolutionAnalysis),relationshipAnalysis=validatedSnapshot(rawRelationship,validateRelationshipAnalysis);
            for(const a of [resolutionAnalysis,relationshipAnalysis])check(a.projectId===project&&a.analysisId===analysis&&a.sourceAnalysisHash===digest(source),'graph manifest snapshot');
            if(!['complete','partial','failed'].includes(resolutionAnalysis.status)||!['complete','partial','failed'].includes(relationshipAnalysis.status))throw new GraphError('GRAPH_UPSTREAM_NOT_READY',409);
            check(relationshipAnalysis.resolutionAnalysisHash===digest(resolutionAnalysis)&&relationshipAnalysis.metadataAnalysisHash===resolutionAnalysis.metadataAnalysisHash,'graph producer snapshot');
            graphCheckpoint(deadline);
            const prior=await this.updates.reuse({projectId:project,analysisId:analysis,sourceAnalysisHash:digest(source),metadataAnalysisHash:relationshipAnalysis.metadataAnalysisHash,resolutionAnalysisHash:digest(resolutionAnalysis),relationshipAnalysisHash:digest(relationshipAnalysis),architectureAnalysisHash:null});
            if(prior){graphCheckpoint(deadline);return prior;}
            const metadataAnalysis=validatedSnapshot(await this.metadata.analysis(project,analysis),validateMetadataAnalysis);
            const input:GraphInput={source,metadataAnalysis,resolutionAnalysis,relationshipAnalysis,files:[],gaps:[]};validateManifests(input);const context=contractContext(input);
            let bytes=Buffer.byteLength(JSON.stringify(input)),entities=0,relationships=0;
            const account=(value:unknown)=>{bytes+=Buffer.byteLength(JSON.stringify(value));if(bytes>this.limits.maxInputBytes)throw new GraphError('GRAPH_RESOURCE_LIMIT',413);};
            account(null);
            const gap=(path:string,stage:GraphGap['stage'],e:unknown)=>{
                if(e instanceof GraphError)throw e;
                const upstreamCode=String((e as {code?:string})?.code??'');
                const code=missing(e)||upstreamCode==='METADATA_MISSING'?'GRAPH_UPSTREAM_MISSING':['METADATA_UNAVAILABLE','METADATA_TIMEOUT','METADATA_CONNECT_TIMEOUT','METADATA_UPSTREAM_FAILED'].includes(upstreamCode)?'GRAPH_UPSTREAM_UNAVAILABLE':'GRAPH_INPUT_INCOMPATIBLE';
                input.gaps.push({relativePath:path,stage,code});
            };
            for(const m of [...metadataAnalysis.files].sort((a,b)=>a.relativePath.localeCompare(b.relativePath))){
                graphCheckpoint(deadline);if(!m.metadataArtifact)continue;
                let file:GraphFile;
                try{
                    const ast=await this.asts.get(project,analysis,m.metadataArtifact.astArtifactId,m.metadataArtifact.contentHash);account(ast);
                    const metadata=await this.metadata.document(project,analysis,m.metadataArtifact.artifactId);account(metadata);
                    file={ast,metadata,resolution:null,relationships:null};validateFile(input,file,context);
                    entities+=metadata.entities.length;if(entities>this.limits.maxEntities)throw new GraphError('GRAPH_RESOURCE_LIMIT',413);
                }catch(e){gap(m.relativePath,'metadata',e);continue;}
                const r=resolutionAnalysis.files.find(x=>x.relativePath===m.relativePath)!;
                if(r.artifact)try{
                    const resolution=await this.resolutions.getFile(project,analysis,r.artifact.artifactId);account(resolution);
                    const next={...file,resolution};validateFile(input,next,context);file=next;
                }catch(e){gap(m.relativePath,'resolution',e);}
                const a=relationshipAnalysis.files.find(x=>x.relativePath===m.relativePath)!;
                if(file.resolution&&a.artifact)try{
                    const doc=await this.relationships.getFile(project,analysis,a.artifact.artifactId);account(doc);
                    const next={...file,relationships:doc};validateFile(input,next,context);file=next;relationships+=doc.relationships.length;if(relationships>this.limits.maxRelationships)throw new GraphError('GRAPH_RESOURCE_LIMIT',413);
                }catch(e){gap(m.relativePath,'relationships',e);}
                input.files.push(file);await yieldToLoop();
            }
            graphCheckpoint(deadline);const doc=buildGraph(input,this.limits,deadline);graphCheckpoint(deadline);
            await this.updates.publish(doc);return doc;
        }finally{this.active=false;}
    }
}
