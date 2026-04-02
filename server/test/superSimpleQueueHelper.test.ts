import { describe, expect, it, jest } from "@jest/globals";
import { SuperSimpleQueueHelper } from "../src/service/infrastructure/SuperSimpleQueue/SuperSimpleQueueHelper.ts";
import type { Monitor } from "../src/types/monitor.ts";

const createLogger = () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() });

const createHelper = (overrides: Partial<Record<string, unknown>> = {}) => {
	const maintenanceWindowsRepository = {
		findByMonitorId: jest.fn().mockResolvedValue([]),
	};
	const statusServiceMock = {
		updateMonitorStatus: jest.fn().mockResolvedValue({ monitor: { id: "m1" }, statusChanged: true, prevStatus: false }),
	};
	const helper = new SuperSimpleQueueHelper(
		createLogger(),
		(overrides.networkService as any) ?? { requestStatus: jest.fn() },
		(overrides.statusService as any) ?? statusServiceMock,
		(overrides.notificationsService as any) ?? { handleNotifications: jest.fn().mockResolvedValue(undefined) },
		(overrides.checkService as any) ?? { buildCheck: jest.fn().mockResolvedValue({}) },
		(overrides.settingsService as any) ?? { getDBSettings: jest.fn().mockResolvedValue({}) },
		(overrides.buffer as any) ?? { addToBuffer: jest.fn() },
		(overrides.incidentService as any) ?? { handleIncident: jest.fn().mockResolvedValue(undefined) },
		(overrides.maintenanceWindowsRepository as any) ?? maintenanceWindowsRepository,
		(overrides.monitorsRepository as any) ?? { createMonitor: jest.fn(), createMonitors: jest.fn(), updateById: jest.fn() },
		(overrides.teamsRepository as any) ?? { findTeamById: jest.fn() },
		(overrides.monitorStatsRepository as any) ?? { recordMonitorStats: jest.fn() },
		(overrides.checksRepository as any) ?? { addCheck: jest.fn() },
		(overrides.incidentsRepository as any) ?? { findActiveByMonitorId: jest.fn().mockResolvedValue(null) },
		(overrides.geoChecksService as any) ?? { supported: [] },
		(overrides.geoChecksRepository as any) ?? { findGeoChecksByMonitorId: jest.fn() }
	);
	return { helper, maintenanceWindowsRepository };
};

describe("SuperSimpleQueueHelper", () => {
	describe("getMonitorJob", () => {
		it("skips execution when monitor is in maintenance window", async () => {
			const { helper } = createHelper();
			const spy = jest.spyOn(helper, "isInMaintenanceWindow").mockResolvedValue(true);
			const job = helper.getHeartbeatJob();
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
			const job = helper.getHeartbeatJob();
			const monitor = { id: "m1", teamId: "team" } as Monitor;
			await job(monitor);
			expect(helper["networkService"].requestStatus).toHaveBeenCalledWith(monitor);
		});

		it("selects the initial escalation step with zero delay", () => {
			const { helper } = createHelper();
			const initialStep = helper["getInitialEscalationStep"]([
				{ delayMinutes: 5, notificationIds: ["n2"] },
				{ delayMinutes: 0, notificationIds: ["n1"] },
			]);
			expect(initialStep).toEqual({ delayMinutes: 0, notificationIds: ["n1"] });
		});

		it("selects the next escalation step when elapsed time passes the delay", () => {
			const { helper } = createHelper();
			const incident = {
				startTime: new Date(Date.now() - 7 * 60 * 1000).toISOString(),
				lastEscalationStep: 0,
			} as any;
			const nextStep = helper["getNextEscalationStep"](
				[
					{ delayMinutes: 0, notificationIds: ["first"] },
					{ delayMinutes: 5, notificationIds: ["second"] },
					{ delayMinutes: 10, notificationIds: ["third"] },
				],
				incident
			);
			expect(nextStep).toEqual({ delayMinutes: 5, notificationIds: ["second"] });
		});

		it("returns null when no escalation step is due yet", () => {
			const { helper } = createHelper();
			const incident = {
				startTime: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
				lastEscalationStep: 0,
			} as any;
			const nextStep = helper["getNextEscalationStep"](
				[
					{ delayMinutes: 0, notificationIds: ["first"] },
					{ delayMinutes: 5, notificationIds: ["second"] },
				],
				incident
			);
			expect(nextStep).toBeNull();
		});

		it("throws when monitor id is missing", async () => {
			const { helper } = createHelper();
			const job = helper.getHeartbeatJob();
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
