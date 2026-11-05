import { relativeSource, StoredJsonError, MAX_JSON_BYTES } from "./storage.js";

export class DataValidationError extends Error {
    readonly code = "INVALID_DATA";
    constructor(detail: string) {
        super(`Invalid or incompatible data: ${detail}`);
    }
}
export class StorageError extends Error {
    constructor(
        readonly code: "STORAGE_CORRUPT" | "ARTIFACT_CONFLICT",
        message = "Stored data is corrupt or incompatible"
    ) {
        super(message);
    }
}
export function check(condition: unknown, detail: string): asserts condition {
    if (!condition) throw new DataValidationError(detail);
}
export function object(
    value: unknown,
    label: string,
    required: readonly string[],
    optional: readonly string[] = []
): Record<string, unknown> {
    check(
        value !== null &&
            typeof value === "object" &&
            !Array.isArray(value) &&
            [Object.prototype, null].includes(Object.getPrototypeOf(value)),
        `${label} must be a plain object`
    );
    const record = value as Record<string, unknown>;
    check(
        required.every((key) => Object.hasOwn(record, key)),
        `${label} missing required fields`
    );
    const allowed = new Set([...required, ...optional]);
    check(
        Object.keys(record).every((key) => allowed.has(key)),
        `${label} has unsupported fields`
    );
    return record;
}
export function string(value: unknown, label: string, allowEmpty = false, max = 16384): asserts value is string {
    check(
        typeof value === "string" && (allowEmpty || value.length > 0) && value.length <= max,
        `${label} must be a bounded string`
    );
}
export function integer(value: unknown, label: string): asserts value is number {
    check(
        typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
        `${label} must be a nonnegative safe integer`
    );
}
export function finite(value: unknown, label: string, max = Number.MAX_SAFE_INTEGER): asserts value is number {
    check(
        typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max,
        `${label} must be a bounded finite number`
    );
}
export function boolean(value: unknown, label: string): asserts value is boolean {
    check(typeof value === "boolean", `${label} must be boolean`);
}
export function member(value: unknown, allowed: readonly string[], label: string): asserts value is string {
    check(typeof value === "string" && allowed.includes(value), `${label} is unsupported`);
}
export function array(value: unknown, label: string, max = 10000): asserts value is unknown[] {
    check(Array.isArray(value) && value.length <= max, `${label} must be a bounded array`);
}
export function timestamp(value: unknown, label: string): asserts value is string {
    string(value, label);
    check(
        /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) &&
            Number.isFinite(Date.parse(value)) &&
            new Date(value).toISOString() === value,
        `${label} must be an ISO UTC timestamp`
    );
}
export function projectId(value: unknown): asserts value is string {
    string(value, "projectId");
    check(/^PRJ-[A-Fa-f0-9]{6}$/.test(value), "projectId");
}
export function analysisId(value: unknown): asserts value is string {
    string(value, "analysisId");
    check(/^AN-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value), "analysisId");
}
export function hash(value: unknown): asserts value is string {
    string(value, "SHA-256");
    check(/^[a-f0-9]{64}$/.test(value), "SHA-256");
}
export function sourcePath(value: unknown, allowRoot = false): asserts value is string {
    string(value, "relativePath");
    if (allowRoot && value === ".") return;
    try {
        relativeSource(value);
    } catch {
        throw new DataValidationError("relativePath");
    }
}
export function optional(record: Record<string, unknown>, key: string, validate: (value: unknown) => void): void {
    if (Object.hasOwn(record, key)) validate(record[key]);
}
export function nullableString(value: unknown, label: string): void {
    if (value !== null) string(value, label);
}
export function storageFailure(error: unknown): never {
    if (error instanceof DataValidationError || error instanceof SyntaxError || error instanceof StoredJsonError)
        throw new StorageError("STORAGE_CORRUPT");
    throw error;
}

/** Capture a validated JSON snapshot before asynchronous I/O can yield to a mutating caller. */
export function validatedSnapshot<T>(value: unknown, validate: (value: unknown) => asserts value is T): T {
    validate(value);
    const text = JSON.stringify(value);
    check(Buffer.byteLength(text) <= MAX_JSON_BYTES, "stored data limit");
    const copy: unknown = JSON.parse(text);
    validate(copy);
    return copy;
}
