# Verified producer fixtures

These 12 JavaScript/JSX sources are syntax fixtures, never executed as repository code.
`*.ast.json` snapshots come from the installed native Tree-sitter parser and AstBuilder.
`*.metadata.json`, `*.reference.json`, `metadata-analysis.json` and `source-analysis.json`
come from the existing Python producer's JavaScriptExtractor, validate_document,
canonical hashing and Pydantic project models. No extractor is copied into TypeScript.

Regenerate from the TypeScript repository root with the existing environments:

```sh
node --import tsx src/modules/symbol-resolution/tests/generate-fixtures.mts
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=/path/to/codeatlas-backend \
  /path/to/python-environment/bin/python -B \
  src/modules/symbol-resolution/tests/generate-metadata-fixtures.py
```

Producer versions: metadata document 1 / javascript-syntax-v1; project analysis 1 /
project-metadata-v1/javascript-syntax-v1; AST 1 / syntax-preorder-v1;
Tree-sitter binding 0.25.1, JavaScript grammar 0.25.0. The generator reads producer
modules under app/metadata and writes only this task's fixture directory. Python
is not required for routine Vitest runs; tests consume committed/local snapshots
and compare ASTs with freshly generated native normalized trees.

The optional `../live-integration.mts` runs real loopback TypeScript and FastAPI
services with isolated temporary project and metadata roots. It requires explicit
CODEATLAS_PYTHON_EXECUTABLE and CODEATLAS_PYTHON_REPOSITORY settings and does not
install dependencies or use existing projects.
