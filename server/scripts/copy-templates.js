import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const sourceDir = resolve(__dirname, "../src/templates");
const targetDir = resolve(__dirname, "../dist/templates");

if (!existsSync(sourceDir)) {
	console.error(`Templates source directory not found: ${sourceDir}`);
	process.exit(1);
}

mkdirSync(targetDir, { recursive: true });
cpSync(sourceDir, targetDir, { recursive: true, force: true });
