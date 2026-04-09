import { describe, expect, it, jest } from "@jest/globals";
import { StatusService } from "../src/service/infrastructure/statusService.ts";
import type { Check, Monitor, MonitorStatusResponse } from "../src/types/index.ts";

const createLogger = () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() });

const createMonitor = (overrides: Partial<Monitor> = {}): Monitor =>
	({
		id: "monitor-1",
		userId: "user-1",
		teamId: "team-1",
		name: "Example Monitor",
		description: "",
		status: "initializing",
		statusWindow: [],
		statusWindowSize: 3,
		statusWindowThreshold: 60,
		type: "http",
		ignoreTlsErrors: false,
		useAdvancedMatching: false,
		url: "https://example.com",
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
	}) as Monitor;

const createCheck = (status: boolean): Check =>
	({
		id: "check-1",
		metadata: { monitorId: "monitor-1", teamId: "team-1", type: "http" },
		status,
		responseTime: 123,
		statusCode: status ? 200 : 500,
		message: status ? "OK" : "Unavailable",
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	}) as Check;

const createResponse = (status: boolean): MonitorStatusResponse =>
	({
		monitorId: "monitor-1",
		teamId: "team-1",
		type: "http",
		status,
		code: status ? 200 : 500,
		message: status ? "OK" : "Unavailable",
		responseTime: 123,
	});

describe("StatusService", () => {
	it("creates a real down transition when initialization completes in a failed state", async () => {
		const monitor = createMonitor({ status: "initializing", statusWindow: [false, false] });
		const monitorsRepository = {
			findById: jest.fn().mockResolvedValue(monitor),
			updateById: jest.fn().mockImplementation(async (_id: string, _teamId: string, patch: Partial<Monitor>) => patch),
		};
		const service = new StatusService(
			createLogger() as never,
			{ addToBuffer: jest.fn() } as never,
			monitorsRepository as never,
			{ findByMonitorId: jest.fn().mockRejectedValue(new Error("missing")), updateByMonitorId: jest.fn(), create: jest.fn() } as never,
			{} as never
		);

		const result = await service.updateMonitorStatus(createResponse(false), createCheck(false));

		expect(result.prevStatus).toBe("initializing");
		expect(result.statusChanged).toBe(true);
		expect(result.monitor.status).toBe("down");
	});

	it("keeps an up monitor up when a single failure does not cross the threshold", async () => {
		const monitor = createMonitor({ status: "up", statusWindow: [true, true] });
		const monitorsRepository = {
			findById: jest.fn().mockResolvedValue(monitor),
			updateById: jest.fn().mockImplementation(async (_id: string, _teamId: string, patch: Partial<Monitor>) => patch),
		};
		const service = new StatusService(
			createLogger() as never,
			{ addToBuffer: jest.fn() } as never,
			monitorsRepository as never,
			{ findByMonitorId: jest.fn().mockRejectedValue(new Error("missing")), updateByMonitorId: jest.fn(), create: jest.fn() } as never,
			{} as never
		);

		const result = await service.updateMonitorStatus(createResponse(false), createCheck(false));

		expect(result.statusChanged).toBe(false);
		expect(result.monitor.status).toBe("up");
	});

	it("recovers a down monitor only after a passing check brings the window below threshold", async () => {
		const monitor = createMonitor({ status: "down", statusWindow: [false, true] });
		const monitorsRepository = {
			findById: jest.fn().mockResolvedValue(monitor),
			updateById: jest.fn().mockImplementation(async (_id: string, _teamId: string, patch: Partial<Monitor>) => patch),
		};
		const service = new StatusService(
			createLogger() as never,
			{ addToBuffer: jest.fn() } as never,
			monitorsRepository as never,
			{ findByMonitorId: jest.fn().mockRejectedValue(new Error("missing")), updateByMonitorId: jest.fn(), create: jest.fn() } as never,
			{} as never
		);

		const result = await service.updateMonitorStatus(createResponse(true), createCheck(true));

		expect(result.prevStatus).toBe("down");
		expect(result.statusChanged).toBe(true);
		expect(result.monitor.status).toBe("up");
	});
});
