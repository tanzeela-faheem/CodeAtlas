import type { LanguageParser } from "../contracts/LanguageParser.ts";

interface RegistrySnapshot {
    readonly byParserId: ReadonlyMap<string, LanguageParser>;
    readonly byLanguage: ReadonlyMap<string, readonly LanguageParser[]>;
    readonly byExtension: ReadonlyMap<string, readonly LanguageParser[]>;
}

export class ParserRegistry {
    private snapshot: RegistrySnapshot = {
        byParserId: new Map(),
        byLanguage: new Map(),
        byExtension: new Map()
    };

    register(parser: LanguageParser): void {
        const id = parser.id.trim();

        if (!id || id !== parser.id || /\s/.test(id)) {
            throw new Error("Parser id must be nonempty and unpadded without whitespace");
        }

        if (this.snapshot.byParserId.has(id)) {
            throw new Error(`Parser with id "${id}" is already registered`);
        }

        const languages = [...new Set(parser.supportedLanguages.map((language) => language.trim().toLowerCase()))];

        const extensions = [
            ...new Set(parser.supportedExtensions.map((extension) => this.normalizeExtension(extension)))
        ];

        if (languages.length === 0 || languages.some((x) => !x)) {
            throw new Error(`Invalid languages for parser: ${id}`);
        }

        if (extensions.length === 0 || extensions.some((x) => !x)) {
            throw new Error(`Invalid extensions for parser: ${id}`);
        }

        const version = (value: unknown): string | null => {
            if (value === undefined || value === null) return null;
            if (typeof value !== "string" || !value.trim() || value.length > 1024)
                throw new Error("Invalid parser provenance");
            return value;
        };
        const parse = parser.parse;
        if (typeof parse !== "function") throw new Error("Parser implementation is required");
        // The registration descriptor is immutable, not the stateful parser instance.
        const registered: LanguageParser = Object.freeze({
            id,
            supportedLanguages: Object.freeze(languages),
            supportedExtensions: Object.freeze(extensions),
            provenance: Object.freeze({
                parserVersion: version(parser.provenance?.parserVersion),
                grammarVersion: version(parser.provenance?.grammarVersion)
            }),
            parse: (source: string) => parse.call(parser, source)
        });
        const previous = this.snapshot;
        const byParserId = new Map(previous.byParserId);
        const byLanguage = new Map(previous.byLanguage);
        const byExtension = new Map(previous.byExtension);

        byParserId.set(id, registered);

        for (const language of languages) {
            byLanguage.set(language, [...(byLanguage.get(language) ?? []), registered]);
        }

        for (const extension of extensions) {
            byExtension.set(extension, [...(byExtension.get(extension) ?? []), registered]);
        }

        this.snapshot = {
            byParserId,
            byLanguage,
            byExtension
        };
    }

    getById(id: string): LanguageParser | undefined {
        return this.snapshot.byParserId.get(id);
    }

    getByLanguage(language: string): readonly LanguageParser[] {
        const snapshot = this.snapshot;

        return [...(snapshot.byLanguage.get(language.trim().toLowerCase()) ?? [])];
    }

    getByExtension(extension: string): readonly LanguageParser[] {
        const snapshot = this.snapshot;

        return [...(snapshot.byExtension.get(this.normalizeExtension(extension)) ?? [])];
    }

    findCandidates(language: string, extension: string): readonly LanguageParser[] {
        const snapshot = this.snapshot;

        const normalizedLanguage = language.trim().toLowerCase();
        const normalizedExtension = this.normalizeExtension(extension);

        const languageCandidates = snapshot.byLanguage.get(normalizedLanguage) ?? [];

        const extensionCandidates = snapshot.byExtension.get(normalizedExtension) ?? [];

        const allowedIds = new Set(extensionCandidates.map((parser) => parser.id));

        return languageCandidates.filter((parser) => allowedIds.has(parser.id));
    }

    private normalizeExtension(extension: string): string {
        const value = extension.trim().toLowerCase();

        if (!value) return "";

        return value.startsWith(".") ? value : `.${value}`;
    }
}
