import * as v from '../../shared/validation.js';
import { digest, cleanSource, validateMetadataAnalysis, matchEvidence } from '../symbol-resolution/integration/contracts.js';
import { validateAnalysisSummary } from '../analysis/summary-validation.js';
import { validateResolutionAnalysis, resolutionReference } from '../symbol-resolution/validation.js';
import { validateRelationshipAnalysis, validateRelationshipDocument, reference } from '../relationship-analysis/validation.js';
import { matchInputs } from '../relationship-analysis/contracts.js';
import { GRAPH_VERSION, GRAPH_LIMITS, GraphError, graphCheckpoint, type GraphInput, type GraphFile, type GraphProvenance, type GraphLimits } from './model.js';
export const graphId=(prefix:'gn'|'ge'|'gc'|'gs',seed:unknown,data:unknown):string=>`${prefix}-${digest([GRAPH_VERSION,seed,data])}`;
export function graphIdentity(value:unknown,prefix:'gn'|'ge'|'gc'|'gs'):asserts value is string {
    v.string(value,'graph ID');v.check(new RegExp(`^${prefix}-[a-f0-9]{64}$`).test(value),'graph ID');
}
export function graphProvenance(i:Pick<GraphInput,'source'|'metadataAnalysis'|'resolutionAnalysis'|'relationshipAnalysis'>):GraphProvenance {
    return {projectId:i.source.projectId,analysisId:i.source.analysisId,sourceAnalysisHash:digest(i.source),metadataAnalysisHash:digest(i.metadataAnalysis),resolutionAnalysisHash:digest(i.resolutionAnalysis),relationshipAnalysisHash:digest(i.relationshipAnalysis),architectureAnalysisHash:null};
}
export function validateManifests(i:Pick<GraphInput,'source'|'metadataAnalysis'|'resolutionAnalysis'|'relationshipAnalysis'>):void {
    const {source:s,metadataAnalysis:m,resolutionAnalysis:r,relationshipAnalysis:a}=i;
    validateAnalysisSummary(s);validateMetadataAnalysis(m);validateResolutionAnalysis(r);validateRelationshipAnalysis(a);
    v.check(['completed','completed_with_errors'].includes(s.status),'source analysis not terminal');
    v.check(['complete','partial','failed'].includes(r.status)&&['complete','partial','failed'].includes(a.status),'upstream graph inputs not terminal');
    const sourceHash=digest(s),metadataHash=digest(m),resolutionHash=digest(r);
    for(const x of [m,r,a])v.check(x.projectId===s.projectId&&x.analysisId===s.analysisId&&x.sourceAnalysisHash===sourceHash,'graph snapshot ownership');
    v.check(digest(cleanSource(m.sourceAnalysis))===sourceHash&&r.metadataAnalysisHash===metadataHash&&a.metadataAnalysisHash===metadataHash&&a.resolutionAnalysisHash===resolutionHash&&r.extractionVersion===m.extractionVersion&&r.upstreamStatus===m.status&&a.upstreamStatus===r.status,'graph global snapshot');
    const paths=new Set(s.files.map(f=>f.relativePath));
    for(const x of [m,r,a])v.check(x.files.length===paths.size&&x.files.every(f=>paths.has(f.relativePath)),'graph inventory coverage');
}
type Manifests=Pick<GraphInput,'source'|'metadataAnalysis'|'resolutionAnalysis'|'relationshipAnalysis'>;
export function contractContext(i:Manifests){
    return {provenance:graphProvenance(i),source:new Map(i.source.files.map(f=>[f.relativePath,f])),metadata:new Map(i.metadataAnalysis.files.map(f=>[f.relativePath,f])),resolution:new Map(i.resolutionAnalysis.files.map(f=>[f.relativePath,f])),relationships:new Map(i.relationshipAnalysis.files.map(f=>[f.relativePath,f]))};
}
/** Reuse producer cross-module validators; no declaration extraction or resolution here. */
export function validateFile(i:Manifests,f:GraphFile,c=contractContext(i)):void {
    v.object(f,'graph file',['ast','metadata','resolution','relationships']);
    for(const key of ['resolution','relationships'] as const)v.check(f[key]===null||(typeof f[key]==='object'&&f[key]!==null&&!Array.isArray(f[key])),'nullable producer document');
    const path=f.ast.relativePath,source=c.source.get(path),meta=c.metadata.get(path),resolved=c.resolution.get(path),related=c.relationships.get(path);
    v.check(source?.artifact&&meta?.metadataArtifact&&resolved&&related,'graph file inventory');
    v.check(f.ast.projectId===i.source.projectId&&f.ast.analysisId===i.source.analysisId&&f.ast.contentHash===source.artifact.contentHash,'graph AST ownership');
    v.check(f.ast.language==='JavaScript'&&f.ast.parserId==='tree-sitter-javascript'&&f.ast.parserVersion==='0.25.1'&&f.ast.grammarVersion==='0.25.0','graph semantic language/parser unsupported');
    matchEvidence(f.ast,f.metadata,meta.metadataArtifact);
    v.check(meta.metadataArtifact.astArtifactId===source.artifact.artifactId,'graph AST reference');
    if(f.resolution){
        v.check(resolved.artifact&&f.resolution.status===resolved.status&&digest(resolutionReference(f.resolution))===digest(resolved.artifact)&&digest(f.resolution.metadataArtifact)===digest(meta.metadataArtifact),'graph resolution manifest');
        matchInputs({ast:f.ast,metadata:f.metadata,resolution:f.resolution,resolutionArtifact:resolved.artifact,sourceAnalysisHash:c.provenance.sourceAnalysisHash,metadataAnalysisHash:c.provenance.metadataAnalysisHash,resolutionAnalysisHash:c.provenance.resolutionAnalysisHash});
    }
    v.check(!f.relationships||f.resolution,'relationship requires verified resolution');
    if(f.relationships){
        const doc=f.relationships;validateRelationshipDocument(doc);
        v.check(related.artifact&&digest(reference(doc))===digest(related.artifact),'graph relationship manifest');
        const p=c.provenance;
        v.check(doc.inputs.sourceAnalysisHash===p.sourceAnalysisHash&&doc.inputs.metadataAnalysisHash===p.metadataAnalysisHash&&doc.inputs.resolutionAnalysisHash===p.resolutionAnalysisHash&&digest(doc.inputs.sourceAst)===digest(f.metadata.sourceAst)&&digest(doc.inputs.resolutionArtifact)===digest(resolved.artifact)&&digest(doc.inputs.metadataArtifact)===digest(meta.metadataArtifact)&&doc.inputs.astArtifactId===source.artifact.artifactId,'graph relationship provenance');
        const entities=new Map(f.metadata.entities.map(e=>[e.entityId,e])),symbols=new Map(f.resolution!.symbols.map(s=>[s.id,s])),refs=new Map(f.resolution!.references.map(r=>[r.id,r])),nodes=new Map(f.ast.nodes.map(n=>[n.id,n]));
        for(const r of doc.relationships){
            const n=nodes.get(r.astNodeId);v.check(n&&digest(r.range)===digest({start:n.start,end:n.end}),'relationship occurrence range');
            v.check(r.evidence.metadataEntityIds.every(id=>entities.has(id))&&r.evidence.candidateSymbolIds.every(id=>symbols.has(id))&&(!r.evidence.bindingSymbolId||symbols.has(r.evidence.bindingSymbolId)),'graph relationship evidence');
            const source=entities.get(r.source.entityId)!,module=entities.get(r.source.moduleEntityId)!;
            v.check(module.kind==='module'&&module.parentEntityId===null,'relationship module');
            v.check(source.sourceRange.start.offset<=r.range.start.offset&&source.sourceRange.end.offset>=r.range.end.offset,'relationship source range');
            if(r.source.context==='callable')v.check(['function','method','constructor'].includes(source.kind),'relationship caller kind');
            if(r.source.context==='initializer')v.check(['variable','field','class'].includes(source.kind),'relationship initializer kind');
            if(r.source.enclosingCallableEntityId)v.check(['function','method','constructor'].includes(entities.get(r.source.enclosingCallableEntityId)!.kind),'enclosing callable');
            for(const id of r.evidence.referenceIds){const ref=refs.get(id);v.check(ref&&(!r.target.symbolId||(ref.status==='resolved'&&ref.symbolId===r.target.symbolId))&&(!r.evidence.bindingSymbolId||ref.symbolId===r.evidence.bindingSymbolId),'relationship reference binding');}
            if(r.kind==='contains')v.check(entities.get(r.target.entityId!)!.parentEntityId===r.source.entityId,'relationship metadata ownership');
            if(r.target.entityId&&r.target.symbolId)v.check(symbols.get(r.target.symbolId)!.declarations.some(d=>d.metadataEntityId===r.target.entityId),'relationship declaration binding');
        }
    }
}
export function validateGraphInput(value:unknown,limits:Readonly<GraphLimits>=GRAPH_LIMITS,deadline=Infinity):asserts value is GraphInput {
    const o=v.object(value,'graph input',['source','metadataAnalysis','resolutionAnalysis','relationshipAnalysis','files','gaps']);
    const i=value as GraphInput;validateManifests(i);
    if(i.source.files.length>limits.maxFiles||Buffer.byteLength(JSON.stringify(i))>limits.maxInputBytes)throw new GraphError('GRAPH_RESOURCE_LIMIT',413);
    v.array(o.files,'graph files',limits.maxFiles);v.array(o.gaps,'graph gaps',limits.maxFiles*3);
    const files=new Map<string,GraphFile>(),context=contractContext(i);let entities=0,relationships=0;
    for(const f of i.files){graphCheckpoint(deadline);validateFile(i,f,context);v.check(!files.has(f.ast.relativePath),'duplicate graph file');files.set(f.ast.relativePath,f);entities+=f.metadata.entities.length;relationships+=f.relationships?.relationships.length??0;}
    if(entities>limits.maxEntities||relationships>limits.maxRelationships)throw new GraphError('GRAPH_RESOURCE_LIMIT',413);
    const gaps=new Set<string>();
    for(const g of i.gaps){v.object(g,'graph gap',['relativePath','stage','code']);v.sourcePath(g.relativePath);v.member(g.stage,['metadata','resolution','relationships'],'gap stage');v.member(g.code,['GRAPH_UPSTREAM_MISSING','GRAPH_UPSTREAM_UNAVAILABLE','GRAPH_INPUT_INCOMPATIBLE'],'gap code');const key=g.relativePath+':'+g.stage;v.check(!gaps.has(key),'duplicate gap');gaps.add(key);const f=files.get(g.relativePath);v.check(i.source.files.some(s=>s.relativePath===g.relativePath)&&!(g.stage==='metadata'?f:g.stage==='resolution'?f?.resolution:f?.relationships),'gap contradicts available evidence');}
    for(const s of i.source.files){const f=files.get(s.relativePath),m=context.metadata.get(s.relativePath)!,r=context.resolution.get(s.relativePath)!,a=context.relationships.get(s.relativePath)!;
        v.check(!!f===!!m.metadataArtifact||gaps.has(s.relativePath+':metadata'),'missing metadata gap');
        if(f){v.check(!!f.resolution===!!r.artifact||gaps.has(s.relativePath+':resolution'),'missing resolution gap');if(f.resolution)v.check(!!f.relationships===!!a.artifact||gaps.has(s.relativePath+':relationships'),'missing relationship gap');}
    }
}
