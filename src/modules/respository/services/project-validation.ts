import {
    check,
    object,
    string,
    integer,
    boolean,
    member,
    array,
    timestamp,
    projectId,
    sourcePath,
    optional
} from "../../../shared/validation.js";
import { validateProjectProfile } from "../../project-detection/types/profile-validation.js";
import type { ProjectState } from "./project-store.js";
const SOURCES = ["git", "zip", "local"];
const VALIDATION = ["valid", "invalid", "warning"];
export function validateProjectState(value: unknown, expectedId?: string): asserts value is ProjectState {
    const state = object(
        value,
        "project state",
        ["schemaVersion", "createdAt", "updatedAt", "result"],
        ["provenance", "projectId"]
    );
    check(state.schemaVersion === 1, "project schema");
    timestamp(state.createdAt, "createdAt");
    timestamp(state.updatedAt, "updatedAt");
    check(state.updatedAt >= state.createdAt, "project timestamps");
    const r = object(
        state.result,
        "import result",
        [
            "projectId",
            "projectName",
            "sourceType",
            "status",
            "workspacePath",
            "repositoryPath",
            "importedAt",
            "message"
        ],
        ["validation", "metadata", "projectProfile", "detectionError"]
    );
    projectId(r.projectId);
    check(expectedId === undefined || r.projectId === expectedId, "project identity");
    optional(state, "projectId", (id) => {
        projectId(id);
        check(id === r.projectId, "top-level project identity");
    });
    string(r.projectName, "projectName");
    member(r.sourceType, SOURCES, "sourceType");
    check(r.status === "imported", "persisted import status");
    string(r.workspacePath, "workspacePath");
    string(r.repositoryPath, "repositoryPath");
    string(r.message, "message");
    timestamp(r.importedAt, "importedAt");
    check(r.importedAt === state.createdAt && state.updatedAt >= r.importedAt, "import timestamps");
    optional(r, "detectionError", (x) => string(x, "detectionError"));
    check(!(r.detectionError && r.projectProfile), "detection result contradiction");
    if (Object.hasOwn(r, "validation")) {
        const v = object(r.validation, "validation", [
            "status",
            "repositoryPath",
            "totalFiles",
            "totalDirectories",
            "totalSize",
            "binaryFiles",
            "largeFiles",
            "inaccessibleFiles",
            "symbolicLinks",
            "issues",
            "validatedAt"
        ]);
        member(v.status, VALIDATION, "validation status");
        check(v.status !== "invalid", "imported repository validation");
        string(v.repositoryPath, "validation path");
        for (const key of ["totalFiles", "totalDirectories", "totalSize"]) integer(v[key], key);
        for (const key of ["binaryFiles", "largeFiles", "inaccessibleFiles", "symbolicLinks", "issues"]) {
            array(v[key], key);
            for (const item of v[key])
                key === "issues" ? string(item, key) : item === "" ? undefined : sourcePath(item);
        }
        timestamp(v.validatedAt, "validatedAt");
    }
    if (Object.hasOwn(r, "metadata")) {
        const m = object(
            r.metadata,
            "metadata",
            [
                "projectId",
                "projectName",
                "repositorySource",
                "importDate",
                "lastUpdated",
                "repositorySize",
                "numberOfFiles",
                "numberOfDirectories",
                "importStatus",
                "validationStatus"
            ],
            ["gitUrl", "defaultBranch", "commitHash"]
        );
        projectId(m.projectId);
        check(
            m.projectId === r.projectId &&
                m.projectName === r.projectName &&
                m.repositorySource === r.sourceType &&
                m.importStatus === r.status,
            "metadata identity"
        );
        string(m.projectName, "metadata name");
        member(m.repositorySource, SOURCES, "repositorySource");
        timestamp(m.importDate, "importDate");
        timestamp(m.lastUpdated, "lastUpdated");
        check(m.lastUpdated >= m.importDate, "metadata timestamps");
        for (const key of ["repositorySize", "numberOfFiles", "numberOfDirectories"]) integer(m[key], key);
        member(m.validationStatus, VALIDATION, "metadata validation");
        check(m.validationStatus !== "invalid", "metadata import status");
        // createMetadata historically emits explicit undefined optional fields in memory;
        // JSON omits those fields. Both forms are valid at this save boundary.
        for (const key of ["gitUrl", "defaultBranch", "commitHash"])
            if (m[key] !== undefined) string(m[key], key, key === "commitHash");
        if (r.validation) {
            const v = r.validation as Record<string, unknown>;
            check(
                m.validationStatus === v.status &&
                    m.repositorySize === v.totalSize &&
                    m.numberOfFiles === v.totalFiles &&
                    m.numberOfDirectories === v.totalDirectories,
                "validation metadata mismatch"
            );
        }
    }
    optional(r, "projectProfile", (profile) => validateProjectProfile(profile, r.projectId as string));
    if (Object.hasOwn(state, "provenance")) {
        const source = object(
            state.provenance,
            "provenance",
            ["sourceType", "source"],
            ["branch", "tag", "commit", "shallow"]
        );
        member(source.sourceType, SOURCES, "sourceType");
        check(source.sourceType === r.sourceType, "provenance source");
        string(source.source, "source");
        for (const key of ["branch", "tag", "commit"]) optional(source, key, (x) => string(x, key));
        optional(source, "shallow", (x) => boolean(x, "shallow"));
    }
}
