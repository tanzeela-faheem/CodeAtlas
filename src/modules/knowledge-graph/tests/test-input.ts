import { readFileSync,readdirSync } from 'node:fs';
import { deserializeAst,verifyAstSource } from '../../ast-management/serializer.js';
import { validateAnalysisSummary } from '../../analysis/summary-validation.js';
import { validateMetadataAnalysis,digest } from '../../symbol-resolution/integration/contracts.js';
import { validateResolutionAnalysis } from '../../symbol-resolution/validation.js';
import { JavascriptRelationshipAnalyzer } from '../../relationship-analysis/languages/javascript.js';
import { ANALYZER_VERSION,emptyFileCounts,emptyRelationshipCounts,type RelationshipAnalysis } from '../../relationship-analysis/model.js';
import { reference,addCounts,validateRelationshipAnalysis } from '../../relationship-analysis/validation.js';
import type { GraphInput } from '../model.js';
export const PROJECT='PRJ-123ABC',ANALYSIS='AN-00000000-0000-0000-0000-000000000001';
export function graphInput(extra=false):GraphInput {
 const dir=extra?new URL('./fixtures/',import.meta.url):new URL('../../relationship-analysis/tests/fixtures/',import.meta.url);
 const json=(name:string):unknown=>JSON.parse(readFileSync(new URL(name,dir),'utf8'));
 const source=json('source-analysis.json'),metadataAnalysis=json('metadata-analysis.json'),resolutionAnalysis=json('resolution-analysis.json');validateAnalysisSummary(source);validateMetadataAnalysis(metadataAnalysis);validateResolutionAnalysis(resolutionAnalysis);
 const related:RelationshipAnalysis={schemaVersion:1,analyzerVersion:ANALYZER_VERSION,projectId:PROJECT,analysisId:ANALYSIS,sourceAnalysisHash:digest(source),metadataAnalysisHash:digest(metadataAnalysis),resolutionAnalysisHash:digest(resolutionAnalysis),upstreamStatus:resolutionAnalysis.status as 'complete'|'partial'|'failed',upstreamDiagnostics:resolutionAnalysis.upstreamDiagnostics,status:'partial',startedAt:'2026-11-09T00:00:06.000Z',completedAt:'2026-11-09T00:00:07.000Z',files:[],counts:emptyFileCounts(),relationshipCounts:emptyRelationshipCounts()};
 const files=readdirSync(dir).filter(n=>n.endsWith('.ast.json')).sort().map(name=>{
  const stem=name.replace('.ast.json',''),ast=deserializeAst(readFileSync(new URL(name,dir),'utf8'));verifyAstSource(ast,readFileSync(new URL(stem+'.jsx',dir),'utf8'));
  const metadata=json(stem+'.metadata.json') as GraphInput['files'][number]['metadata'],resolution=json(stem+'.resolution.json') as NonNullable<GraphInput['files'][number]['resolution']>;
  const relationships=new JavascriptRelationshipAnalyzer().analyze({ast,metadata,resolution,resolutionArtifact:resolutionAnalysis.files.find(f=>f.relativePath===ast.relativePath)!.artifact!,sourceAnalysisHash:related.sourceAnalysisHash,metadataAnalysisHash:related.metadataAnalysisHash,resolutionAnalysisHash:related.resolutionAnalysisHash});
  const upstream=resolutionAnalysis.files.find(f=>f.relativePath===ast.relativePath)!;
  related.files.push({relativePath:ast.relativePath,status:relationships.status,artifact:reference(relationships),code:null,upstreamStatus:upstream.status,upstreamCode:null,upstreamDiagnostics:upstream.upstreamDiagnostics});related.counts[relationships.status]++;addCounts(related.relationshipCounts,relationships.counts);
  return{ast,metadata,resolution,relationships};
 });
 for(const r of resolutionAnalysis.files.filter(f=>!f.artifact)){related.files.push({relativePath:r.relativePath,status:r.status==='unsupported'?'unsupported':'unavailable',artifact:null,code:r.status==='unsupported'?'RELATIONSHIP_LANGUAGE_UNSUPPORTED':'RELATIONSHIP_RESOLUTION_FILE_UNAVAILABLE',upstreamStatus:r.status,upstreamCode:r.code,upstreamDiagnostics:r.upstreamDiagnostics});related.counts[r.status==='unsupported'?'unsupported':'unavailable']++;}
 related.status=related.counts.complete===related.files.length&&related.upstreamStatus==='complete'?'complete':related.counts.complete+related.counts.partial>0?'partial':'failed';validateRelationshipAnalysis(related);
 return{source,metadataAnalysis,resolutionAnalysis,relationshipAnalysis:related,files,gaps:[]};
}
