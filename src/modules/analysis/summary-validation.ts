import { validateAstReference } from "../ast-management/identity.js";
import {
    object,
    check,
    string,
    integer,
    member,
    array,
    timestamp,
    projectId,
    analysisId,
    sourcePath,
    optional
} from "../../shared/validation.js";
import { emptyCounts, type AnalysisSummary } from "./model.js";
const STATUSES = Object.keys(emptyCounts());
const code = (value: unknown) => {
    string(value, "error code");
    check(/^[A-Z][A-Z0-9_]{0,127}$/.test(value), "error code");
};
export function validateAnalysisSummary(
    value: unknown,
    expectedProject?: string,
    expectedAnalysis?: string
): asserts value is AnalysisSummary {
    const s = object(
        value,
        "analysis summary",
        ["schemaVersion", "projectId", "analysisId", "status", "startedAt", "counts", "files"],
        ["completedAt", "failureCode"]
    );
    check(s.schemaVersion === 1, "summary schema");
    projectId(s.projectId);
    analysisId(s.analysisId);
    check(
        (expectedProject === undefined || s.projectId === expectedProject) &&
            (expectedAnalysis === undefined || s.analysisId === expectedAnalysis),
        "summary identity"
    );
    member(
        s.status,
        ["queued", "running", "completed", "completed_with_errors", "failed", "interrupted"],
        "analysis status"
    );
    timestamp(s.startedAt, "startedAt");
    const terminal = ["completed", "completed_with_errors", "failed", "interrupted"].includes(s.status);
    check(terminal === Object.hasOwn(s, "completedAt"), "completion timestamp/state");
    optional(s, "completedAt", (x) => {
        timestamp(x, "completedAt");
        check(x >= (s.startedAt as string), "analysis timestamps");
    });
    const failed = s.status === "failed" || s.status === "interrupted";
    check(failed === Object.hasOwn(s, "failureCode"), "failure/state");
    optional(s, "failureCode", code);
    const counts = object(s.counts, "counts", STATUSES);
    for (const k of STATUSES) integer(counts[k], `count.${k}`);
    array(s.files, "file outcomes", 1000);
    const paths = new Set<string>();
    const actual = emptyCounts();
    let timeBudget = false;
    for (const item of s.files) {
        const f = object(item, "file outcome", ["relativePath", "status"], ["code", "message", "artifact"]);
        sourcePath(f.relativePath);
        check(!paths.has(f.relativePath), "duplicate outcome");
        paths.add(f.relativePath);
        member(f.status, STATUSES, "file status");
        actual[f.status as keyof typeof actual]++;
        optional(f, "code", code);
        optional(f, "message", (x) => string(x, "error message"));
        const parsed = f.status === "parsed" || f.status === "syntax_errors";
        check(parsed === Object.hasOwn(f, "artifact"), "artifact/file status");
        check(
            parsed ? !Object.hasOwn(f, "code") && !Object.hasOwn(f, "message") : Object.hasOwn(f, "code"),
            "error code/file status"
        );
        if (f.code === "ANALYSIS_TIME_BUDGET") timeBudget = true;
        if (Object.hasOwn(f, "artifact")) {
            validateAstReference(f.artifact, s.projectId, s.analysisId, f.relativePath);
        }
    }
    for (const key of STATUSES) check(counts[key] === actual[key as keyof typeof actual], "counts/outcomes mismatch");
    if (s.status === "queued") check(s.files.length === 0, "queued outcomes");
    const hasErrors =
        actual.read_failed + actual.parser_failed + actual.ast_failed + actual.storage_failed + actual.syntax_errors >
            0 || timeBudget;
    if (s.status === "completed") check(!hasErrors, "completed with errors");
    if (s.status === "completed_with_errors") check(hasErrors, "completed_with_errors without errors");
}
