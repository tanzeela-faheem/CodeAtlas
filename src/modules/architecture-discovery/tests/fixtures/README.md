# Architecture evidence fixtures

Five controlled JavaScript/JSX sources are parsed, never executed. ProjectProfile
unit inputs use the actual validated DTO shape and explicitly synthetic structural
hints. Semantic input snapshots use the real existing producers:

- ASTs: native Tree-sitter 0.25.1 / JavaScript grammar 0.25.0 and AstBuilder.
- Metadata/reference/project contracts: Python JavaScriptExtractor, its runtime
  validators, canonical hashing and Pydantic project models.
- Resolution artifacts: the current JavascriptResolver and runtime validators.
- Relationships: the current JavascriptRelationshipAnalyzer, validated in tests.

Fixtures cover named declarations, correlated domain paths/names, local recursion,
node:events import plus publish/subscribe syntax, misleading methods and library-only
markers. TypeScript test helpers do not duplicate Python extraction or name resolution.

Regenerate from the repository root using existing environments:

```sh
node --import tsx src/modules/architecture-discovery/tests/generate-fixtures.mts
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=/path/to/codeatlas-backend \
  /path/to/existing/python -B \
  src/modules/architecture-discovery/tests/generate-metadata-fixtures.py
node --import tsx src/modules/architecture-discovery/tests/generate-resolution-fixtures.mts
```

Generation writes only this fixture directory. Routine Vitest does not require a
running Python service. The optional `../live-integration.mts` separately starts
real TypeScript/FastAPI services with task-owned temporary roots and ephemeral
loopback ports, using explicit CODEATLAS_PYTHON_EXECUTABLE and
CODEATLAS_PYTHON_REPOSITORY settings. It does not install dependencies or modify
Python source, existing projects or stored user artifacts.
