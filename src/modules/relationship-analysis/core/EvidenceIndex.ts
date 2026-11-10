import { AstQuery } from "../../ast-management/query.js";
import type { AstNode } from "../../ast-management/model.js";
import type { MetadataEntity } from "../../symbol-resolution/model.js";
import type { FileEvidence } from "../contracts.js";
import type { RelationshipRecord, SyntaxSlice } from "../model.js";
export class EvidenceIndex {
    readonly query: AstQuery;
    readonly entities: Map<string, MetadataEntity>;
    readonly entitiesByNode = new Map<string, MetadataEntity[]>();
    readonly references;
    readonly symbols;
    readonly module: MetadataEntity;
    readonly unreliable = new Set<string>();
    constructor(readonly evidence: FileEvidence) {
        this.query = new AstQuery(evidence.ast);
        this.entities = new Map(evidence.metadata.entities.map(e => [e.entityId, e]));
        for (const entity of evidence.metadata.entities) this.entitiesByNode.set(entity.astNodeId, [...(this.entitiesByNode.get(entity.astNodeId) ?? []), entity]);
        this.references = new Map(evidence.resolution.references.map(r => [r.astNodeId, r]));
        this.symbols = new Map(evidence.resolution.symbols.map(s => [s.id, s]));
        this.module = evidence.metadata.entities.find(e => e.kind === "module" && e.parentEntityId === null)!;
        const stack = [{ node: this.query.byId(evidence.ast.rootId)!, visited: false }];
        while (stack.length) {
            const current = stack.pop()!;
            if (!current.visited) {
                stack.push({ node: current.node, visited: true });
                for (const child of this.children(current.node)) stack.push({ node: child, visited: false });
            } else if (current.node.error || current.node.missing || current.node.children.some(id => this.unreliable.has(id))) this.unreliable.add(current.node.id);
        }
    }
    children(n: AstNode): AstNode[] { return this.query.children(n.id); }
    field(n: AstNode, name: string): AstNode | undefined { return this.children(n).find(c => c.fieldName === name); }
    entity(n: AstNode, kinds: string[]): MetadataEntity | undefined { return this.entitiesByNode.get(n.id)?.find(e => kinds.includes(e.kind)); }
    slice(n: AstNode | undefined): SyntaxSlice | null {
        if (!n) return null;
        const tokens: SyntaxSlice["tokens"] = [], stack = [n]; let chars = 0, truncated = false;
        while (stack.length) {
            const current = stack.pop()!;
            if (current.text !== undefined) {
                const remaining = 4096 - chars;
                if (tokens.length >= 128 || remaining <= 0) { truncated = true; break; }
                const text = current.text.slice(0, remaining); tokens.push({ astNodeId: current.id, text }); chars += text.length;
                if (text.length !== current.text.length) { truncated = true; break; }
            }
            stack.push(...this.children(current).reverse());
        }
        return { astNodeId: n.id, tokens, truncated };
    }
    /** Execution context is independent of arbitrary metadata parent ownership. */
    source(n: AstNode): RelationshipRecord["source"] {
        let child = n;
        let initializer: { entityId: string; context: "initializer" } | null = null;
        const complete = (entityId: string, context: RelationshipRecord["source"]["context"], enclosingCallableEntityId: string | null): RelationshipRecord["source"] => ({ entityId, context, enclosingCallableEntityId, moduleEntityId: this.module.entityId });
        for (const parent of this.query.ancestors(n.id)) {
            const callable = this.entity(parent, ["function", "method", "constructor"]);
            if (callable && ["body", "parameters", "parameter"].includes(child.fieldName ?? "")) return complete(initializer?.entityId ?? callable.entityId, initializer ? "initializer" : "callable", callable.entityId);
            if (parent.type === "field_definition" && child.fieldName === "value") {
                const field = this.entity(parent, ["field"]); if (field && !initializer) initializer = { entityId: field.entityId, context: "initializer" };
            }
            if (parent.type === "class_static_block") {
                const cls = this.query.ancestors(parent.id).find(a => a.type === "class_declaration" || a.type === "class");
                if (cls) { const entity = this.entity(cls, ["class"]); if (entity && !initializer) initializer = { entityId: entity.entityId, context: "initializer" }; }
            }
            if (parent.type === "variable_declarator") {
                const owner = this.entity(parent, ["variable"]);
                if (owner && !initializer) initializer = { entityId: owner.entityId, context: "initializer" };
            }
            child = parent;
        }
        return complete(initializer?.entityId ?? this.module.entityId, initializer ? "initializer" : "module", null);
    }
}
