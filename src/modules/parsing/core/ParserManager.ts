import { MAX_SOURCE_BYTES } from "../../../config.js";
import path from "node:path";

import type { LanguageParser } from "../contracts/LanguageParser.js";
import type { ParseRequest } from "../contracts/ParseRequest.js";
import type { ParseFailureCode, ParseOutcome } from "../contracts/ParseOutcome.js";

import { ParserRegistry } from "./ParserRegistry.js";

export interface ParserManagerOptions {
    readonly maxSourceBytes?: number;
}

export class ParserManager {
    private readonly maxSourceBytes: number;

    constructor(
        private readonly registry: ParserRegistry,
        options: ParserManagerOptions = {}
    ) {
        this.maxSourceBytes = options.maxSourceBytes ?? MAX_SOURCE_BYTES;

        if (!Number.isSafeInteger(this.maxSourceBytes) || this.maxSourceBytes <= 0) {
            throw new Error("maxSourceBytes must be a positive integer");
        }
    }

    parse(request: ParseRequest): ParseOutcome {
        const projectId = typeof request?.projectId === "string" ? request.projectId : "";
        const relativePath = typeof request?.relativePath === "string" ? request.relativePath : "";

        const fail = (code: ParseFailureCode, message: string): ParseOutcome => ({
            status: "failed",
            projectId,
            relativePath,
            code,
            message
        });

        // Validate request
        if (
            !projectId?.trim() ||
            !relativePath?.trim() ||
            typeof request?.language !== "string" ||
            !request.language.trim() ||
            typeof request.sourceCode !== "string"
        ) {
            return fail("INVALID_REQUEST", "Missing or invalid required parse request fields");
        }

        const normalizedPath = relativePath.replace(/\\/g, "/");

        if (
            normalizedPath.startsWith("/") ||
            /^[A-Za-z]:/.test(normalizedPath) ||
            normalizedPath.includes("\0") ||
            normalizedPath.split("/").includes("..")
        ) {
            return fail("INVALID_REQUEST", "Source path must be a safe relative path");
        }

        const extension = path.posix.extname(normalizedPath);

        if (!extension) {
            return fail("INVALID_REQUEST", "Source file has no extension");
        }

        // Validate source-size limit
        const sourceBytes = Buffer.byteLength(request.sourceCode, "utf8");

        if (sourceBytes > this.maxSourceBytes) {
            return fail("FILE_TOO_LARGE", `Source exceeds the ${this.maxSourceBytes}-byte limit`);
        }

        // Discover Compatible parsers
        const candidates = this.registry.findCandidates(request.language, extension);

        if (candidates.length === 0) {
            const languageParsers = this.registry.getByLanguage(request.language);

            return fail(
                languageParsers.length === 0 ? "UNSUPPORTED_LANGUAGE" : "PARSER_NOT_FOUND",
                `No parser supports ${request.language} (${extension})`
            );
        }

        // Select a parser
        let selected: LanguageParser | undefined;

        if (request.preferredParserId !== undefined) {
            selected = candidates.find((parser) => parser.id === request.preferredParserId);

            if (!selected) {
                return fail("PARSER_NOT_FOUND", `Preferred parser is not compatible: ${request.preferredParserId}`);
            }
        } else if (candidates.length === 1) {
            selected = candidates[0];
        } else {
            return fail("AMBIGUOUS_PARSER", `Multiple compatible parsers: ${candidates.map((p) => p.id).join(", ")}`);
        }

        // Execute parsing
        try {
            const result = selected?.parse(request.sourceCode);

            if (!result?.tree?.rootNode) {
                return fail("PARSER_FAILED", "Parser returned an invalid syntax tree");
            }

            return {
                status: result.hasErrors ? "syntax_errors" : "success",
                projectId,
                relativePath: normalizedPath,
                parserId: selected!.id,
                provenance: selected!.provenance ?? { parserVersion: null, grammarVersion: null },
                result
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown parser error";
            return fail("PARSER_FAILED", `Parser '${selected!.id}' failed: ${message}`);
        }
    }
}
