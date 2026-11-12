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

## AI Context Engine — Phase 1

`POST /api/projects/:projectId/analysis/:analysisId/ai/context` retrieves a bounded evidence package and a model-independent data envelope. It does **not** generate an answer or call an LLM. A persisted Knowledge Graph and matching source analysis are prerequisites. Context retrieval never builds Search/Graph or reruns producers.

Choose an explicit strategy:

- `focused`: exact metadata entity, graph node or inventory file/range focus; works without Search when independent evidence is available.
- `search`: supply an actual schema 1 or schema 2 Search request; existing Search semantics/ranking are preserved.
- `question_lexical`: pass the whole question unchanged to schema 1 lexical AND, within Search's 256-character/term bounds. This is lexical discovery, not natural-language understanding.

Example: `{"schemaVersion":1,"userQuestion":"caller","strategy":"question_lexical","categories":["search","metadata"],"retrieval":{"maxSearchResults":4}}`. For reliable focused retrieval, use an exact returned producer identity or `{"type":"file","relativePath":"app.js"}` in `focus` with strategy `focused`. No name fallback is used for unknown exact IDs.

The context preserves metadata/AST/symbol/graph/Search identities, established edge guarantees, separate requested candidates, recorded documentation and source provenance. Current excerpts require the selected source hash and AST fidelity; changed source can fall back to an authenticated schema 2 historical excerpt or a narrowly recorded schema 1 token. Historical evidence never claims current liveness. Mutable ProjectProfile state is not mixed into historical context.

Context IDs are deterministic content hashes. Context is generated on request without a new database or artifact store. Whole records and excerpt prefixes obey explicit character/byte/record/traversal budgets; omissions and partial coverage are visible. Repository-controlled text stays in an untrusted-data section, with no executable prompt template, embeddings, agents, external model calls or frontend AI workspace.

See [API contract](docs/AI_CONTEXT_PHASE_1_API.md), [producer audit](docs/AI_CONTEXT_PHASE_1_CONTRACT_AUDIT.md), and [implementation report](docs/CODEATLAS_AI_CONTEXT_PHASE_1_IMPLEMENTATION_REPORT.md). These are local ignored documents under the existing Git policy. The optional live check is `node --import tsx src/modules/ai-context/tests/live-integration.mts`, with `CODEATLAS_PYTHON_EXECUTABLE` and `CODEATLAS_PYTHON_REPOSITORY` pointing to the existing producer environment.

### AI Reasoning Phase 2

`POST /api/projects/:projectId/analysis/:analysisId/ai/answer` accepts `{schemaVersion:1,contextRequest:<public Phase 1 request>,style?:"concise"|"detailed",explanation?:"overview"|"source"|"relationships"}`. It retrieves fresh authenticated Context internally, checks conservative prerequisites, calls a configured provider once, then validates structured claims/citations and exact producer-backed facts. No AI frontend, agents, tools, streaming or chat persistence.

**External data egress is disabled by default.** Deliberately set `CODEATLAS_AI_ENABLED=true`, `CODEATLAS_AI_PROVIDER=openai`, `CODEATLAS_AI_MODEL=gpt-4.1-mini` (or pinned `gpt-4.1-mini-2025-04-14`), and `OPENAI_API_KEY` securely in the server environment. See .env.example for bounded timeout/output/input/concurrency settings. Selected repository evidence may contain secrets; heuristic rejection cannot guarantee secret-free transmission. No raw prompts/responses are logged. Keys remain server-side; no automatic retries or model substitution.

Prefer exact focus and a small explicit Context budget, e.g. maxBytes32768/maxEvidence12. Oversized provider requests fail instead of trimming authenticated evidence. Valid citation identities and structured facts do **not** prove model narrative correctness. Historical/candidate/static guarantees and partial coverage remain visible.

[API/configuration](docs/AI_REASONING_PHASE_2_API.md), [contract audit](docs/AI_REASONING_PHASE_2_CONTRACT_AUDIT.md), [implementation report](docs/CODEATLAS_AI_REASONING_PHASE_2_IMPLEMENTATION_REPORT.md).

## Cross-file Semantic Analysis — Phase 1

An explicit immutable JavaScript module linker now associates static imports with supported export slots, using existing analyzed AST and lexical producer evidence. It handles aliases, defaults, namespaces, side effects, bounded named/star re-export chains, explicit-over-star precedence, ambiguity and valid cycles. Relative resolution is case-sensitive and inventory-only: explicit `.js`, `.jsx`, `.mjs` paths under policy `explicit-relative-js-v1`; no extensionless or package guessing.

- `POST /api/projects/:projectId/analysis/:analysisId/modules/index` with `{}` builds or validates/reuses the sidecar. A terminal source analysis and existing lexical-resolution manifest are required.
- `GET /api/projects/:projectId/analysis/:analysisId/modules` returns status/provenance/coverage.
- `POST /api/projects/:projectId/analysis/:analysisId/modules/query`, e.g. `{"schemaVersion":1,"kind":"links","relativePath":"consumer.jsx","limit":20}`, inspects bounded modules/imports/exports/tables/links/chains/unresolved/diagnostics.

Builds never run upstream producers or modify Graph/Search/AI. Published artifacts validate retained inputs and replay the projection on load. Changed current source cannot enter an old analysis: retained AST-only extraction discloses missing statement text, and existing artifacts remain original snapshots. Import/export association does not resolve alias uses, shadowing or namespace members, and adds no cross-file call/reference/Graph edges. Local exports of imported aliases remain deferred to Phase 2. TypeScript, Python and CommonJS linking remain unsupported coverage.

