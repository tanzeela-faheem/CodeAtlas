import { ParserRegistry } from "../parsing/core/ParserRegistry.js";
import { ParserManager } from "../parsing/core/ParserManager.js";
import { JavascriptParser } from "../parsing/languages/JavascriptParser.js";
export function composeParsers() {
    const registry = new ParserRegistry();
    registry.register(new JavascriptParser());
    return { registry, manager: new ParserManager(registry) };
}
