import { describe, expect, it, vi } from "vitest";
import type Parser from "tree-sitter";

import { ParserRegistry } from "./ParserRegistry.js";
import { ParserManager } from "./ParserManager.js";

import type { LanguageParser } from "../contracts/LanguageParser.js";
import type { ParseRequest } from "../contracts/ParseRequest.js";

const validRequest: ParseRequest = {
    projectId: "PRJ-001",
    relativePath: "src/app.js",
    language: "JavaScript",
    sourceCode: "const x = 10;"
};

function createMockParser(id = "javascript-parser", hasErrors = false): LanguageParser {
    return {
        id,
        supportedLanguages: ["JavaScript"],
        supportedExtensions: [".js", ".jsx"],
        parse: vi.fn(() => ({
            tree: {
                rootNode: { type: "program" }
            } as unknown as Parser.Tree,
            hasErrors
        }))
    };
}

describe("ParserManager", () => {
    it("parses with a compatible parser", () => {
        const registry = new ParserRegistry();
        registry.register(createMockParser());

        const manager = new ParserManager(registry);
        const outcome = manager.parse(validRequest);

        expect(outcome.status).toBe("success");

        if (outcome.status !== "failed") {
            expect(outcome.parserId).toBe("javascript-parser");
        }
    });

    it("reports unsupported languages", () => {
        const manager = new ParserManager(new ParserRegistry());

        const outcome = manager.parse(validRequest);

        expect(outcome.status).toBe("failed");

        if (outcome.status === "failed") {
            expect(outcome.code).toBe("UNSUPPORTED_LANGUAGE");
        }
    });

    it("preserves syntax-error results", () => {
        const registry = new ParserRegistry();
        registry.register(createMockParser("javascript", true));

        const manager = new ParserManager(registry);
        const outcome = manager.parse(validRequest);

        expect(outcome.status).toBe("syntax_errors");
    });

    it("rejects oversized source files", () => {
        const registry = new ParserRegistry();
        registry.register(createMockParser());

        const manager = new ParserManager(registry, { maxSourceBytes: 10 });

        const outcome = manager.parse(validRequest);

        expect(outcome.status).toBe("failed");

        if (outcome.status === "failed") {
            expect(outcome.code).toBe("FILE_TOO_LARGE");
        }
    });

    it("rejects ambiguous parser selection", () => {
        const registry = new ParserRegistry();

        registry.register(createMockParser("parser-a"));
        registry.register(createMockParser("parser-b"));

        const manager = new ParserManager(registry);
        const outcome = manager.parse(validRequest);

        expect(outcome.status).toBe("failed");

        if (outcome.status === "failed") {
            expect(outcome.code).toBe("AMBIGUOUS_PARSER");
        }
    });

    it("allows an explicit parser preference", () => {
        const registry = new ParserRegistry();

        registry.register(createMockParser("parser-a"));
        registry.register(createMockParser("parser-b"));

        const manager = new ParserManager(registry);

        const outcome = manager.parse({
            ...validRequest,
            preferredParserId: "parser-b"
        });

        expect(outcome.status).toBe("success");

        if (outcome.status !== "failed") {
            expect(outcome.parserId).toBe("parser-b");
        }
    });

    it("converts parser exceptions into failures", () => {
        const registry = new ParserRegistry();

        registry.register({
            ...createMockParser(),
            parse: () => {
                throw new Error("Parser execution failed");
            }
        });

        const manager = new ParserManager(registry);
        const outcome = manager.parse(validRequest);

        expect(outcome.status).toBe("failed");

        if (outcome.status === "failed") {
            expect(outcome.code).toBe("PARSER_FAILED");
        }
    });
});
