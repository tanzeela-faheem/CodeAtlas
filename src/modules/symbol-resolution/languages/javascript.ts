import type { AstDocument, AstNode } from "../../ast-management/model.js";
import { AstQuery } from "../../ast-management/query.js";
import { NameResolver } from "../core/NameResolver.js";
import { digest, matchEvidence } from "../integration/contracts.js";
import { RESOLVER_VERSION, ResolutionError, type BindingKind, type Diagnostic, type MetadataDocument, type MetadataEntity, type MetadataReference, type ReferenceRecord, type ResolutionDocument, type ScopeRecord, type SymbolRecord } from "../model.js";

export interface LanguageResolver {
    supports(ast: AstDocument): boolean;
    resolve(ast: AstDocument, metadata: MetadataDocument, reference: MetadataReference): ResolutionDocument;
}
const functions = new Set(["function_declaration", "generator_function_declaration", "function_expression", "generator_function", "arrow_function", "method_definition"]);
const declarations = new Set(["function_declaration", "generator_function_declaration"]);
const identifierTypes = new Set(["identifier", "shorthand_property_identifier", "shorthand_property_identifier_pattern"]);
export class JavascriptResolver implements LanguageResolver {
    supports(ast: AstDocument): boolean {
        return ast.language === "JavaScript" && ast.parserId === "tree-sitter-javascript" && ast.parserVersion === "0.25.1" && ast.grammarVersion === "0.25.0";
    }
    resolve(ast: AstDocument, metadata: MetadataDocument, reference: MetadataReference): ResolutionDocument {
        matchEvidence(ast, metadata, reference);
        if (!this.supports(ast)) throw new ResolutionError("UNSUPPORTED_LANGUAGE");
        if (ast.nodes.length > 10000 || metadata.entities.length > 10000) throw new ResolutionError("RESOLUTION_RESOURCE_LIMIT", 413);
        const query = new AstQuery(ast), scopes: ScopeRecord[] = [], symbols: SymbolRecord[] = [], refs: ReferenceRecord[] = [], diagnostics: Diagnostic[] = [];
        const byScope = new Map<string, ScopeRecord>(), nodeScope = new Map<string, string>(), bindingNodes = new Set<string>(), excluded = new Set<string>(), varHosts = new Set<string>();
        const argumentsHosts = new Set<string>(), bodyLexicalScopes = new Set<string>();
        const uncertain = new Set<string>(), blocked = new Map<string, Set<string>>();
        const variables = new Map(metadata.entities.filter(e => e.kind === "variable").map(e => [e.properties.bindingAstNodeId, e]));
        const entities = new Map<string, MetadataEntity[]>();
        for (const e of metadata.entities) entities.set(e.astNodeId, [...(entities.get(e.astNodeId) ?? []), e]);
        const field = (n: AstNode, f: string) => query.children(n.id).find(c => c.fieldName === f);
        const children = (n: AstNode) => query.children(n.id);
        const range = (n: AstNode) => ({ start: n.start, end: n.end });
        const id = (prefix: string, ...parts: string[]) => `${prefix}-${digest([RESOLVER_VERSION, reference.astArtifactId, reference.artifactId, reference.documentHash, ...parts])}`;
        const diag = (code: string, n: AstNode, message: string): Diagnostic => ({ code, astNodeId: n.id, message });
        const issue = (code: string, n: AstNode, message: string) => diagnostics.push(diag(code, n, message));
        const addScope = (n: AstNode, kind: ScopeRecord["kind"], parentId: string | null): string => {
            const scope: ScopeRecord = { id: id("scope", n.id, kind), kind, parentId, astNodeId: n.id, range: range(n), children: [], bindings: [] };
            scopes.push(scope); byScope.set(scope.id, scope); if (parentId) byScope.get(parentId)!.children.push(scope.id); return scope.id;
        };
        const root = query.byId(ast.rootId)!;
        const moduleScope = addScope(root, "module", null); varHosts.add(moduleScope);
        const nearestVar = (scope: string): string => {
            while (!varHosts.has(scope)) scope = byScope.get(scope)!.parentId!;
            return scope;
        };
        const blockName = (scope: string, name: string) => { let set = blocked.get(scope); if (!set) blocked.set(scope, set = new Set()); set.add(name); };
        const findEntity = (n: AstNode, kind: string) => entities.get(n.id)?.find(e => e.kind === kind);
        function pattern(n: AstNode | undefined): AstNode[] {
            if (!n) return [];
            if (n.type === "identifier" || n.type === "shorthand_property_identifier_pattern") return [n];
            if (["assignment_pattern", "object_assignment_pattern"].includes(n.type)) return pattern(field(n, "left"));
            if (n.type === "pair_pattern") return pattern(field(n, "value"));
            if (["array_pattern", "object_pattern", "rest_pattern"].includes(n.type)) return children(n).filter(c => c.named && c.type !== "comment").flatMap(pattern);
            return [];
        }
        const addBinding = (nameNode: AstNode, owner: AstNode, kind: BindingKind, scope: string, entity: MetadataEntity | undefined, initializationOffset: number | null, imported: SymbolRecord["import"] = null) => {
            bindingNodes.add(nameNode.id);
            const name = nameNode.text;
            if (!name || nameNode.error || nameNode.missing) { uncertain.add(scope); return; }
            if ((kind !== "catch" && !entity) || (entity && entity.name !== name && !["parameter", "catch"].includes(kind))) {
                blockName(scope, name); issue("MISSING_DECLARATION_EVIDENCE", owner, "No matching extracted declaration; this name blocks outer lookup."); return;
            }
            const declaration = { metadataEntityId: entity?.entityId ?? null, astNodeId: owner.id, range: range(owner) };
            // Repeated var declarations denote a single binding. Other collisions stay explicit.
            const merge = symbols.find(s => s.scopeId === scope && s.name === name && ((kind === "var" && s.kind === "var") || (byScope.get(scope)!.kind === "function" && ["var", "function", "parameter"].includes(kind) && ["var", "function", "parameter"].includes(s.kind) && kind !== "parameter")));
            if (merge) { merge.declarations.push(declaration); return; }
            const symbol: SymbolRecord = { id: id("symbol", scope, nameNode.id, kind), name, kind, scopeId: scope, bindingNodeId: nameNode.id, declarations: [declaration], initializationOffset,
                modifiers: Object.entries(entity?.attributes ?? {}).filter(([, val]) => val === true).map(([key]) => key).sort(), import: imported };
            symbols.push(symbol); byScope.get(scope)!.bindings.push(symbol.id);
        };
        let dynamic = false;
        if (ast.nodes.some(n => identifierTypes.has(n.type) && n.text?.includes("\\"))) { dynamic = true; issue("IDENTIFIER_ESCAPE_DEFERRED", root, "Escaped identifier spelling requires normalization before reliable lexical lookup."); }
        const visit = (n: AstNode, incoming: string, isFunctionBody = false): void => {
            let scope = incoming;
            if (n.error || n.missing) {
                uncertain.add(scope); issue("INCOMPLETE_SYNTAX", n, "Malformed syntax can hide declarations in this environment.");
                for (const c of children(n)) visit(c, scope);
                nodeScope.set(n.id, scope); return;
            }
            let callee = n.type === "call_expression" ? field(n, "function") : undefined;
            while (callee?.type === "parenthesized_expression") callee = children(callee).find(c => c.named && c.type !== "comment");
            if (n.type === "with_statement" || callee?.text === "eval") {
                dynamic = true; issue("DYNAMIC_ENVIRONMENT", n, "with/direct eval semantics are outside the supported lexical subset.");
            }
            if (functions.has(n.type)) {
                const name = field(n, "name"), entity = (entities.get(n.id) ?? []).find(e => ["function", "method", "constructor"].includes(e.kind));
                if (declarations.has(n.type) && n.parentId && !["program", "statement_block", "export_statement"].includes(query.byId(n.parentId)!.type)) {
                    dynamic = true; issue("LEGACY_FUNCTION_SCOPE_DEFERRED", n, "Non-block statement function declarations require unsupported source-goal/Annex B rules.");
                }
                if (name && declarations.has(n.type)) addBinding(name, n, "function", bodyLexicalScopes.has(scope) ? nearestVar(scope) : scope, entity, null);
                else if (name && n.type !== "method_definition") {
                    scope = addScope(n, "function-name", scope);
                    addBinding(name, n, "function-name", scope, entity, null);
                }
                // Computed method names execute in the outer environment.
                if (n.type === "method_definition" && name) { visit(name, incoming); excluded.add(name.id); }
                const params = field(n, "parameters") ?? field(n, "parameter");
                const candidates = params?.type === "formal_parameters" ? children(params).filter(c => c.named && c.type !== "comment") : params ? [params] : [];
                const complex = candidates.some(p => p.type !== "identifier");
                const paramScope = complex ? addScope(n, "parameters", scope) : addScope(n, "function", scope);
                if (!complex) varHosts.add(paramScope);
                if (n.type !== "arrow_function") argumentsHosts.add(paramScope);
                for (const p of candidates) for (const b of pattern(p)) addBinding(b, p, "parameter", paramScope, findEntity(p, "parameter"), complex ? p.end.offset : null);
                nodeScope.set(n.id, paramScope);
                if (params) visit(params, paramScope);
                const bodyScope = complex ? addScope(n, "function", paramScope) : paramScope;
                varHosts.add(bodyScope);
                const body = field(n, "body"); if (body) visit(body, bodyScope, true);
                return;
            }
            if (n.type === "class_declaration" || n.type === "class") {
                const name = field(n, "name"), entity = findEntity(n, "class");
                if (name && n.type === "class_declaration") addBinding(name, n, "class", scope, entity, n.end.offset);
                scope = addScope(n, "class", scope);
                if (name) addBinding(name, n, "class-name", scope, entity, n.end.offset);
            } else if (n.type === "catch_clause") {
                scope = addScope(n, "catch", scope);
                const param = field(n, "parameter");
                // Producer v1 has no catch entity: retain explicit AST-only evidence.
                if (param) for (const b of pattern(param)) addBinding(b, param, "catch", scope, undefined, param.end.offset);
            } else if ((n.type === "statement_block" && !isFunctionBody) || n.type === "switch_body" || ["for_statement", "for_in_statement"].includes(n.type)) {
                scope = addScope(n, "block", scope);
            } else if (n.type === "statement_block" && isFunctionBody) {
                // Body lexical declarations must not be visible to parameter default expressions.
                scope = addScope(n, "block", scope); bodyLexicalScopes.add(scope);
            } else if (n.type === "class_static_block") {
                scope = addScope(n, "block", scope); varHosts.add(scope);
            }
            nodeScope.set(n.id, scope);
            if (n.type === "for_in_statement" && field(n, "kind")) {
                const target = field(n, "kind")!.text === "var" ? nearestVar(scope) : scope;
                for (const b of pattern(field(n, "left"))) { bindingNodes.add(b.id); if (b.text) blockName(target, b.text); }
                issue("LOOP_BINDING_METADATA_UNAVAILABLE", n, "Producer v1 omits for-in/of bindings; outer lookup is blocked for these names.");
            }
            if (n.type === "variable_declarator") {
                const container = query.byId(n.parentId!)!;
                const kind = (field(container, "kind")?.text ?? "var") as BindingKind;
                const target = kind === "var" ? nearestVar(scope) : scope;
                for (const b of pattern(field(n, "name"))) {
                    const candidate = variables.get(b.id);
                    const bindingCount = pattern(field(n, "name")).length;
                    const entity = candidate?.properties.declaratorAstNodeId === n.id && candidate.astNodeId === (bindingCount === 1 ? n.id : b.id) ? candidate : undefined;
                    addBinding(b, n, kind, target, entity, kind === "var" ? null : n.end.offset);
                }
            }
            if (n.type === "import_statement") {
                const source = field(n, "source");
                const specifier = source ? query.children(source.id).filter(c => c.named).map(c => c.text ?? "").join("") : "";
                for (const e of metadata.entities.filter(e => e.kind === "import_specifier" && e.sourceRange.start.offset >= n.start.offset && e.sourceRange.end.offset <= n.end.offset)) {
                    const owner = query.byId(e.astNodeId)!;
                    const local = owner.type === "identifier" ? owner : field(owner, "alias") ?? field(owner, "name") ?? children(owner).find(c => c.type === "identifier");
                    if (local && typeof e.properties.importedName !== "string") { bindingNodes.add(local.id); if (local.text) blockName(moduleScope, local.text); issue("IMPORT_NAME_DEFERRED", owner, "This imported name syntax is not supported by the verified metadata contract."); continue; }
                    if (local) addBinding(local, owner, "import", moduleScope, e, null, { importedName: typeof e.properties.importedName === "string" ? e.properties.importedName : "", moduleSpecifier: specifier, targetStatus: "deferred" });
                }
            }
            for (const c of children(n)) visit(c, scope);
        };
        visit(root, moduleScope);
        // Early errors are not guaranteed to appear as Tree-sitter ERROR nodes.
        for (const lexical of symbols.filter(s => ["let", "const", "class"].includes(s.kind))) {
            let outer = byScope.get(lexical.scopeId)!;
            if (bodyLexicalScopes.has(outer.id) && outer.parentId) {
                const host = outer.parentId;
                if (symbols.some(s => s.scopeId === host && s.name === lexical.name)) {
                    blockName(outer.id, lexical.name);
                    issue("LEXICAL_DECLARATION_CONFLICT", query.byId(lexical.bindingNodeId)!, "Body lexical declaration conflicts with a parameter or var/function binding.");
                }
            }
            // A var declared within this lexical environment cannot bypass its early-error conflict.
            for (const variable of symbols.filter(s => s.kind === "var" && s.name === lexical.name)) {
                for (const declaration of variable.declarations) {
                    let current = byScope.get(nodeScope.get(declaration.astNodeId) ?? moduleScope);
                    while (current && current.id !== variable.scopeId) {
                        if (current.id === lexical.scopeId) { blockName(current.id, lexical.name); issue("LEXICAL_VAR_CONFLICT", query.byId(lexical.bindingNodeId)!, "Lexical and var declarations conflict."); break; }
                        current = current.parentId ? byScope.get(current.parentId) : undefined;
                    }
                }
            }
        }
        for (const scope of argumentsHosts) if (!symbols.some(s => s.scopeId === scope && s.name === "arguments")) blockName(scope, "arguments");
        const resolver = new NameResolver(scopes, symbols);
        for (const scope of scopes) {
            const names = new Map<string, number>();
            for (const s of symbols.filter(s => s.scopeId === scope.id)) names.set(s.name, (names.get(s.name) ?? 0) + 1);
            if ([...names.values()].some(n => n > 1)) issue("DUPLICATE_BINDING", query.byId(scope.astNodeId)!, "Conflicting or unsupported duplicate declarations remain ambiguous.");
        }
        for (const n of ast.nodes) {
            if (!identifierTypes.has(n.type) || bindingNodes.has(n.id) || !n.text) continue;
            const ancestors = query.ancestors(n.id), parent = ancestors[0];
            if (!parent) continue;
            if (ancestors.some(a => a.type === "import_statement")) continue;
            if (["labeled_statement", "break_statement", "continue_statement"].includes(parent.type)) continue;
            if (parent.type === "pair" && n.fieldName === "key") continue;
            if (parent.type === "member_expression" && n.fieldName === "property") continue;
            if (parent.type === "jsx_attribute" && n.fieldName !== "value") continue;
            if (ancestors.some(a => ["jsx_opening_element", "jsx_closing_element", "jsx_self_closing_element"].includes(a.type)) && !ancestors.some(a => a.type === "jsx_expression")) continue;
            if (parent.type === "namespace_export") continue;
            if (parent.type === "export_specifier" && (n.fieldName === "alias" || ancestors.some(a => a.type === "export_statement" && !!field(a, "source")))) continue;
            if (excluded.has(n.id)) continue;
            const scope = nodeScope.get(n.id) ?? moduleScope;
            let targetNode = n;
            let targetParent = parent;
            // Walk only assignment-pattern value positions; computed keys/default RHS remain reads.
            while (["array_pattern", "object_pattern", "rest_pattern", "pair_pattern", "assignment_pattern", "object_assignment_pattern"].includes(targetParent.type)) {
                if ((targetParent.type === "pair_pattern" && targetNode.fieldName !== "value") || (["assignment_pattern", "object_assignment_pattern"].includes(targetParent.type) && targetNode.fieldName !== "left")) break;
                targetNode = targetParent;
                const next = targetParent.parentId ? query.byId(targetParent.parentId) : undefined;
                if (!next) break;
                targetParent = next;
            }
            const usage: ReferenceRecord["usage"] = parent.type === "export_specifier" ? "export" : parent.type === "call_expression" && n.fieldName === "function" ? "call"
                : parent.type === "update_expression" ? "read_write" : ["assignment_expression", "augmented_assignment_expression", "for_in_statement"].includes(targetParent.type) && targetNode.fieldName === "left" ? targetParent.type === "augmented_assignment_expression" ? "read_write" : "write" : "read";
            const found = resolver.lookup(scope, n.text);
            let barrier: "invalid" | "unsupported" | null = null;
            let current: ScopeRecord | undefined = byScope.get(scope);
            while (current) {
                if (uncertain.has(current.id)) { barrier = "invalid"; break; }
                if (blocked.get(current.id)?.has(n.text)) { barrier = "unsupported"; break; }
                if (found.some(s => s.scopeId === current!.id)) break;
                current = current.parentId === null ? undefined : byScope.get(current.parentId);
            }
            if (ancestors.some(a => a.error || a.missing) || n.error || n.missing) barrier = "invalid";
            if (dynamic) barrier = "unsupported";
            const status = barrier ?? (found.length === 1 ? "resolved" : found.length > 1 ? "ambiguous" : "unresolved");
            const target = status === "resolved" ? found[0]! : null;
            const refDiagnostics: Diagnostic[] = [];
            if (status !== "resolved") refDiagnostics.push(diag(status === "unresolved" ? "UNRESOLVED_OR_ENVIRONMENT_GLOBAL" : status.toUpperCase(), n, status === "unresolved" ? "No lexical declaration; environment globals are not modeled." : "Evidence does not establish a unique supported lexical target."));
            // Source order alone cannot establish initialization at closure invocation or across branches.
            const sameExecution = (scopeId: string): string => { let s = byScope.get(scopeId)!; while (!["function", "parameters", "module"].includes(s.kind) && s.parentId) s = byScope.get(s.parentId)!; return s.id; };
            const declarationNode = target ? query.byId(target.declarations[0]!.astNodeId) : undefined;
            const bindingPattern = declarationNode?.type === "variable_declarator" ? field(declarationNode, "name") : declarationNode;
            const complexInitialization = target?.kind === "class-name" || ancestors.some(a => a.type === "class_body") ||
                (!!bindingPattern && (["object_pattern", "array_pattern"].includes(bindingPattern.type) || (bindingPattern.type === "assignment_pattern" && ["object_pattern", "array_pattern"].includes(field(bindingPattern, "left")?.type ?? ""))));
            const before = !complexInitialization && target?.initializationOffset !== null && target !== null && n.start.offset < target.initializationOffset;
            const initialization: ReferenceRecord["initialization"] = !target || target.initializationOffset === null ? "not_applicable"
                : before && sameExecution(scope) === sameExecution(target.scopeId) ? "before_initialization" : "runtime_unknown";
            if (target && target.initializationOffset !== null) refDiagnostics.push(diag("INITIALIZATION_REQUIRES_RUNTIME", n, "Source ordering is recorded; control flow and closure invocation are not evaluated."));
            refs.push({ id: id("ref", n.id), name: n.text, astNodeId: n.id, range: range(n), scopeId: scope, usage, status, symbolId: target?.id ?? null, candidates: status === "ambiguous" ? found.map(s => s.id) : [], initialization, diagnostics: refDiagnostics });
        }
        if (ast.parseStatus === "syntax_errors") issue("SOURCE_SYNTAX_ERRORS", root, "AST diagnostics are preserved; affected environments are conservative.");
        if (metadata.extractionStatus === "partial") issue("PARTIAL_METADATA", root, "Metadata extraction was partial.");
        if (ast.nodes.some(n => n.type.startsWith("jsx_"))) issue("JSX_TAGS_DEFERRED", root, "JSX tags are not resolved; embedded expressions use lexical lookup.");
        if (ast.nodes.some(n => n.type === "export_statement" && (field(n, "source") || children(n).some(c => c.type === "*")))) issue("MODULE_TARGET_DEFERRED", root, "Re-export targets require a separate module resolver.");
        const { nodes: _, diagnostics: __, ...provenance } = ast;
        return { schemaVersion: 1, resolverVersion: RESOLVER_VERSION, sourceAst: { ...provenance, normalizationVersion: ast.normalizationVersion ?? null }, astArtifactId: reference.astArtifactId, metadataArtifact: reference,
            status: diagnostics.length || refs.some(r => r.status !== "resolved") ? "partial" : "complete", scopes, symbols, references: refs, diagnostics, astDiagnostics: ast.diagnostics, metadataDiagnostics: metadata.diagnostics };
    }
}
