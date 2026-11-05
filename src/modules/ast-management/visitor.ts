import { validateAst } from "./serializer.js";
import type { AstDocument, AstNode } from "./model.js";
// false stops the whole traversal; filters affect callbacks, not descent.
export function visitDepthFirst(
    document: AstDocument,
    visitor: (node: AstNode) => void | boolean,
    filter: (node: AstNode) => boolean = () => true
): void {
    validateAst(document);
    const nodes = new Map(document.nodes.map((node) => [node.id, node]));
    const stack = [document.rootId],
        seen = new Set<string>();
    while (stack.length) {
        const id = stack.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        const node = nodes.get(id);
        if (!node) continue;
        if (filter(node) && visitor(node) === false) return;
        for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]!);
    }
}
