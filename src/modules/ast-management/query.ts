import { validateAst } from "./serializer.js";
import type { AstDocument, AstNode } from "./model.js";
export class AstQuery {
    private readonly nodes: Map<string, AstNode>;
    constructor(private readonly document: AstDocument) {
        validateAst(document);
        this.nodes = new Map(document.nodes.map((n) => [n.id, n]));
    }
    byId(id: string): AstNode | undefined {
        return this.nodes.get(id);
    }
    matching(predicate: (node: AstNode) => boolean): AstNode[] {
        return this.document.nodes.filter(predicate);
    }
    byType(type: string): AstNode[] {
        return this.matching((n) => n.type === type);
    }
    within(start: number, end: number): AstNode[] {
        return start > end ? [] : this.matching((n) => n.start.offset >= start && n.end.offset <= end);
    }
    children(id: string): AstNode[] {
        return (this.byId(id)?.children ?? []).flatMap((x) => this.byId(x) ?? []);
    }
    ancestors(id: string): AstNode[] {
        const result: AstNode[] = [],
            seen = new Set<string>();
        let current = this.byId(id);
        while (current?.parentId && !seen.has(current.parentId)) {
            seen.add(current.parentId);
            current = this.byId(current.parentId);
            if (current) result.push(current);
        }
        return result;
    }
}
