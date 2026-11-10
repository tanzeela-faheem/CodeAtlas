import type { ScopeRecord, SymbolRecord } from "../model.js";
/** Lookup stops at the first environment containing this name, including conflicts. */
export class NameResolver {
    private readonly scopes: Map<string, ScopeRecord>;
    private readonly bindings = new Map<string, Map<string, SymbolRecord[]>>();
    constructor(scopes: ScopeRecord[], symbols: SymbolRecord[]) {
        this.scopes = new Map(scopes.map(s => [s.id, s]));
        for (const symbol of symbols) {
            let names = this.bindings.get(symbol.scopeId);
            if (!names) this.bindings.set(symbol.scopeId, names = new Map());
            names.set(symbol.name, [...(names.get(symbol.name) ?? []), symbol]);
        }
    }
    lookup(scopeId: string, name: string): SymbolRecord[] {
        let scope = this.scopes.get(scopeId);
        while (scope) {
            const found = this.bindings.get(scope.id)?.get(name);
            if (found) return found;
            scope = scope.parentId === null ? undefined : this.scopes.get(scope.parentId);
        }
        return [];
    }
}
