# CodeAtlas


## Read-only source retrieval (Phase 2)

`GET /api/projects/:projectId/analysis/:analysisId/source?path=src/file.js` returns bounded UTF-8 text only when its SHA-256 byte hash matches the selected persisted analysis/AST snapshot. It preserves BOM/CRLF and uses zero-based UTF-16, end-exclusive source coordinates. It is loopback-only, rejects unsafe paths/symlinks/binary/invalid encoding, and never executes source or modifies artifacts. Changed source returns `409 SOURCE_SNAPSHOT_MISMATCH`; files without an analyzed AST snapshot return `422 SOURCE_SNAPSHOT_UNAVAILABLE`.

See [source API contract and security notes](docs/PHASE_2_SOURCE_API.md). The existing repository ignores docs/ in Git; the document is provided locally without changing that policy. Run `npm test -- src/modules/analysis/source-routes.test.ts` under Node 22 for isolated endpoint tests.

## Search Engine — Phase 1

Search consumes an explicitly built, persisted knowledge graph for one selected analysis. It does not trigger extraction, resolution, graph construction, or indexing during a query. Only snapshot-verified JavaScript/JSX source tokens and available producer metadata are indexed; unsupported files retain inventory/path records and explicit coverage gaps.

- `POST /api/projects/:projectId/analysis/:analysisId/search/index` with `{}` builds an immutable local index (or reuses it).
- `GET /api/projects/:projectId/analysis/:analysisId/search` returns bounded index status/coverage.
- `POST /api/projects/:projectId/analysis/:analysisId/search/query` accepts, for example, `{"schemaVersion":1,"query":"UserController","mode":"exact","filters":{"documentKind":"entity","entityKind":"function","language":"JavaScript","path":"controllers/UserController.js"},"offset":0,"limit":20}`.

Exact search matches whole original names, qualified names, paths, module IDs, comment bodies or individual source tokens, case-sensitively. Lexical search is case-insensitive, NFC-normalized, token-based, and splits camel/snake identifiers; all query terms must match one record. No substring, prefix, phrase, regex, fuzzy or semantic search is provided. Additional filters: `pathPrefix` (whole directory), `moduleId` (actual metadata module ID), and inclusive `startRow`/`endRow` with an exact `path`. Unknown filters are rejected. Results distinguish declarations from text occurrences and carry recorded source/graph identifiers; snippets are historical indexed evidence. Current source navigation still verifies the snapshot hash independently.

All routes are loopback-only; result pages are limited to 100 records and 1 MiB. No frontend, Python or producer semantics changed. See [contract audit](docs/SEARCH_PHASE_1_CONTRACT_AUDIT.md) and [implementation report/API examples](docs/CODEATLAS_SEARCH_ENGINE_PHASE_1_IMPLEMENTATION_REPORT.md). These documents are local because the existing Git policy ignores `docs/`.

## Search Engine — Phase 2

Phase 2 is opt-in: `POST .../search/index` with `{"schemaVersion":2}` publishes a separate immutable positional artifact, and `GET .../search?schemaVersion=2` returns its status. Existing `{}` builds, default status, and schema 1 exact/lexical queries keep their Phase 1 behavior and stored artifacts. The explicit Phase 2 build initializes Phase 1 if needed; queries never build indexes.

`POST .../search/query` now also accepts schema 2 modes:

- `token_phrase`: consecutive original identifier tokens, NFC/case-insensitive; punctuation and whitespace are separators. Repetition matters; camel/snake expansions do not create token positions.
- `text_phrase`: exact case/spacing/punctuation in retained verified source. The longest query token (first on ties) must align with a whole source token. Punctuation-only and arbitrary all-partial-token substring search are unsupported.
- `file_lexical`: Phase 1 lexical normalization with AND across a single file, without adjacency. Results group by file, with exact counts and bounded occurrence previews.
- `entity`: exact or lexical name search combined with actual metadata identity/name/qualifiedName/parent constraints and up to four established graph adjacency constraints.

Examples: `{"schemaVersion":2,"mode":"token_phrase","query":"helper local helper local","groupBy":"file","occurrenceLimit":5}` and `{"schemaVersion":2,"mode":"entity","query":"run","match":"lexical","filters":{"entityKind":"function","path":"app.js"}}`.

Graph constraints use actual graph node IDs, edge kinds and direction relative to the anchored node: incoming CALLS finds callers, outgoing CALLS finds callees. Parallel occurrence edge IDs and their guarantees remain visible. Entity mode returns metadata entities; lexical binding nodes can be anchors, but binding neighbors are not silently converted into declarations. Direct metadata parent and explicit descendant filtering preserve syntactic ownership, not inferred lexical/type semantics. Source-mode combinations with entity/graph constraints are rejected.

Phase 2 retains bounded historical source text (up to 16 MiB, 100,000 positions, 32 MiB sidecar) and never fetches current source during queries. Graph-backed advanced queries authenticate the existing persisted graph at query time; no graph rebuild or Python access occurs. See [Phase 2 API](docs/SEARCH_PHASE_2_API.md), [contract/design audit](docs/SEARCH_PHASE_2_CONTRACT_AND_DESIGN_AUDIT.md), and [implementation report](docs/CODEATLAS_SEARCH_ENGINE_PHASE_2_IMPLEMENTATION_REPORT.md). Vitest now uses four workers to bound CPU contention; existing timeouts remain unchanged.
