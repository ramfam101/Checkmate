import { describe, expect, it, jest } from "@jest/globals";
import SuperSimpleQueueHelper from "../src/service/infrastructure/SuperSimpleQueue/SuperSimpleQueueHelper.ts";
import type { Monitor } from "../src/types/monitor.ts";

const createLogger = () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() });

const createHelper = (overrides?: Partial<ConstructorParameters<typeof SuperSimpleQueueHelper>[0]>) => {
	const maintenanceWindowsRepository = {
		findByMonitorId: jest.fn().mockResolvedValue([]),
	};
	const statusServiceMock = {
		updateMonitorStatus: jest.fn().mockResolvedValue({ monitor: { id: "m1" }, statusChanged: true, prevStatus: false }),
	};
	const helper = new SuperSimpleQueueHelper({
		logger: createLogger(),
		networkService: { requestStatus: jest.fn() },
		statusService: statusServiceMock,
		notificationsService: { handleNotifications: jest.fn().mockResolvedValue(undefined) },
		sendEscalationNotification: jest.fn().mockResolvedValue(true),
		checkService: { buildCheck: jest.fn().mockResolvedValue({}) },
		buffer: { addToBuffer: jest.fn() },
		incidentService: { handleIncident: jest.fn().mockResolvedValue(undefined) },
		maintenanceWindowsRepository,
		...overrides,
	});
	return { helper, maintenanceWindowsRepository };
};

describe("SuperSimpleQueueHelper", () => {
	describe("getMonitorJob", () => {
		it("skips execution when monitor is in maintenance window", async () => {
			const { helper } = createHelper();
			const spy = jest.spyOn(helper, "isInMaintenanceWindow").mockResolvedValue(true);
			const job = helper.getMonitorJob();
			await job({ id: "m1", teamId: "team", interval: 60000 } as Monitor);
			expect(helper["networkService"].requestStatus).not.toHaveBeenCalled();
			expect(helper["logger"].debug).toHaveBeenCalledWith(
				expect.objectContaining({ message: expect.stringContaining("Monitor m1 is in maintenance window") })
			);
			spy.mockRestore();
		});

		it("processes monitor status and notifications when active", async () => {
			const networkResponse = { monitor: { id: "m1" }, status: true };
			const updatedMonitor = { id: "m1", status: true };
			const { helper } = createHelper({
				networkService: { requestStatus: jest.fn().mockResolvedValue(networkResponse) },
				statusService: {
					updateMonitorStatus: jest.fn().mockResolvedValue({ monitor: updatedMonitor, statusChanged: true, prevStatus: false, code: 200 }),
				},
				notificationsService: { handleNotifications: jest.fn().mockResolvedValue(undefined) },
			});
			jest.spyOn(helper, "isInMaintenanceWindow").mockResolvedValue(false);
			const job = helper.getMonitorJob();
			const monitor = { id: "m1", teamId: "team" } as Monitor;
			await job(monitor);
			expect(helper["networkService"].requestStatus).toHaveBeenCalledWith(monitor);
		});

		it("sends escalation only after the configured duration", async () => {
			const now = Date.now();
			const monitor = { id: "m1", teamId: "team", escalation: { afterMinutes: 5, notificationId: "n1" } } as Monitor;
			const { helper } = createHelper({
				networkService: { requestStatus: jest.fn().mockResolvedValue({ monitor, status: false, code: 500 }) },
				statusService: {
					updateMonitorStatus: jest.fn().mockResolvedValue({ monitor, statusChanged: false, prevStatus: false, code: 500 }),
				},
				incidentsRepository: {
					findActiveByMonitorId: jest.fn().mockResolvedValue({
						id: "i1",
						teamId: "team",
						monitorId: "m1",
						startTime: new Date(now - 6 * 60000).toISOString(),
						status: true,
						escalationNotifiedAt: null,
					} as never),
					updateById: jest.fn().mockResolvedValue(undefined),
				},
			});
			jest.spyOn(helper, "isInMaintenanceWindow").mockResolvedValue(false);
			const job = helper.getMonitorJob();
			await job(monitor);
			expect(helper["notificationsService"].sendEscalationNotification).toHaveBeenCalledWith(monitor, expect.any(Object), "n1", 5);
			expect(helper["incidentsRepository"].updateById).toHaveBeenCalledWith(
				"i1",
				"team",
				expect.objectContaining({ escalationNotifiedAt: expect.any(String) })
			);
		});

		it("throws when monitor id is missing", async () => {
			const { helper } = createHelper();
			const job = helper.getMonitorJob();
			await expect(job({} as Monitor)).rejects.toThrow("No monitor id");
			expect(helper["logger"].warn).toHaveBeenCalled();
		});
	});

	describe("isInMaintenanceWindow", () => {
		it("returns true when an active window spans now", async () => {
			const now = new Date();
			const { helper, maintenanceWindowsRepository } = createHelper();
			maintenanceWindowsRepository.findByMonitorId.mockResolvedValue([
				{
					active: true,
					start: new Date(now.getTime() - 1000).toISOString(),
					end: new Date(now.getTime() + 1000).toISOString(),
					repeat: 0,
				},
			]);
			await expect(helper.isInMaintenanceWindow("m1", "team")).resolves.toBe(true);
		});

		it("returns true when repeat interval advances window into current time", async () => {
			const now = Date.now();
			const { helper, maintenanceWindowsRepository } = createHelper();
			maintenanceWindowsRepository.findByMonitorId.mockResolvedValue([
				{
					active: true,
					start: new Date(now - 7200000).toISOString(),
					end: new Date(now - 6600000).toISOString(),
					repeat: 3600000,
				},
			]);
			await expect(helper.isInMaintenanceWindow("m1", "team")).resolves.toBe(true);
		});

		it("returns false when no active windows exist", async () => {
			const { helper } = createHelper();
			await expect(helper.isInMaintenanceWindow("m1", "team")).resolves.toBe(false);
		});
	});
});