See [producer audit](docs/CROSS_FILE_PHASE_1_CONTRACT_AUDIT.md), [API, bounds and integrity contract](docs/CROSS_FILE_PHASE_1_API.md), and [implementation/verification report](docs/CODEATLAS_CROSS_FILE_PHASE_1_IMPLEMENTATION_REPORT.md). Existing Git policy ignores `docs/`; these documents are provided locally. Focused tests: `npx vitest run src/modules/module-linking/tests`. Optional real producer verification: `node --import tsx src/modules/module-linking/tests/live-integration.mts` with explicit `CODEATLAS_PYTHON_EXECUTABLE` and `CODEATLAS_PYTHON_REPOSITORY`; no analyzed source execution or external LLM request.

## Cross-file Semantic Analysis — Phase 2

Phase 2 adds a separate `cross-file-binding-v1` artifact using the authenticated Phase 1 sidecar and its retained lexical/AST evidence. Exact imported symbol IDs connect actual identifier references to declaration, default expression-slot or namespace origins. Parameter/block/catch shadowing is preserved through existing lexical targets. Proven imported-local export lists and aliases propagate in new Phase 2 witnesses; Phase 1 remains unchanged.

- `POST /api/projects/:projectId/analysis/:analysisId/cross-file/index` with `{}` explicitly builds/reuses the artifact. Requires existing Phase 1 and matching terminal source/lexical manifests; never runs producers.
- `GET /api/projects/:projectId/analysis/:analysisId/cross-file` returns provenance, counts, coverage and limits.
- `POST /api/projects/:projectId/analysis/:analysisId/cross-file/query`, e.g. `{"schemaVersion":1,"kind":"references","relativePath":"consumer.jsx","limit":20}`, inspects bindings/references/exports/origins/chains/namespaces/ambiguous/unresolved/diagnostics.

Claims distinguish export slots, lexical bindings, exact declarations and actual references. Namespace receivers remain separate from supported direct dot/static-literal members; dynamic, optional, nested and mutation accesses remain unsupported. Null producer identities stay null, and default expression slots never become initializer-callee identities. No imported code executes, current source is not reread, and no lexical/Phase 1/Graph/Search/AI artifacts or cross-file graph edges are changed. Python and React source remain untouched.

See [Phase 2 audit](docs/CROSS_FILE_PHASE_2_CONTRACT_AUDIT.md), [API and bounds](docs/CROSS_FILE_PHASE_2_API.md), and [implementation/verification report](docs/CODEATLAS_CROSS_FILE_PHASE_2_IMPLEMENTATION_REPORT.md). Existing Git policy ignores docs/. Focused tests: `npx vitest run src/modules/cross-file-binding/tests`. Optional live check: `node --import tsx src/modules/cross-file-binding/tests/live-integration.mts`, with the existing Python executable/repository supplied explicitly through CODEATLAS_PYTHON_EXECUTABLE and CODEATLAS_PYTHON_REPOSITORY; isolated local fixtures, no external LLM.

## Cross-file Semantic Analysis — Phase 3

`cross-file-relationship-v1` is a separate immutable sidecar for supported direct cross-file calls and direct static import/re-export dependencies. Calls require exact native callee syntax, authenticated Phase 2 reference/member and origin evidence, a uniquely supported function declaration/direct default function slot, and an exact lexical caller or module context. Anonymous/arrow/method callers retain AST/scope identity without invented metadata. Distinct call sites and dependency statements retain independent occurrence IDs.

- `POST /api/projects/:projectId/analysis/:analysisId/cross-file/relationships/index` with `{}` builds/reuses the sidecar. Requires explicitly built, matching Phase 1/2 and source/lexical manifests; never runs producers.
- `GET /api/projects/:projectId/analysis/:analysisId/cross-file/relationships` returns status/provenance/coverage.
- `POST /api/projects/:projectId/analysis/:analysisId/cross-file/relationships/query`, e.g. `{"schemaVersion":1,"kind":"calls","sourcePath":"consumer.jsx","limit":20}`, inspects calls/dependencies/candidates/unresolved/contexts/diagnostics with strict identity filters.

Guarantees are static associations, not runtime execution/loading/initialization. Indirect/optional/tagged calls, arbitrary value flow, mutable target bindings, constructors, classes and non-function expression results remain candidates. Namespace calls require exact Phase 2 receiver/member proof. Dependencies follow source statements, not transitive witness hops; side effects need no invented binding. No established READS/WRITES/CREATES/INSTANTIATES and no automatic Graph/Search/AI projection. Existing producer, Python and React sources stay unchanged.

See [Phase 3 audit](docs/CROSS_FILE_PHASE_3_CONTRACT_AUDIT.md), [API and static guarantees](docs/CROSS_FILE_PHASE_3_API.md), and [implementation/verification report](docs/CODEATLAS_CROSS_FILE_PHASE_3_IMPLEMENTATION_REPORT.md). Docs remain locally ignored under existing Git policy. Focused tests: `npx vitest run src/modules/cross-file-relationships/tests`. Optional real producer check: `node --import tsx src/modules/cross-file-relationships/tests/live-integration.mts` with explicit existing CODEATLAS_PYTHON_EXECUTABLE and CODEATLAS_PYTHON_REPOSITORY; isolated temporary fixtures, no external LLM.
