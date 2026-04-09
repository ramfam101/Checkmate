import { describe, expect, it, jest } from "@jest/globals";
import { SuperSimpleQueueHelper } from "../src/service/infrastructure/SuperSimpleQueue/SuperSimpleQueueHelper.ts";
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

describe("SuperSimpleQueueHelper - Escalation Notifications", () => {
	const createEscalationHelper = (overrides?: Partial<ConstructorParameters<typeof SuperSimpleQueueHelper>[0]>) => {
		const notificationMessageBuilder = {
			buildMessage: jest.fn().mockReturnValue({
				type: "monitor_down",
				severity: "critical",
				monitor: { id: "m1", name: "Test Monitor", url: "https://example.com", type: "http", status: "down" },
				content: { title: "Escalation [1]: Monitor Down: Test Monitor", summary: "Monitor is down", details: [], timestamp: new Date() },
				clientHost: "https://app.example.com",
			}),
		};

		const notificationsService = {
			sendEscalationNotification: jest.fn().mockResolvedValue(true),
		};

		const incidentsRepository = {
			findIncidentsNeedingEscalation: jest.fn(),
		};

		const monitorsRepository = {
			findById: jest.fn(),
		};

		const notificationsRepository = {
			findNotificationsByIds: jest.fn(),
		};

		const settingsService = {
			getSettings: jest.fn().mockReturnValue({ clientHost: "https://app.example.com" }),
		};

		const helper = new SuperSimpleQueueHelper({
			logger: createLogger(),
			networkService: { requestStatus: jest.fn() },
			statusService: { updateMonitorStatus: jest.fn() },
			notificationsService,
			checkService: { buildCheck: jest.fn() },
			buffer: { addToBuffer: jest.fn() },
			incidentService: { handleIncident: jest.fn() },
			maintenanceWindowsRepository: { findByMonitorId: jest.fn().mockResolvedValue([]) },
			monitorsRepository,
			teamsRepository: { findById: jest.fn() },
			monitorStatsRepository: { create: jest.fn() },
			checksRepository: { create: jest.fn() },
			incidentsRepository,
			geoChecksService: { processGeoChecks: jest.fn() },
			geoChecksRepository: { create: jest.fn() },
			notificationMessageBuilder,
			notificationsRepository,
			settingsService,
			...overrides,
		});

		return {
			helper,
			notificationsService,
			incidentsRepository,
			monitorsRepository,
			notificationsRepository,
			notificationMessageBuilder,
			settingsService,
		};
	};

	it("sends escalation notifications across all notification channels", async () => {
		const {
			helper,
			notificationsService,
			incidentsRepository,
			monitorsRepository,
			notificationsRepository,
		} = createEscalationHelper();

		// Mock incident needing escalation
		const incident = {
			id: "incident1",
			monitorId: "monitor1",
			escalationsSent: 0,
			lastEscalationTime: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 minutes ago
		};
		incidentsRepository.findIncidentsNeedingEscalation.mockResolvedValue([incident]);

		// Mock monitor with escalation settings and multiple notification types
		const monitor = {
			id: "monitor1",
			teamId: "team1",
			name: "Test Monitor",
			url: "https://example.com",
			type: "http",
			status: "down",
			escalationEnabled: true,
			escalationIntervals: [0, 5, 15], // immediate, +5min, +15min
			notifications: ["notif1", "notif2", "notif3", "notif4", "notif5", "notif6", "notif7"],
		};
		monitorsRepository.findById.mockResolvedValue(monitor);

		// Mock notifications of all types
		const notifications = [
			{ id: "notif1", type: "email", notificationName: "Email Alert", address: "test@example.com" },
			{ id: "notif2", type: "slack", notificationName: "Slack Alert", address: "#alerts" },
			{ id: "notif3", type: "discord", notificationName: "Discord Alert", address: "#alerts" },
			{ id: "notif4", type: "webhook", notificationName: "Webhook Alert", address: "https://webhook.example.com" },
			{ id: "notif5", type: "pager_duty", notificationName: "PagerDuty Alert", address: "service-key" },
			{ id: "notif6", type: "matrix", notificationName: "Matrix Alert", homeserverUrl: "https://matrix.org", roomId: "!room:matrix.org" },
			{ id: "notif7", type: "teams", notificationName: "Teams Alert", address: "https://teams.webhook.com" },
		];
		notificationsRepository.findNotificationsByIds.mockResolvedValue(notifications);

		// Mock incidents repository update
		incidentsRepository.updateById = jest.fn().mockResolvedValue(undefined);

		// Execute escalation handling
		await (helper as any).handleEscalations(monitor);

		// Verify escalation notifications were sent for all notification types
		expect(notificationsService.sendEscalationNotification).toHaveBeenCalledTimes(7);

		// Verify each notification type was processed
		notifications.forEach((notification, index) => {
			expect(notificationsService.sendEscalationNotification).toHaveBeenNthCalledWith(
				index + 1,
				notification,
				expect.objectContaining({
					type: "monitor_down",
					content: expect.objectContaining({
						title: "Escalation [1]: Monitor Down: Test Monitor",
					}),
				})
			);
		});

		// Verify incident was updated with escalation count
		expect(incidentsRepository.updateById).toHaveBeenCalledWith("incident1", "team1", {
			escalationsSent: 1,
			lastEscalationTime: expect.any(String),
		});
	});

	it("skips escalation when monitor has no escalation settings", async () => {
		const { helper, notificationsService } = createEscalationHelper();

		const monitor = {
			id: "monitor1",
			teamId: "team1",
			name: "Test Monitor",
			escalationEnabled: false, // Disabled
			escalationIntervals: [],
		};

		await (helper as any).handleEscalations(monitor);

		// No escalation notifications should be sent
		expect(notificationsService.sendEscalationNotification).not.toHaveBeenCalled();
	});

	it("handles escalation errors gracefully", async () => {
		const {
			helper,
			notificationsService,
			incidentsRepository,
			monitorsRepository,
			notificationsRepository,
		} = createEscalationHelper();

		// Mock incident needing escalation
		incidentsRepository.findIncidentsNeedingEscalation.mockResolvedValue([
			{ id: "incident1", monitorId: "monitor1", escalationsSent: 0 },
		]);

		// Mock monitor
		monitorsRepository.findById.mockResolvedValue({
			id: "monitor1",
			teamId: "team1",
			escalationEnabled: true,
			escalationIntervals: [0],
			notifications: ["notif1"],
		});

		// Mock notification
		notificationsRepository.findNotificationsByIds.mockResolvedValue([
			{ id: "notif1", type: "email", notificationName: "Email Alert" },
		]);

		// Mock notification service to throw error
		notificationsService.sendEscalationNotification.mockRejectedValue(new Error("Send failed"));

		// Mock incidents repository update
		incidentsRepository.updateById = jest.fn().mockResolvedValue(undefined);

		// Execute escalation handling - should not throw
		await expect((helper as any).handleEscalations({ teamId: "team1" })).resolves.not.toThrow();

		// Verify error was logged but processing continued
		expect(helper["logger"].error).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringContaining("Error sending escalation notification"),
			})
		);
	});
});
