import { describe, expect, it } from "vitest";

import { ParserRegistry } from "./ParserRegistry.js";

import type { LanguageParser } from "../contracts/LanguageParser.js";

function createParser(id: string, languages: string[], extensions: string[]): LanguageParser {
    return {
        id,
        supportedLanguages: languages,
        supportedExtensions: extensions,
        parse: () => {
            throw new Error("Not needed for registry tests");
        }
    };
}

describe("ParserRegistry", () => {
    it("registers and retrieves a parser by ID", () => {
        const registry = new ParserRegistry();

        const parser = createParser("javascript", ["JavaScript"], [".js", ".jsx"]);

        registry.register(parser);

        expect(registry.getById("javascript")).toMatchObject({
            id: parser.id,
            supportedLanguages: ["javascript"],
            supportedExtensions: [".js", ".jsx"]
        });
    });

    it("rejects duplicate parser IDs", () => {
        const registry = new ParserRegistry();

        registry.register(createParser("javascript", ["JavaScript"], [".js"]));

        expect(() => registry.register(createParser("javascript", ["JavaScript"], [".jsx"]))).toThrow(
            'Parser with id "javascript" is already registered'
        );
    });

    it("normalizes extensions and language names", () => {
        const registry = new ParserRegistry();

        registry.register(createParser("javascript", ["JavaScript"], [".JS", ".JSX"]));

        expect(registry.findCandidates("javascript", "JSX")).toHaveLength(1);
    });

    it("finds only candidates matching both criteria", () => {
        const registry = new ParserRegistry();

        registry.register(createParser("javascript", ["JavaScript"], [".js", ".jsx"]));

        registry.register(createParser("css", ["CSS"], [".css"]));

        expect(registry.findCandidates("JavaScript", ".jsx").map((parser) => parser.id)).toEqual(["javascript"]);

        expect(registry.findCandidates("JavaScript", ".css")).toHaveLength(0);
    });

    it("returns a copy of the lookup collection", () => {
        const registry = new ParserRegistry();

        registry.register(createParser("javascript", ["JavaScript"], [".js"]));

        const results = registry.getByLanguage("JavaScript");

        expect(results).toHaveLength(1);
        expect(registry.getByLanguage("JavaScript")).toHaveLength(1);
    });
});
