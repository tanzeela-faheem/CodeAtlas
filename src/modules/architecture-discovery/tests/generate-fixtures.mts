// Read source as syntax only. Writes only this module's controlled fixtures.
import { writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { AstBuilder } from "../../ast-management/builder.js";
import { composeParsers } from "../../analysis/parser-composition.js";
const sources: Record<string,string> = {
 billing_service: `export function BillingService() {}`,
 billing_model: `export class BillingModel {}`,
 events: `import EventEmitter from 'node:events'; const bus = new EventEmitter(); bus.emit('work'); bus.on('work', () => {}); export function UserController() {} function recursive() { recursive(); } recursive();`,
 misleading_emit: `const custom = {}; custom.emit('work'); custom.on('work', () => {});`,
 library_only: `import EventEmitter from 'node:events'; export const value = 1;`,
};
const paths: Record<string,string> = {billing_service:'src/modules/billing/services/BillingService.js',billing_model:'src/modules/billing/domain/BillingModel.js'};
const dir = new URL('./fixtures/', import.meta.url); mkdirSync(dir, { recursive: true });
for (const [name, source] of Object.entries(sources)) {
    const parsed = composeParsers().manager.parse({ projectId: "PRJ-123ABC", relativePath: paths[name] ?? `${name}.jsx`, language: "JavaScript", sourceCode: source });
    if (parsed.status === "failed") throw new Error(parsed.code);
    const ast = new AstBuilder().build(parsed, { analysisId: "AN-00000000-0000-0000-0000-000000000001", language: "JavaScript", contentHash: createHash("sha256").update(source).digest("hex") });
    writeFileSync(new URL(`${name}.ast.json`, dir), JSON.stringify({ ...ast, createdAt: "2026-11-09T00:00:00.000Z" }));
    writeFileSync(new URL(`${name}.jsx`, dir), source);
}
