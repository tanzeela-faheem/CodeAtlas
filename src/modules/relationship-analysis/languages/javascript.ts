import type { AstDocument, AstNode } from "../../ast-management/model.js";
import type { ReferenceRecord, SymbolRecord } from "../../symbol-resolution/model.js";
import { matchInputs, inputsFor, relationshipId, type FileEvidence } from "../contracts.js";
import { EvidenceIndex } from "../core/EvidenceIndex.js";
import { ANALYZER_VERSION, DEFAULT_LIMITS, emptyRelationshipCounts, RelationshipError, type RelationshipDocument, type RelationshipLimits, type RelationshipRecord, type Target } from "../model.js";
export interface RelationshipAdapter {
    supports(ast: AstDocument): boolean;
    analyze(evidence: FileEvidence, limits?: Readonly<RelationshipLimits>): RelationshipDocument;
}
const emptyTarget = (status: Target["status"]): Target => ({ status, entityId: null, symbolId: null, meaning: null });
export class JavascriptRelationshipAnalyzer implements RelationshipAdapter {
    supports(ast: AstDocument): boolean { return ast.language === "JavaScript" && ast.parserId === "tree-sitter-javascript" && ast.parserVersion === "0.25.1" && ast.grammarVersion === "0.25.0"; }
    analyze(evidence: FileEvidence, limits: Readonly<RelationshipLimits> = DEFAULT_LIMITS): RelationshipDocument {
        const { ast, metadata, resolution } = evidence;
        if (ast.nodes.length > limits.maxNodes || metadata.entities.length > limits.maxEntities || resolution.references.length > limits.maxReferences) throw new RelationshipError("RELATIONSHIP_RESOURCE_LIMIT", 413);
        matchInputs(evidence);
        if (!this.supports(ast)) throw new RelationshipError("RELATIONSHIP_LANGUAGE_UNSUPPORTED");
        const x = new EvidenceIndex(evidence), inputs = inputsFor(evidence), relationships: RelationshipRecord[] = [], counts = emptyRelationshipCounts();
        const written = new Set<string>();
        let unknownMutation = false;
        for (const ref of resolution.references) if (ref.usage === "write" || ref.usage === "read_write") {
            if (ref.symbolId) written.add(ref.symbolId); else { unknownMutation = true; ref.candidates.forEach(id => written.add(id)); }
        }
        const byMetadata = new Map<string, SymbolRecord[]>();
        for (const s of resolution.symbols) for (const d of s.declarations) if (d.metadataEntityId) byMetadata.set(d.metadataEntityId, [...(byMetadata.get(d.metadataEntityId) ?? []), s]);
        const specifiers = new Map<string, typeof metadata.entities>();
        for (const entity of metadata.entities) if (entity.kind === "import_specifier" || entity.kind === "export_specifier") {
            const statement = x.query.ancestors(entity.astNodeId).find(a => a.type === "import_statement" || a.type === "export_statement");
            if (statement) specifiers.set(statement.id, [...(specifiers.get(statement.id) ?? []), entity]);
        }
        const syntax = (): RelationshipRecord["syntax"] => ({ expression: null, moduleSpecifier: null, importedName: null, localName: null, exportedName: null, importKind: null, exportKind: null });
        function referenceTarget(ref: ReferenceRecord | undefined): Target {
            if (!ref) return emptyTarget("unresolved");
            if (ref.status !== "resolved") return emptyTarget(ref.status === "unsupported" || ref.status === "invalid" || ref.status === "ambiguous" ? ref.status : "unresolved");
            return { status: "established", entityId: null, symbolId: ref.symbolId, meaning: "lexical_binding" };
        }
        const base = (n: AstNode, kind: RelationshipRecord["kind"], target: Target): Omit<RelationshipRecord, "relationshipId"> => ({
            kind, source: x.source(n), target,
            classification: target.status === "established" ? "verified_local" : target.status === "unsupported" ? "unsupported" : target.status === "invalid" ? "invalid" : "candidate",
            astNodeId: n.id, range: { start: n.start, end: n.end },
            evidence: { astNodeIds: [n.id], metadataEntityIds: [], referenceIds: [], bindingSymbolId: null, candidateSymbolIds: [] }, syntax: syntax(), limitations: []
        });
        const attachReference = (r: Omit<RelationshipRecord, "relationshipId">, ref: ReferenceRecord | undefined) => {
            if (!ref) return;
            r.evidence.referenceIds = [ref.id]; r.evidence.bindingSymbolId = ref.symbolId; r.evidence.candidateSymbolIds = [...ref.candidates];
            r.evidence.astNodeIds.push(ref.astNodeId);
            r.limitations.push(...ref.diagnostics.map(d => d.code));
        };
        const emit = (r: Omit<RelationshipRecord, "relationshipId">) => {
            if (relationships.length >= limits.maxRelationships) throw new RelationshipError("RELATIONSHIP_RESOURCE_LIMIT", 413);
            r.evidence.astNodeIds = [...new Set(r.evidence.astNodeIds)];
            r.evidence.metadataEntityIds = [...new Set([r.source.entityId, r.source.moduleEntityId, ...(r.source.enclosingCallableEntityId ? [r.source.enclosingCallableEntityId] : []), ...(r.target.entityId ? [r.target.entityId] : []), ...r.evidence.metadataEntityIds])];
            for (const entityId of r.evidence.metadataEntityIds) { const entity = x.entities.get(entityId); if (entity) r.evidence.astNodeIds.push(entity.astNodeId); }
            r.evidence.astNodeIds = [...new Set(r.evidence.astNodeIds)];
            r.limitations = [...new Set(r.limitations)].sort();
            relationships.push({ relationshipId: relationshipId(inputs, r), ...r }); counts.kinds[r.kind]++; counts.targets[r.target.status]++;
        };
        const declarationTarget = (ref: ReferenceRecord | undefined, kind: "calls" | "constructs" | "extends_syntax"): { target: Target; code: string | null } => {
            const local = referenceTarget(ref);
            if (local.status !== "established") return { target: local, code: ref ? "UPSTREAM_REFERENCE_NOT_RESOLVED" : "NO_IDENTIFIER_REFERENCE" };
            const symbol = x.symbols.get(local.symbolId!)!;
            if (symbol.kind === "import") return { target: emptyTarget("deferred"), code: "EXTERNAL_TARGET_DEFERRED" };
            if (written.has(symbol.id) || unknownMutation) return { target: emptyTarget("deferred"), code: "BINDING_MUTATION_OR_UNKNOWN_WRITE" };
            if (ref!.initialization === "before_initialization") return { target: emptyTarget("deferred"), code: "BEFORE_INITIALIZATION" };
            if (symbol.declarations.length !== 1) return { target: emptyTarget("deferred"), code: "MULTIPLE_DECLARATIONS_VALUE_UNKNOWN" };
            const declaration = symbol.declarations[0]!, entity = declaration.metadataEntityId ? x.entities.get(declaration.metadataEntityId) : undefined;
            const node = entity ? x.query.byId(entity.astNodeId) : undefined;
            const functionKnown = kind === "calls" && ["function", "function-name"].includes(symbol.kind) && entity?.kind === "function" && node && ["function_declaration", "generator_function_declaration", "function_expression", "generator_function"].includes(node.type);
            const classKnown = kind !== "calls" && ["class", "class-name"].includes(symbol.kind) && entity?.kind === "class" && node?.type === "class_declaration";
            if (!functionKnown && !classKnown) return { target: emptyTarget("deferred"), code: kind === "calls" ? "CALLABLE_VALUE_NOT_ESTABLISHED" : "CLASS_VALUE_NOT_ESTABLISHED" };
            if (x.unreliable.has(node!.id)) return { target: emptyTarget("invalid"), code: "INCOMPLETE_TARGET_DECLARATION" };
            return { target: { status: "established", entityId: entity!.entityId, symbolId: symbol.id, meaning: kind === "calls" ? "callable_declaration" : "class_declaration" }, code: null };
        };
        for (const n of ast.nodes) {
            if (n.type === "call_expression" || n.type === "new_expression") {
                const kind = n.type === "call_expression" ? "calls" : "constructs";
                const expression = x.field(n, kind === "calls" ? "function" : "constructor");
                // Parenthesized/dynamic callees deliberately remain syntax candidates.
                const ref = expression?.type === "identifier" ? x.references.get(expression.id) : undefined;
                const optional = x.children(n).some(c => c.type === "optional_chain") || (!!expression && x.children(expression).some(c => c.type === "optional_chain"));
                const result = x.unreliable.has(n.id) ? { target: emptyTarget("invalid"), code: "INCOMPLETE_CALL_SITE" }
                    : optional ? { target: emptyTarget("unsupported"), code: "OPTIONAL_DISPATCH_DEFERRED" }
                    : expression?.type !== "identifier" ? { target: emptyTarget("unsupported"), code: "DYNAMIC_OR_PROPERTY_TARGET" }
                    : declarationTarget(ref, kind);
                const r = base(n, kind, result.target); r.syntax.expression = x.slice(expression); attachReference(r, ref);
                if (expression) r.evidence.astNodeIds.push(expression.id);
                if (result.code) r.limitations.push(result.code);
                if (result.target.status === "established") r.limitations.push("EXECUTION_NOT_PROVEN");
                emit(r);
            }
            if (n.type === "class_heritage") {
                const cls = n.parentId ? x.query.byId(n.parentId) : undefined;
                const entity = cls ? x.entity(cls, ["class"]) : undefined;
                if (!entity) continue;
                const expression = x.children(n).find(c => c.named && c.type !== "comment");
                const ref = expression?.type === "identifier" ? x.references.get(expression.id) : undefined;
                const result = x.unreliable.has(n.id) ? { target: emptyTarget("invalid"), code: "INCOMPLETE_HERITAGE" }
                    : expression?.type !== "identifier" ? { target: emptyTarget("deferred"), code: "DYNAMIC_HERITAGE_TARGET" } : declarationTarget(ref, "extends_syntax");
                const r = base(n, "extends_syntax", result.target); r.source = { ...r.source, entityId: entity.entityId, context: "declaration" }; r.syntax.expression = x.slice(expression); attachReference(r, ref);
                r.classification = result.target.status === "established" ? "syntax" : r.classification;
                r.limitations.push("HERITAGE_SYNTAX_NOT_TYPE_SUBTYPING"); if (result.code) r.limitations.push(result.code); emit(r);
            }
        }
        for (const ref of resolution.references) {
            if (ref.usage === "export") continue;
            const n = x.query.byId(ref.astNodeId)!;
            const kinds: ("reads" | "writes")[] = ref.usage === "read_write" ? ["reads", "writes"] : ref.usage === "write" ? ["writes"] : ["reads"];
            for (const kind of kinds) {
                const r = base(n, kind, referenceTarget(ref)); attachReference(r, ref);
                r.limitations.push("LEXICAL_OCCURRENCE_NOT_VALUE_FLOW"); emit(r);
            }
        }
        for (const entity of metadata.entities) {
            const n = x.query.byId(entity.astNodeId)!;
            if (entity.parentEntityId !== null) {
                const r = base(n, "contains", { status: "established", entityId: entity.entityId, symbolId: null, meaning: "syntactic_entity" });
                r.source = { ...r.source, entityId: entity.parentEntityId, context: "ownership" }; r.classification = "syntax"; r.limitations.push("SYNTACTIC_OWNERSHIP_NOT_SCOPE_OR_COMPOSITION"); emit(r);
            }
            if (entity.kind === "import") {
                const imported = specifiers.get(n.id) ?? [];
                const source = x.field(n, "source");
                for (const spec of imported.length ? imported : [null]) {
                    const site = spec ? x.query.byId(spec.astNodeId)! : n;
                    const r = base(site, "imports_syntax", emptyTarget(x.unreliable.has(n.id) ? "invalid" : "deferred")); r.source = { ...r.source, entityId: x.module.entityId, context: "module", enclosingCallableEntityId: null };
                    r.syntax.moduleSpecifier = x.slice(source); r.syntax.expression = x.slice(site);
                    r.syntax.importedName = typeof spec?.properties.importedName === "string" ? spec.properties.importedName : null;
                    r.syntax.localName = spec?.name ?? null;
                    const ik = spec?.properties.importKind;
                    r.syntax.importKind = ik === "default" || ik === "named" || ik === "namespace" ? ik : x.children(n).some(c => c.type === "import_clause") ? null : "side_effect";
                    r.evidence.metadataEntityIds.push(entity.entityId); if (spec) { r.evidence.metadataEntityIds.push(spec.entityId); const bindings = byMetadata.get(spec.entityId) ?? []; if (bindings.length === 1) r.evidence.bindingSymbolId = bindings[0]!.id; }
                    r.limitations.push("MODULE_AND_PACKAGE_TARGET_DEFERRED"); emit(r);
                }
            }
            if (entity.kind === "export") {
                const source = x.field(n, "source"), declaration = x.field(n, "declaration"), value = x.field(n, "value");
                const specs = specifiers.get(n.id) ?? [];
                for (const spec of specs.length ? specs : [null]) {
                    const site = spec ? x.query.byId(spec.astNodeId)! : n;
                    const localNode = spec ? x.field(site, "name") : value;
                    const ref = !source && localNode?.type === "identifier" ? x.references.get(localNode.id) : undefined;
                    let target = source ? emptyTarget("deferred") : referenceTarget(ref);
                    const de = declaration ? (x.entitiesByNode.get(declaration.id) ?? []).find(e => ["function", "class", "variable_declaration"].includes(e.kind)) : value ? x.entity(value, ["function", "class"]) : undefined;
                    if (!source && de) target = { status: "established", entityId: de.entityId, symbolId: null, meaning: "syntactic_entity" };
                    if (x.unreliable.has(n.id)) target = emptyTarget("invalid");
                    const r = base(site, "exports_syntax", target); r.source = { ...r.source, entityId: x.module.entityId, context: "module", enclosingCallableEntityId: null };
                    if (target.status === "established" && target.meaning === "syntactic_entity") r.classification = "syntax";
                    r.syntax.moduleSpecifier = x.slice(source); r.syntax.expression = x.slice(localNode ?? declaration ?? value ?? site);
                    r.syntax.exportedName = spec?.name ?? (entity.properties.default === true ? "default" : null);
                    r.syntax.localName = !source && typeof spec?.properties.localOrImportedName === "string" ? spec.properties.localOrImportedName : null;
                    r.syntax.exportKind = source ? entity.properties.star === true ? "star" : "reexport" : declaration ? "declaration" : entity.properties.default === true ? "default" : "local";
                    r.evidence.metadataEntityIds.push(entity.entityId); if (spec) r.evidence.metadataEntityIds.push(spec.entityId); attachReference(r, ref);
                    if (source) r.limitations.push("MODULE_AND_PACKAGE_TARGET_DEFERRED"); emit(r);
                }
            }
        }
        const diagnostics = [] as RelationshipDocument["diagnostics"];
        const partial = resolution.status === "partial" || metadata.extractionStatus === "partial" || ast.parseStatus === "syntax_errors" || relationships.some(r => r.target.status !== "established");
        return { schemaVersion: 1, analyzerVersion: ANALYZER_VERSION, inputs, upstreamStatus: resolution.status, status: partial ? "partial" : "complete", relationships, counts, diagnostics,
            upstreamDiagnostics: { ast: ast.diagnostics, metadata: metadata.diagnostics, resolution: resolution.diagnostics, references: resolution.references.filter(r => r.diagnostics.length).map(r => ({ referenceId: r.id, diagnostics: r.diagnostics })) } };
    }
}
