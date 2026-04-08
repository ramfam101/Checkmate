import { describe, expect, it, jest } from "@jest/globals";
import { NotificationsService } from "../src/service/infrastructure/notificationsService.ts";
import { NotificationMessageBuilder } from "../src/service/infrastructure/notificationMessageBuilder.ts";
import type { Incident, Monitor, Notification } from "../src/types/index.ts";

const createNotification = (): Notification => ({
	id: "notification-1",
	userId: "user-1",
	teamId: "team-1",
	type: "email",
	notificationName: "Ops Email",
	address: "ops@example.com",
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
});

const createMonitor = (): Monitor => ({
	id: "monitor-1",
	userId: "user-1",
	teamId: "team-1",
	name: "API",
	status: "down",
	statusWindow: [],
	statusWindowSize: 5,
	statusWindowThreshold: 60,
	type: "http",
	ignoreTlsErrors: false,
	useAdvancedMatching: false,
	url: "https://example.com",
	isActive: true,
	interval: 60000,
	notifications: [],
	escalationPolicy: [{ notificationId: "notification-1", delayMinutes: 5 }],
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
});

const createIncident = (): Incident => ({
	id: "incident-1",
	monitorId: "monitor-1",
	teamId: "team-1",
	startTime: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
	endTime: null,
	status: true,
	message: null,
	statusCode: 500,
	sentEscalations: [],
	resolutionType: null,
	resolvedBy: null,
	resolvedByEmail: null,
	comment: null,
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
});

describe("NotificationsService escalations", () => {
	it("sends due escalations once an incident duration crosses the configured delay", async () => {
		const notification = createNotification();
		const incident = createIncident();
		const emailProvider = {
			sendMessage: jest.fn().mockResolvedValue(true),
			sendTestAlert: jest.fn(),
		};
		const incidentsRepository = {
			findActiveByMonitorId: jest.fn().mockResolvedValue(incident),
			updateById: jest.fn().mockResolvedValue({
				...incident,
				sentEscalations: ["notification-1:5"],
			}),
		};
		const notificationsRepository = {
			findNotificationsByIds: jest.fn().mockResolvedValue([]),
			findById: jest.fn().mockResolvedValue(notification),
			create: jest.fn(),
			findByTeamId: jest.fn(),
			updateById: jest.fn(),
			deleteById: jest.fn(),
		};

		const service = new NotificationsService(
			notificationsRepository as never,
			{ removeNotificationFromMonitors: jest.fn() } as never,
			incidentsRepository as never,
			{ sendMessage: jest.fn(), sendTestAlert: jest.fn() } as never,
			emailProvider as never,
			{ sendMessage: jest.fn(), sendTestAlert: jest.fn() } as never,
			{ sendMessage: jest.fn(), sendTestAlert: jest.fn() } as never,
			{ sendMessage: jest.fn(), sendTestAlert: jest.fn() } as never,
			{ sendMessage: jest.fn(), sendTestAlert: jest.fn() } as never,
			{ sendMessage: jest.fn(), sendTestAlert: jest.fn() } as never,
			{ getSettings: jest.fn().mockReturnValue({ clientHost: "http://localhost:3000" }) } as never,
			{ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } as never,
			new NotificationMessageBuilder()
		);

		const result = await service.handleNotifications(
			createMonitor(),
			{ code: 500, message: "Connection refused", status: false },
			{
				shouldCreateIncident: false,
				shouldResolveIncident: false,
				shouldSendNotification: false,
				incidentReason: null,
				notificationReason: null,
			}
		);

		expect(result).toBe(true);
		expect(emailProvider.sendMessage).toHaveBeenCalledTimes(1);
		expect(incidentsRepository.updateById).toHaveBeenCalledWith(
			"incident-1",
			"team-1",
			expect.objectContaining({ sentEscalations: ["notification-1:5"] })
		);
	});

	it("removes deleted notification channels from monitor references", async () => {
		const monitorsRepository = {
			removeNotificationFromMonitors: jest.fn().mockResolvedValue(undefined),
		};
		const notificationsRepository = {
			deleteById: jest.fn().mockResolvedValue(createNotification()),
		};

		const service = new NotificationsService(
			notificationsRepository as never,
			monitorsRepository as never,
			{} as never,
			{ sendMessage: jest.fn(), sendTestAlert: jest.fn() } as never,
			{ sendMessage: jest.fn(), sendTestAlert: jest.fn() } as never,
			{ sendMessage: jest.fn(), sendTestAlert: jest.fn() } as never,
			{ sendMessage: jest.fn(), sendTestAlert: jest.fn() } as never,
			{ sendMessage: jest.fn(), sendTestAlert: jest.fn() } as never,
			{ sendMessage: jest.fn(), sendTestAlert: jest.fn() } as never,
			{ sendMessage: jest.fn(), sendTestAlert: jest.fn() } as never,
			{ getSettings: jest.fn().mockReturnValue({ clientHost: "http://localhost:3000" }) } as never,
			{ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() } as never,
			new NotificationMessageBuilder()
		);

		await service.deleteById("notification-1", "team-1");

		expect(notificationsRepository.deleteById).toHaveBeenCalledWith("notification-1", "team-1");
		expect(monitorsRepository.removeNotificationFromMonitors).toHaveBeenCalledWith("notification-1");
	});
});
