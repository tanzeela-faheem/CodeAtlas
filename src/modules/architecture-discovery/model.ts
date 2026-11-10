import type { RelationshipReference, RelationshipRecord, RelationshipInputs } from "../relationship-analysis/model.js";
import type { MetadataDocument } from "../symbol-resolution/model.js";
import type { ProjectProfile } from "../project-detection/types/project-detection.types.js";
export const VERSION = "architecture-evidence-v1" as const;
export const ROLES = ["presentation", "application", "domain", "infrastructure", "persistence", "integration"] as const;
export type Role = typeof ROLES[number];
export type Classification = "established" | "candidate" | "contradicted" | "insufficient_evidence" | "unsupported" | "indeterminate";
export type Pattern = "layers" | "mvc" | "clean" | "hexagonal" | "microservices" | "event_driven" | "domain_boundaries";
export interface Evidence {
    id: string; strength: "structural" | "syntactic" | "semantic" | "unresolved";
    relativePath: string | null; profileField: string | null; entityId: string | null;
    relationshipId: string | null; symbolId: string | null; astNodeId: string | null;
    range: RelationshipRecord["range"] | null; detail: string;
}
export interface Component {
    id: string; name: string; kind: "file" | "entity" | "layer" | "domain_candidate" | "application_candidate";
    classification: Classification; files: string[]; entityId: string | null; entityKind: string | null;
    parentId: string | null; roles: { role: Role; classification: "candidate"; evidenceIds: string[] }[];
    evidenceIds: string[]; limitations: string[];
}
export interface Finding {
    id: string; pattern: Pattern; detectorVersion: string; classification: Classification;
    componentIds: string[]; supportingEvidenceIds: string[]; contradictingEvidenceIds: string[];
    limitations: string[]; explanation: string;
}
export interface Dependency {
    id: string; from: string; to: string | null; kind: "calls" | "constructs" | "imports_syntax";
    classification: "established" | "candidate" | "unresolved" | "unsupported"; targetStatus: RelationshipRecord["target"]["status"];
    evidenceIds: string[];
}
export interface Cycle { id: string; componentIds: string[]; dependencyIds: string[]; selfLoop: boolean; scope: "established_local_declarations" }
export type Selector = { kind: "files" | "entities"; values: string[] } | { kind: "roles"; values: Role[] };
export interface RuleBase { id: string; type: string; severity: "warning" | "error"; scope: "observed_local" | "repository"; evidence: "established_only" }
export interface DependencyRule extends RuleBase { type: "forbid_dependency"; from: Selector; to: Selector; kinds: ("calls" | "constructs" | "imports_syntax")[] }
export interface CycleRule extends RuleBase { type: "forbid_cycles"; selector: Selector; kinds: ("calls" | "constructs" | "imports_syntax")[] }
export type Rule = DependencyRule | CycleRule | RuleBase;
export interface Configuration { schemaVersion: 1; rules: Rule[] }
export interface Evaluation {
    id: string; ruleId: string; status: "pass" | "violation" | "indeterminate" | "not_applicable";
    componentIds: string[]; dependencyIds: string[]; evidenceIds: string[]; limitations: string[]; explanation: string;
}
export interface Violation { id: string; ruleId: string; severity: "warning" | "error"; componentIds: string[]; dependencyIds: string[]; evidenceIds: string[]; explanation: string }
export interface Diagnostic { code: string; relativePath: string | null; message: string }
export interface Coverage { relativePath: string; status: "available" | "unavailable" | "unsupported" | "failed"; upstreamStatus: string; code: string | null; relationship: RelationshipReference | null; inputs: RelationshipInputs | null }
export interface Provenance { projectId: string; analysisId: string; sourceAnalysisHash: string; profileHash: string; metadataAnalysisHash: string; resolutionAnalysisHash: string; relationshipAnalysisHash: string; configurationHash: string }
export interface ArchitectureAnalysis {
    schemaVersion: 1; analyzerVersion: typeof VERSION; artifactId: string; provenance: Provenance;
    configuration: Configuration; status: "complete" | "partial"; coverage: Coverage[];
    components: Component[]; evidence: Evidence[]; findings: Finding[]; dependencies: Dependency[]; cycles: Cycle[];
    evaluations: Evaluation[]; violations: Violation[]; diagnostics: Diagnostic[];
    cycleCoverage: "observed_local_only";
}
export interface FileInput { metadata: MetadataDocument; relationships: RelationshipRecord[]; inputs: RelationshipInputs; reference: RelationshipReference; status: "complete" | "partial" }
export interface DiscoveryInput { profile: ProjectProfile; provenance: Provenance; coverage: Coverage[]; files: FileInput[]; diagnostics: Diagnostic[] }
export interface Limits { maxFiles: number; maxEntities: number; maxRelationships: number; maxComponents: number; maxDependencies: number; maxFindings: number; maxDiagnostics: number; maxBytes: number; maxInputBytes: number; maxDurationMs: number }
export const DEFAULT_LIMITS: Readonly<Limits> = Object.freeze({ maxFiles: 1000, maxEntities: 20000, maxRelationships: 50000, maxComponents: 25000, maxDependencies: 50000, maxFindings: 200, maxDiagnostics: 2000, maxBytes: 16 * 1024 * 1024, maxInputBytes: 128 * 1024 * 1024, maxDurationMs: 60000 });
export class ArchitectureError extends Error { constructor(readonly code: string, readonly httpStatus = 422) { super(code); } }
