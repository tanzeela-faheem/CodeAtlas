import type { ParseResult } from "./ParseResult.js";

export type ParseFailureCode =
    | "INVALID_REQUEST"
    | "FILE_TOO_LARGE"
    | "UNSUPPORTED_LANGUAGE"
    | "PARSER_NOT_FOUND"
    | "AMBIGUOUS_PARSER"
    | "PARSER_FAILED";

export type ParseOutcome =
    | {
          readonly status: "success" | "syntax_errors";
          readonly projectId: string;
          readonly relativePath: string;
          readonly parserId: string;
          readonly result: ParseResult;
      }
    | {
          readonly status: "failed";
          readonly projectId: string;
          readonly relativePath: string;
          readonly code: ParseFailureCode;
          readonly message: string;
      };
