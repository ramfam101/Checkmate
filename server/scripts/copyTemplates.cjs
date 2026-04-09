const fs = require("fs");
const path = require("path");

const src = path.resolve(__dirname, "../src/templates");
const dest = path.resolve(__dirname, "../dist/templates");

try {
	fs.rmSync(dest, { recursive: true, force: true });
} catch (e) {}
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.cpSync(src, dest, { recursive: true });
console.log("Copied templates to dist/templates");
