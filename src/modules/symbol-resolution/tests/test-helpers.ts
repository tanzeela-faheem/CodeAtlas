import { readFileSync } from "node:fs";
import { deserializeAst, verifyAstSource } from "../../ast-management/serializer.js";
import { validateMetadataDocument, validateMetadataReference, validateMetadataAnalysis } from "../integration/contracts.js";
export const fixtureJson = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
export function evidence(name: string) {
    const ast = deserializeAst(readFileSync(new URL(`./fixtures/${name}.ast.json`, import.meta.url), "utf8"));
    verifyAstSource(ast, readFileSync(new URL(`./fixtures/${name}.jsx`, import.meta.url), "utf8"));
    const metadata = fixtureJson(`${name}.metadata`), reference = fixtureJson(`${name}.reference`);
    validateMetadataDocument(metadata); validateMetadataReference(reference);
    return { ast, metadata, reference };
}
export function projectMetadata() {
    const value = fixtureJson("metadata-analysis"); validateMetadataAnalysis(value); return value;
}
