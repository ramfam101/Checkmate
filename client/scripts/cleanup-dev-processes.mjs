import { execSync } from "node:child_process";

const cwd = process.cwd().replace(/"/g, '\\"');

const patterns = [`${cwd}/node_modules/.bin/vite`];

for (const pattern of patterns) {
	try {
		execSync(`pkill -9 -f "${pattern}"`, { stdio: "ignore" });
	} catch {
		// It's fine when no matching process is running.
	}
}
