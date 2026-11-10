import { ParserRegistry } from "../parsing/core/ParserRegistry.js";
import { ParserManager } from "../parsing/core/ParserManager.js";
import { JavascriptParser } from "../parsing/languages/JavascriptParser.js";
import { PythonParser } from "../parsing/languages/PythonParser.js";
export function composeParsers() {
    const registry = new ParserRegistry();

    registry.register(new JavascriptParser());
    registry.register(new PythonParser());

    return { registry, manager: new ParserManager(registry) };
}