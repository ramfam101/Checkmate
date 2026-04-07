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
		notificationsService: {
			handleNotifications: jest.fn().mockResolvedValue(undefined),
			sendEscalationNotification: jest.fn().mockResolvedValue(true),
		},
		checkService: { buildCheck: jest.fn().mockResolvedValue({}) },
		settingsService: {
			getSettings: jest.fn().mockReturnValue({ clientHost: "http://localhost" }),
			getDBSettings: jest.fn().mockResolvedValue({ checkTTL: 30 }),
		},
		buffer: { addToBuffer: jest.fn() },
		incidentService: { handleIncident: jest.fn().mockResolvedValue(undefined) },
		maintenanceWindowsRepository,
		monitorsRepository: { updateById: jest.fn(), findById: jest.fn(), findAll: jest.fn() },
		teamsRepository: { findAllTeamIds: jest.fn() },
		monitorStatsRepository: { deleteByMonitorIdsNotIn: jest.fn() },
		checksRepository: { deleteByMonitorIdsNotIn: jest.fn() },
		incidentsRepository: { findActiveByMonitorId: jest.fn().mockResolvedValue(null), updateById: jest.fn() },
		geoChecksService: {},
		geoChecksRepository: {},
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
				notificationsService: {
					handleNotifications: jest.fn().mockResolvedValue(undefined),
					sendEscalationNotification: jest.fn().mockResolvedValue(false),
				},
			});
			jest.spyOn(helper, "isInMaintenanceWindow").mockResolvedValue(false);
			const job = helper.getMonitorJob();
			const monitor = { id: "m1", teamId: "team" } as Monitor;
			await job(monitor);
			expect(helper["networkService"].requestStatus).toHaveBeenCalledWith(monitor);
		});

		it("sends escalation when active incident is unacknowledged after delay", async () => {
			const networkResponse = { monitor: { id: "m2" }, status: true };
			const activeIncident = {
				id: "i1",
				monitorId: "m2",
				teamId: "team",
				startTime: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
				status: true,
				resolutionType: null,
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				escalationsSent: [],
			};

			const { helper } = createHelper({
				networkService: { requestStatus: jest.fn().mockResolvedValue(networkResponse) },
				statusService: {
					updateMonitorStatus: jest.fn().mockResolvedValue({ monitor: networkResponse.monitor, statusChanged: true, prevStatus: false, code: 500 }),
				},
				incidentsRepository: {
					findActiveByMonitorId: jest.fn().mockResolvedValue(activeIncident),
					updateById: jest.fn().mockResolvedValue({ ...activeIncident, escalationsSent: [{ channelId: "n2", sentAt: new Date().toISOString() }] }),
				},
				notificationsService: {
					handleNotifications: jest.fn().mockResolvedValue(true),
					sendEscalationNotification: jest.fn().mockResolvedValue(true),
				},
			});

			jest.spyOn(helper, "isInMaintenanceWindow").mockResolvedValue(false);

			const job = helper.getMonitorJob();
			const monitor = {
				id: "m2",
				teamId: "team",
				notifications: ["n1"],
				notificationEscalations: { notificationIds: ["n2"], delayMinutes: 5 },
			} as Monitor;

			await job(monitor);

			expect(helper["notificationsService"].sendEscalationNotification).toHaveBeenCalledWith("n2", monitor, networkResponse, expect.any(Object));
			expect(helper["incidentsRepository"].updateById).toHaveBeenCalled();
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
