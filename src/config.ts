import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
// Explicit environment variables take precedence over a local .env file.
if (existsSync(".env")) loadEnvFile(".env");
export const MAX_SOURCE_BYTES = 2_000_000;
