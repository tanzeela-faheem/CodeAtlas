import type {
    RepositoryMetadata,
    RepositoryImportRequest,
    RepositoryValidationReport
} from "../types/repository.types.js";

export class RepositoryMetadataService {
    /**
     * Creates metadata for an imported repository.
     */
    createMetadata(
        projectId: string,
        projectName: string,
        request: RepositoryImportRequest,
        validationReport: RepositoryValidationReport,
        gitInfo?: {
            defaultBranch?: string;
            commitHash?: string;
        }
    ): RepositoryMetadata {
        const now = new Date().toISOString();

        const metadata: RepositoryMetadata = {
            projectId,

            projectName,

            repositorySource: request.sourceType,

            importDate: now,

            lastUpdated: now,

            gitUrl: request.sourceType === "git" ? request.source : undefined,

            defaultBranch: gitInfo?.defaultBranch,

            commitHash: gitInfo?.commitHash,

            repositorySize: validationReport.totalSize,

            numberOfFiles: validationReport.totalFiles,

            numberOfDirectories: validationReport.totalDirectories,

            importStatus: validationReport.status === "invalid" ? "failed" : "imported",

            validationStatus: validationReport.status
        };

        return metadata;
    }

    /**
     * Update existing metadata.
     *
     * Later this method can directly update
     * the database record.
     */
    updateMetadata(existingMetadata: RepositoryMetadata, updates: Partial<RepositoryMetadata>): RepositoryMetadata {
        return {
            ...existingMetadata,

            ...updates,

            lastUpdated: new Date().toISOString()
        };
    }

    /**
     * Retrieve metadata.
     *
     * Currently returns the supplied object.
     *
     * Later this can become a DB query.
     */
    getMetadata(metadata: RepositoryMetadata): RepositoryMetadata {
        return metadata;
    }

    /**
     * Delete metadata.
     *
     * Currently there is no database.
     * So this simply represents the operation.
     */
    deleteMetadata(projectId: string): void {}
}
