import { readFileSync } from 'node:fs';
import { deserializeAst } from '../../ast-management/serializer.js';
import { validateMetadataDocument, validateMetadataAnalysis, digest } from '../../symbol-resolution/integration/contracts.js';
import { validateResolutionDocument, validateResolutionReference } from '../../symbol-resolution/validation.js';
import { JavascriptRelationshipAnalyzer } from '../../relationship-analysis/languages/javascript.js';
import { reference, validateRelationshipDocument } from '../../relationship-analysis/validation.js';
export const json=(name:string):unknown=>JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`,import.meta.url),'utf8'));
export function fixture(name:string){const ast=deserializeAst(readFileSync(new URL(`./fixtures/${name}.ast.json`,import.meta.url),'utf8'));const metadata=json(`${name}.metadata`),resolution=json(`${name}.resolution`),resolutionArtifact=json(`${name}.resolution-reference`),analysis=json('metadata-analysis');validateMetadataDocument(metadata);validateResolutionDocument(resolution);validateResolutionReference(resolutionArtifact);validateMetadataAnalysis(analysis);const doc=new JavascriptRelationshipAnalyzer().analyze({ast,metadata,resolution,resolutionArtifact,sourceAnalysisHash:analysis.sourceAnalysisHash,metadataAnalysisHash:digest(analysis),resolutionAnalysisHash:digest(json('resolution-analysis'))});validateRelationshipDocument(doc);return{ast,metadata,resolution,doc,file:{metadata,relationships:doc.relationships,inputs:doc.inputs,reference:reference(doc),status:doc.status}};}
