/** Versions of the selected parser implementation and its relevant grammar.
 * null explicitly means the plugin cannot determine a version. */
export interface ParserProvenance {
    readonly parserVersion: string | null;
    readonly grammarVersion: string | null;
}
