import { describe, expect, it } from "vitest";
import { AstBuilder } from "../../ast-management/builder.js";
import { composeParsers } from "../../analysis/parser-composition.js";
import { serializeAst } from "../../ast-management/serializer.js";
import { JavascriptResolver } from "../../symbol-resolution/languages/javascript.js";
import { JavascriptRelationshipAnalyzer } from "../languages/javascript.js";
import { DEFAULT_LIMITS, type RelationshipKind, type RelationshipRecord } from "../model.js";
import { validateRelationshipDocument } from "../validation.js";
import { evidence, source, metadataAnalysis } from "./test-helpers.js";
const analyze = (name: string) => { const e = evidence(name), result = new JavascriptRelationshipAnalyzer().analyze(e); validateRelationshipDocument(result); return result; };
const expression = (r: RelationshipRecord) => r.syntax.expression?.tokens.map(t => t.text).join('') ?? '';
const kind = (name: string, k: RelationshipKind) => analyze(name).relationships.filter(r => r.kind === k);
describe('relationship evidence policy', () => {
    it.each(['calls', 'mutation', 'constructors', 'modules', 'containment', 'partial', 'semantics', 'dynamic', 'ambiguous'])('uses native AST + exact producer metadata and resolver snapshot: %s', name => {
        const e = evidence(name), parsed = composeParsers().manager.parse({ projectId: e.ast.projectId, relativePath: e.ast.relativePath, language: e.ast.language, sourceCode: source(name) });
        if (parsed.status === 'failed') throw new Error(parsed.code);
        const ast = new AstBuilder().build(parsed, { analysisId: e.ast.analysisId, language: e.ast.language, contentHash: e.ast.contentHash });
        expect(serializeAst({ ...ast, createdAt: e.ast.createdAt })).toBe(serializeAst(e.ast));
        expect(new JavascriptResolver().resolve(e.ast, e.metadata, e.resolution.metadataArtifact)).toEqual(e.resolution);
        const result = analyze(name); expect(result).toEqual(analyze(name));
        expect(new Set(result.relationships.map(r => r.relationshipId)).size).toBe(result.relationships.length);
        expect(result.relationships.every(r => r.relationshipId.startsWith('rel-'))).toBe(true);
    });
    it('establishes only direct supported function declaration/internal-name targets, with correct recursion and nesting', () => {
        const e = evidence('calls'), calls = kind('calls', 'calls'), entities = new Map(e.metadata.entities.map(m => [m.entityId, m]));
        expect(calls.find(r => expression(r) === 'greet')!.target.status).toBe('established');
        const recursive = calls.find(r => expression(r) === 'recursive')!;
        expect(entities.get(recursive.source.entityId)?.name).toBe('recursive'); expect(recursive.source.entityId).toBe(recursive.target.entityId);
        const nested = calls.find(r => expression(r) === 'greet' && entities.get(r.source.entityId)?.name === 'inner')!;
        expect(nested.source.context).toBe('callable'); expect(nested.source.entityId).not.toBe(calls.find(r => expression(r) === 'inner')!.source.entityId);
        const internal = kind('semantics', 'calls').find(r => expression(r) === 'internal')!; expect(internal.target.status).toBe('established');
    });
    it('never promotes shadowed scalar, alias or variable-bound function values to verified call targets', () => {
        const calls = kind('calls', 'calls');
        for (const name of ['callback', 'lambda', 'value']) {
            const r = calls.find(r => expression(r) === name)!;
            expect(r.target).toMatchObject({ status: 'deferred', entityId: null, symbolId: null }); expect(r.evidence.bindingSymbolId).toMatch(/^symbol-/);
        }
        expect(calls.filter(r => expression(r) === 'greet').some(r => r.target.status === 'deferred')).toBe(true);
    });
    it('retains property/computed/optional/unknown/imported calls as distinct candidates', () => {
        const calls = kind('calls', 'calls');
        for (const name of ['obj.run', 'obj[key]']) expect(calls.find(r => expression(r) === name)!.target.status).toBe('unsupported');
        expect(calls.find(r => r.limitations.includes('OPTIONAL_DISPATCH_DEFERRED'))!.target.symbolId).toBeNull();
        expect(calls.find(r => expression(r) === 'unknown')!.target.status).toBe('unresolved');
        for (const name of ['run', 'main']) expect(kind('modules', 'calls').find(r => expression(r) === name)!.limitations).toContain('EXTERNAL_TARGET_DEFERRED');
        expect(kind('ambiguous', 'calls')[0]!.target.status).toBe('ambiguous');
        expect(kind('ambiguous', 'calls')[0]!.evidence.candidateSymbolIds).toHaveLength(2);
    });
    it('attributes JSX, method, default-parameter and computed-key call sites without inventing callers', () => {
        const e = evidence('calls'), calls = kind('calls', 'calls'), entities = new Map(e.metadata.entities.map(m => [m.entityId, m]));
        expect(calls.some(r => entities.get(r.source.entityId)?.name === 'method' && r.source.context === 'callable')).toBe(true);
        const jsx = calls.find(r => entities.get(r.source.entityId)?.name === 'View')!; expect(jsx.source.enclosingCallableEntityId).toBeNull(); expect(entities.get(jsx.source.moduleEntityId)?.kind).toBe('module');
        const sem = evidence('semantics'), names = new Map(sem.metadata.entities.map(m => [m.entityId, m]));
        const rs = kind('semantics', 'calls');
        expect(rs.some(r => names.get(r.source.entityId)?.name === 'defaults' && r.source.context === 'callable')).toBe(true);
        expect(rs.some(r => names.get(r.source.entityId)?.kind === 'field' && r.source.context === 'initializer')).toBe(true);
        const computed = rs.filter(r => r.source.context === 'module' || names.get(r.source.entityId)?.name === 'object');
        expect(computed.length).toBeGreaterThanOrEqual(2); expect(computed.every(r => r.source.enclosingCallableEntityId === null)).toBe(true);
    });
    it('defers changed function/class bindings while allowing independent stable declarations', () => {
        const rs = analyze('mutation').relationships;
        expect(rs.find(r => r.kind === 'calls' && expression(r) === 'changed')!.target.status).toBe('deferred');
        expect(rs.find(r => r.kind === 'calls' && expression(r) === 'stable')!.target.status).toBe('established');
        expect(rs.find(r => r.kind === 'constructs')!.limitations).toContain('BINDING_MUTATION_OR_UNKNOWN_WRITE');
    });
    it('establishes unchanged local class construction and preserves imported/alias/computed/dynamic creation syntax', () => {
        const rs = kind('constructors', 'constructs');
        expect(rs.filter(r => expression(r) === 'Local').every(r => r.target.meaning === 'class_declaration')).toBe(true);
        expect(rs.find(r => expression(r) === 'Nested')!.target.status).toBe('established');
        for (const [name, status] of [['Remote', 'deferred'], ['Alias', 'deferred'], ['Factory', 'deferred'], ['Unknown', 'unresolved'], ['factories[key]', 'unsupported'], ['(factory())', 'unsupported']]) expect(rs.find(r => expression(r) === name)!.target.status).toBe(status);
    });
    it('keeps local, imported, unknown, dynamic and class-expression heritage syntactically distinct', () => {
        const e = evidence('constructors'), rs = kind('constructors', 'extends_syntax');
        expect(rs).toHaveLength(6);
        expect(rs.filter(r => expression(r) === 'Local').every(r => r.target.status === 'established' && r.classification === 'syntax')).toBe(true);
        expect(rs.find(r => expression(r) === 'Remote')!.target.status).toBe('deferred');
        expect(rs.find(r => expression(r) === 'factory()')!.target.entityId).toBeNull();
        expect(rs.find(r => expression(r) === 'Missing')!.target.status).toBe('unresolved');
        expect(rs.some(r => e.metadata.entities.find(m => m.entityId === r.source.entityId)?.name === 'Internal')).toBe(true);
    });
    it('preserves all import forms, local aliases and raw source tokens without linked module/package endpoints', () => {
        const rs = kind('modules', 'imports_syntax');
        expect(rs).toHaveLength(5);
        expect(new Set(rs.map(r => r.syntax.importKind))).toEqual(new Set(['default', 'named', 'namespace', 'side_effect']));
        expect(rs.find(r => r.syntax.localName === 'run')!.syntax.importedName).toBe('calculate');
        expect(rs.every(r => r.target.status === 'deferred' && r.target.entityId === null && r.target.symbolId === null)).toBe(true);
        expect(rs.find(r => r.syntax.localName === 'main')!.syntax.moduleSpecifier!.tokens.map(t => t.text).join('')).toBe("'./utils.js'");
    });
    it('links supported local export bindings/declarations and keeps reexports/star external targets null', () => {
        const rs = kind('modules', 'exports_syntax');
        expect(rs.find(r => r.syntax.exportedName === 'calculate')!.target.meaning).toBe('lexical_binding');
        expect(rs.some(r => r.syntax.exportKind === 'declaration' && r.target.meaning === 'syntactic_entity')).toBe(true);
        expect(rs.find(r => r.syntax.exportKind === 'default')!.target.status).toBe('established');
        expect(rs.filter(r => r.syntax.moduleSpecifier).every(r => r.target.status === 'deferred' && r.target.entityId === null && r.target.symbolId === null)).toBe(true);
        expect(rs.some(r => r.syntax.exportKind === 'star')).toBe(true);
    });
    it('uses exact reference occurrences for reads, writes and read-write, never declaration tokens', () => {
        const e = evidence('mutation'), doc = analyze('mutation'), updates = e.resolution.references.filter(r => r.usage === 'read_write');
        for (const ref of updates) expect(doc.relationships.filter(r => r.evidence.referenceIds.includes(ref.id)).map(r => r.kind)).toEqual(['reads', 'writes']);
        const binding = e.resolution.symbols.find(s => s.name === 'read')!.bindingNodeId;
        expect(doc.relationships.some(r => ['reads', 'writes'].includes(r.kind) && r.astNodeId === binding)).toBe(false);
        expect(kind('calls', 'reads').some(r => r.target.status === 'unresolved')).toBe(true);
        expect(kind('calls', 'reads').filter(r => r.evidence.bindingSymbolId).every(r => r.target.meaning === 'lexical_binding')).toBe(true);
    });
    it('copies acyclic declaration ownership exactly, including constructors, parameters and repeated names', () => {
        const e = evidence('containment'), rs = kind('containment', 'contains');
        expect(rs).toHaveLength(e.metadata.entities.length - 1);
        for (const entity of e.metadata.entities.filter(m => m.parentEntityId)) expect(rs.find(r => r.target.entityId === entity.entityId)!.source.entityId).toBe(entity.parentEntityId);
        expect(e.metadata.summary.constructor).toBe(1); expect(metadataAnalysis().entityCounts.constructor).toBe(1);
        const xs = e.metadata.entities.filter(m => m.kind === 'parameter' && m.name === 'x'); expect(xs).toHaveLength(2); expect(xs[0]!.entityId).not.toBe(xs[1]!.entityId);
    });
    it('preserves incomplete/dynamic upstream diagnostics and keeps independent valid subtrees', () => {
        const doc = analyze('partial'); expect(doc.status).toBe('partial'); expect(doc.upstreamDiagnostics.ast.length).toBeGreaterThan(0); expect(doc.upstreamDiagnostics.metadata.length).toBeGreaterThan(0);
        expect(doc.relationships.some(r => r.kind === 'calls' && r.target.status === 'invalid')).toBe(true);
        expect(doc.relationships.some(r => r.kind === 'calls' && expression(r) === 'independent' && r.target.status === 'established')).toBe(true);
        expect(kind('dynamic', 'calls').every(r => r.target.status !== 'established')).toBe(true);
    });
    it('bounds nodes, entities, references and emitted relationships; rejects other grammars', () => {
        const e = evidence('calls'), analyzer = new JavascriptRelationshipAnalyzer();
        for (const key of ['maxNodes', 'maxEntities', 'maxReferences', 'maxRelationships'] as const) expect(() => analyzer.analyze(e, { ...DEFAULT_LIMITS, [key]: 1 })).toThrow('RELATIONSHIP_RESOURCE_LIMIT');
        expect(analyzer.supports({ ...e.ast, language: 'TypeScript' })).toBe(false); expect(analyzer.supports({ ...e.ast, grammarVersion: 'other' })).toBe(false);
    });
});
