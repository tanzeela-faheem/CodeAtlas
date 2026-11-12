"""Read producer code with -B; write only this module's local fixture snapshots."""
from pathlib import Path
import json
from hashlib import sha256
from app.metadata.validation import AstDocument
from app.metadata.extractors.javascript import JavaScriptExtractor
from app.metadata.persistence import validate_document, canonical, metadata_id
from app.metadata.project_models import MetadataReference
root = Path(__file__).parent / 'fixtures'
ast = json.loads((root / 'notes.ast.json').read_text())
doc = validate_document(JavaScriptExtractor(AstDocument.model_validate(ast)).extract())
ref = json.loads((root / 'notes.ast-reference.json').read_text())
metadata_ref = MetadataReference(artifactId=metadata_id(doc), astArtifactId=ref['artifactId'], projectId=doc.sourceAst.projectId, analysisId=doc.sourceAst.analysisId, relativePath=doc.sourceAst.relativePath, contentHash=doc.sourceAst.contentHash, documentHash=sha256(canonical(doc)).hexdigest(), extractionStatus=doc.extractionStatus, entityCounts=doc.summary)
(root / 'notes.metadata.json').write_bytes(canonical(doc))
(root / 'notes.reference.json').write_text(metadata_ref.model_dump_json())
