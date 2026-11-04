export interface ParseRequest {
    readonly projectId: string;
    readonly relativePath: string;
    readonly language: string;
    readonly sourceCode: string;
    readonly preferredParserId?: string;
}
