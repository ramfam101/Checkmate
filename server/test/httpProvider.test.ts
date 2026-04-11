import { describe, expect, it, jest } from "@jest/globals";
import { HttpProvider } from "../src/service/infrastructure/network/HttpProvider.ts";
import type { Monitor } from "../src/types/monitor.ts";

const buildMonitor = (overrides: Partial<Monitor> = {}): Monitor => ({
	id: "monitor-1",
	userId: "user-1",
	teamId: "team-1",
	name: "Google",
	status: "up",
	statusWindow: [],
	statusWindowSize: 5,
	statusWindowThreshold: 60,
	type: "http",
	ignoreTlsErrors: false,
	useAdvancedMatching: false,
	url: "https://www.google.com",
	isActive: true,
	interval: 60000,
	notifications: [],
	cpuAlertThreshold: 100,
	cpuAlertCounter: 5,
	memoryAlertThreshold: 100,
	memoryAlertCounter: 5,
	diskAlertThreshold: 100,
	diskAlertCounter: 5,
	tempAlertThreshold: 100,
	tempAlertCounter: 5,
	selectedDisks: [],
	group: null,
	recentChecks: [],
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
	...overrides,
});

describe("HttpProvider", () => {
	it("falls back to the system DNS resolver when cached DNS lookups fail with queryA ECONNREFUSED", async () => {
		const dnsError = Object.assign(new Error("queryA ECONNREFUSED www.google.com"), {
			code: "ECONNREFUSED",
		});
		const successResponse = {
			statusCode: 200,
			ok: true,
			statusMessage: "OK",
			headers: { "content-type": "text/plain" },
			body: "ok",
			timings: { phases: { total: 42 } },
		};
		const cachedClient = jest.fn(async () => {
			throw dnsError;
		});
		const fallbackClient = Object.assign(jest.fn().mockResolvedValue(successResponse), {
			extend: jest.fn().mockReturnValue(cachedClient),
		});
		const gotMock = {
			extend: jest.fn().mockReturnValue(fallbackClient),
		};
		const advancedMatcher = {
			validate: jest.fn().mockReturnValue({ ok: true, message: "OK", extracted: undefined }),
		};
		const provider = new HttpProvider(gotMock as never, advancedMatcher as never);

		const result = await provider.handle(buildMonitor());

		expect(cachedClient).toHaveBeenCalledTimes(1);
		expect(fallbackClient).toHaveBeenCalledTimes(1);
		expect(result.status).toBe(true);
		expect(result.code).toBe(200);
	});
});
