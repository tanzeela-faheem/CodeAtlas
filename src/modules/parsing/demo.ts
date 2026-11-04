import { ParserRegistry } from "./core/ParserRegistry.js";
import { ParserManager } from "./core/ParserManager.js";
import { JavascriptParser } from "./languages/JavascriptParser.js";

const registry = new ParserRegistry();

registry.register(new JavascriptParser());

const manager = new ParserManager(registry);

const outcome = manager.parse({
    projectId: "PRJ-037633",
    relativePath: "frontend/src/App.jsx",
    language: "JavaScript",
    sourceCode: `
    export default function App(){
        return <h1> Hello CodeAtlas! </h1>;
    }`
});

if (outcome.status === "failed") {
    console.error(outcome.code, outcome.message);
} else {
    console.log("Status: ", outcome.status);
    console.log("Parser: ", outcome.parserId);
    console.log(outcome.result.tree.rootNode.toString());
}
