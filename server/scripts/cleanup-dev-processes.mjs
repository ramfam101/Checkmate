import { execSync } from "node:child_process";

const cwd = process.cwd().replace(/"/g, '\\"');

const patterns = [
	`${cwd}/node_modules/.bin/nodemon --exec tsx src/index.js`,
	`${cwd}/node_modules/.bin/nodemon --exec tsx src/index.ts`,
	`${cwd}/node_modules/.bin/tsx src/index.js`,
	`${cwd}/node_modules/.bin/tsx src/index.ts`,
	`${cwd}/node_modules/.bin/tsx watch --clear-screen=false src/index.ts`,
	`${cwd}/node_modules/tsx/dist/loader.mjs src/index.js`,
	`${cwd}/node_modules/tsx/dist/loader.mjs src/index.ts`,
];

for (const pattern of patterns) {
	try {
		execSync(`pkill -9 -f "${pattern}"`, { stdio: "ignore" });
	} catch {
		// It's fine when no matching process is running.
	}
}
