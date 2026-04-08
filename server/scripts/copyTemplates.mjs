import { cp, mkdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const srcDir = path.join(root, "src", "templates");
const destDir = path.join(root, "dist", "templates");

await mkdir(destDir, { recursive: true });
await cp(srcDir, destDir, { recursive: true });

