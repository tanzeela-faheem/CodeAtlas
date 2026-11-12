"""Read existing producer code, generate only this module's synthetic fixtures."""
from pathlib import Path
import json
from collections import Counter
from hashlib import sha256
from app.metadata.validation import AstDocument
from app.metadata.extractors.javascript import JavaScriptExtractor
from app.metadata.persistence import canonical, metadata_id, validate_document
from app.metadata.project_models import MetadataAnalysis, FileMetadataOutcome, MetadataReference, analysis_status
from app.metadata.upstream import UpstreamAnalysis, digest
root=Path(__file__).parent/'fixtures'
raw=json.loads((root/'.native.json').read_text())
by_path={f['relativePath']:f for f in raw['files']}
files=[]
outcomes=[]
total=Counter()
for outcome in raw['source']['files']:
    item=by_path.get(outcome['relativePath'])
    if item is None or item['ast']['language']!='JavaScript':
        outcomes.append(FileMetadataOutcome(relativePath=outcome['relativePath'],upstreamStatus=outcome['status'],status='unsupported',sourceArtifact=outcome.get('artifact')))
        continue
    doc=validate_document(JavaScriptExtractor(AstDocument.model_validate(item['ast'])).extract())
    s=doc.sourceAst
    ref=MetadataReference(artifactId=metadata_id(doc),astArtifactId=item['reference']['artifactId'],projectId=s.projectId,analysisId=s.analysisId,relativePath=s.relativePath,contentHash=s.contentHash,documentHash=sha256(canonical(doc)).hexdigest(),extractionStatus=doc.extractionStatus,entityCounts=doc.summary)
    outcomes.append(FileMetadataOutcome(relativePath=s.relativePath,upstreamStatus=outcome['status'],status=doc.extractionStatus,sourceArtifact=item['reference'],metadataArtifact=ref))
    files.append(dict(relativePath=s.relativePath,metadata=doc.model_dump(),reference=ref.model_dump()))
    total.update(doc.summary)
source=UpstreamAnalysis.model_validate(raw['source'])
analysis=MetadataAnalysis(schemaVersion=1,projectId=source.projectId,analysisId=source.analysisId,status=analysis_status(outcomes,source.status),createdAt='2026-11-12T00:00:02.000Z',completedAt='2026-11-12T00:00:03.000Z',sourceAnalysis=source,sourceAnalysisHash=digest(raw['source']),files=outcomes,entityCounts=dict(total),outcomeCounts=dict(Counter(f.status for f in outcomes)))
(root/'.metadata.json').write_text(json.dumps(dict(analysis=analysis.model_dump(),files=files),ensure_ascii=False))
