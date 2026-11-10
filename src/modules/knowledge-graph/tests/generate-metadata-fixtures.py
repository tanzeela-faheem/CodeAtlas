"""Generate producer snapshots; imports producer code read-only, writes only local test fixtures.
Run with the metadata service environment and PYTHONPATH pointing to its repository.
"""
from pathlib import Path
from collections import Counter
from hashlib import sha256
import json
from app.metadata.validation import AstDocument
from app.metadata.extractors.javascript import JavaScriptExtractor
from app.metadata.persistence import canonical, metadata_id, validate_document
from app.metadata.project_models import MetadataAnalysis, FileMetadataOutcome, MetadataReference, analysis_status
from app.metadata.upstream import UpstreamAnalysis, digest

root = Path(__file__).parent / 'fixtures'
files, source_files, total = [], [], Counter()
for file in sorted(root.glob('*.ast.json')):
    raw = json.loads(file.read_text())
    doc = validate_document(JavaScriptExtractor(AstDocument.model_validate(raw)).extract())
    source = doc.sourceAst
    ast_id = digest([raw[k] for k in ('schemaVersion', 'normalizationVersion', 'projectId', 'analysisId', 'relativePath', 'contentHash', 'parserId', 'parserVersion', 'grammarVersion')])
    ref = {k: raw[k] for k in ('schemaVersion', 'normalizationVersion', 'projectId', 'analysisId', 'relativePath', 'contentHash', 'parserId', 'parserVersion', 'grammarVersion')}
    ref['artifactId'] = ast_id
    meta_ref = MetadataReference(artifactId=metadata_id(doc), astArtifactId=ast_id, projectId=source.projectId, analysisId=source.analysisId, relativePath=source.relativePath, contentHash=source.contentHash, documentHash=sha256(canonical(doc)).hexdigest(), extractionStatus=doc.extractionStatus, entityCounts=doc.summary)
    (root / file.name.replace('.ast.json', '.metadata.json')).write_bytes(canonical(doc))
    (root / file.name.replace('.ast.json', '.reference.json')).write_text(meta_ref.model_dump_json())
    upstream_status = 'parsed' if raw['parseStatus'] == 'success' else 'syntax_errors'
    source_files.append(dict(relativePath=source.relativePath, status=upstream_status, artifact=ref))
    files.append(FileMetadataOutcome(relativePath=source.relativePath, upstreamStatus=upstream_status, status=doc.extractionStatus, sourceArtifact=ref, metadataArtifact=meta_ref))
    total.update(doc.summary)
source_files.append(dict(relativePath='unsupported.ts', status='unsupported', code='LANGUAGE_UNSUPPORTED'))
files.append(FileMetadataOutcome(relativePath='unsupported.ts', upstreamStatus='unsupported', status='unsupported', sourceArtifact=None, metadataArtifact=None))
counts = dict.fromkeys(('parsed','syntax_errors','unsupported','skipped','read_failed','parser_failed','ast_failed','storage_failed'), 0)
counts.update(Counter(f['status'] for f in source_files))
source = UpstreamAnalysis(schemaVersion=1, projectId='PRJ-123ABC', analysisId='AN-00000000-0000-0000-0000-000000000001', status='completed_with_errors' if counts['syntax_errors'] else 'completed', startedAt='2026-11-09T00:00:00.000Z', completedAt='2026-11-09T00:00:01.000Z', files=source_files, counts=counts)
analysis = MetadataAnalysis(schemaVersion=1, projectId=source.projectId, analysisId=source.analysisId, status=analysis_status(files, source.status), createdAt='2026-11-09T00:00:02.000Z', completedAt='2026-11-09T00:00:03.000Z', sourceAnalysis=source, sourceAnalysisHash=digest(source.model_dump(exclude_unset=True)), files=files, entityCounts=dict(total), outcomeCounts=dict(Counter(f.status for f in files)))
(root / 'metadata-analysis.json').write_text(analysis.model_dump_json())
(root / 'source-analysis.json').write_text(json.dumps(source.model_dump(exclude_unset=True)))
print(f'Generated {len(files)} producer-validated metadata documents, references and project analysis.')
