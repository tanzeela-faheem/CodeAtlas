import { createHash } from "node:crypto";
import { NORMALIZATION_VERSION, type AstDocument } from "./model.js";
import {
    object,
    check,
    hash,
    sourcePath,
    projectId,
    analysisId,
    string,
    nullableString
} from "../../shared/validation.js";
export interface AstReference {
    artifactId: string;
    relativePath: string;
    contentHash: string;
    schemaVersion: 1;
    // Additive ownership/provenance; historical references may omit these fields.
    projectId?: string;
    analysisId?: string;
    parserId?: string;
    parserVersion?: string | null;
    grammarVersion?: string | null;
    normalizationVersion?: string;
}
type Identity = Pick<
    AstDocument,
    | "schemaVersion"
    | "projectId"
    | "analysisId"
    | "relativePath"
    | "contentHash"
    | "parserId"
    | "parserVersion"
    | "grammarVersion"
    | "normalizationVersion"
>;
export const legacyArtifactId = (doc: Pick<Identity, "schemaVersion" | "relativePath" | "contentHash">): string =>
    createHash("sha256").update(`${doc.schemaVersion}:${doc.relativePath}:${doc.contentHash}`).digest("hex");
export function artifactId(doc: Identity): string {
    return createHash("sha256")
        .update(
            JSON.stringify([
                doc.schemaVersion,
                doc.normalizationVersion ?? NORMALIZATION_VERSION,
                doc.projectId,
                doc.analysisId,
                doc.relativePath,
                doc.contentHash,
                doc.parserId,
                doc.parserVersion,
                doc.grammarVersion
            ])
        )
        .digest("hex");
}
export function reference(doc: AstDocument, id = artifactId(doc)): AstReference {
    return {
        artifactId: id,
        relativePath: doc.relativePath,
        contentHash: doc.contentHash,
        schemaVersion: 1,
        projectId: doc.projectId,
        analysisId: doc.analysisId,
        parserId: doc.parserId,
        parserVersion: doc.parserVersion,
        grammarVersion: doc.grammarVersion,
        normalizationVersion: doc.normalizationVersion ?? NORMALIZATION_VERSION
    };
}
export function validateAstReference(
    value: unknown,
    project: string,
    analysis: string,
    relative: string
): asserts value is AstReference {
    const a = object(
        value,
        "artifact reference",
        ["artifactId", "relativePath", "contentHash", "schemaVersion"],
        ["projectId", "analysisId", "parserId", "parserVersion", "grammarVersion", "normalizationVersion"]
    );
    hash(a.artifactId);
    hash(a.contentHash);
    sourcePath(a.relativePath);
    check(a.relativePath === relative && a.schemaVersion === 1, "artifact file identity");
    const keys = ["projectId", "analysisId", "parserId", "parserVersion", "grammarVersion", "normalizationVersion"];
    const full = keys.some((key) => Object.hasOwn(a, key));
    if (full) {
        check(
            keys.every((key) => Object.hasOwn(a, key)),
            "incomplete artifact provenance"
        );
        projectId(a.projectId);
        analysisId(a.analysisId);
        check(a.projectId === project && a.analysisId === analysis, "foreign artifact identity");
        string(a.parserId, "parserId");
        nullableString(a.parserVersion, "parserVersion");
        nullableString(a.grammarVersion, "grammarVersion");
        check(a.normalizationVersion === NORMALIZATION_VERSION, "artifact normalization policy");
    }
    const descriptor = a as unknown as Identity;
    check(
        a.artifactId === legacyArtifactId(descriptor) || (full && a.artifactId === artifactId(descriptor)),
        "artifact key/provenance mismatch"
    );
}
