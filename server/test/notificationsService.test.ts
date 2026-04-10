import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { NotificationsService } from "../src/service/infrastructure/notificationsService.ts";
import type { Monitor } from "../src/types/monitor.ts";
import type { Notification } from "../src/types/notification.ts";
import type { NotificationMessage } from "../src/types/notificationMessage.ts";

const createLogger = () => ({
	info: jest.fn(),
	warn: jest.fn(),
	error: jest.fn(),
	debug: jest.fn(),
});

const createNotification = (overrides?: Partial<Notification>): Notification => ({
	id: "notif-1",
	userId: "user-1",
	teamId: "team-1",
	type: "email",
	notificationName: "Primary Email",
	address: "alerts@example.com",
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
	...overrides,
});

const createMonitor = (overrides?: Partial<Monitor>): Monitor => ({
	id: "monitor-1",
	userId: "user-1",
	teamId: "team-1",
	name: "API",
	description: "",
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
	notifications: ["notif-1"],
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
	escalationRules: [{ delayMinutes: 5 }],
	recentChecks: [],
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
	...overrides,
});

const createMessage = (): NotificationMessage => ({
	type: "monitor_down",
	severity: "critical",
	monitor: {
		id: "monitor-1",
		name: "API",
		url: "https://example.com",
		type: "http",
		status: "down",
	},
	content: {
		title: "Monitor down",
		summary: "API is down",
		timestamp: new Date(),
	},
	clientHost: "https://app.example.com",
	metadata: {
		teamId: "team-1",
		notificationReason: "monitor_down",
	},
});

const createService = () => {
	const notificationsRepository = {
		findNotificationsByIds: jest.fn(),
		create: jest.fn(),
		findById: jest.fn(),
		findByTeamId: jest.fn(),
		updateById: jest.fn(),
		deleteById: jest.fn(),
	};
	const incidentsRepository = {
		findActiveByMonitorId: jest.fn(),
		updateEscalationsSent: jest.fn(),
	};
	const monitorsRepository = {
		removeNotificationFromMonitors: jest.fn(),
	};
	const emailProvider = {
		sendMessage: jest.fn(),
		sendTestAlert: jest.fn(),
	};
	const webhookProvider = {
		sendMessage: jest.fn(),
		sendTestAlert: jest.fn(),
	};
	const slackProvider = {
		sendMessage: jest.fn(),
		sendTestAlert: jest.fn(),
	};
	const discordProvider = {
		sendMessage: jest.fn(),
		sendTestAlert: jest.fn(),
	};
	const pagerDutyProvider = {
		sendMessage: jest.fn(),
		sendTestAlert: jest.fn(),
	};
	const matrixProvider = {
		sendMessage: jest.fn(),
		sendTestAlert: jest.fn(),
	};
	const teamsProvider = {
		sendMessage: jest.fn(),
		sendTestAlert: jest.fn(),
	};
	const settingsService = {
		getSettings: jest.fn(() => ({ clientHost: "https://app.example.com" })),
	};
	const logger = createLogger();
	const notificationMessageBuilder = {
		buildMessage: jest.fn(() => createMessage()),
	};

	const service = new NotificationsService(
		notificationsRepository as any,
		incidentsRepository as any,
		monitorsRepository as any,
		webhookProvider as any,
		emailProvider as any,
		slackProvider as any,
		discordProvider as any,
		pagerDutyProvider as any,
		matrixProvider as any,
		teamsProvider as any,
		settingsService as any,
		logger as any,
		notificationMessageBuilder as any
	);

	return {
		service,
		notificationsRepository,
		incidentsRepository,
		emailProvider,
		logger,
	};
};

describe("NotificationsService", () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it("returns false when testAllNotifications cannot resolve every requested notification", async () => {
		const { service, notificationsRepository, emailProvider, logger } = createService();

		notificationsRepository.findNotificationsByIds.mockResolvedValue([createNotification({ id: "notif-1" })]);
		emailProvider.sendTestAlert.mockResolvedValue(true);

		const result = await service.testAllNotifications(["notif-1", "missing-notification"]);

		expect(result).toBe(false);
		expect(emailProvider.sendTestAlert).toHaveBeenCalledTimes(1);
		expect(logger.warn).toHaveBeenCalledWith(
			expect.objectContaining({
				message: "Some notification IDs could not be resolved",
				service: "NotificationsService",
			})
		);
	});

	it("returns false when a notification-triggering monitor has no resolvable channels", async () => {
		const { service, notificationsRepository, logger } = createService();

		notificationsRepository.findNotificationsByIds.mockResolvedValue([]);

		const result = await service.handleNotifications(
			createMonitor({ notifications: ["missing-notification"] }),
			{
				monitorId: "monitor-1",
				teamId: "team-1",
				status: false,
				message: "Connection refused",
				code: 500,
				responseTime: 123,
			} as any,
			{ shouldSendNotification: true } as any
		);

		expect(result).toBe(false);
		expect(logger.warn).toHaveBeenCalledWith(
			expect.objectContaining({
				message: "Notification lookup returned no channels",
				service: "NotificationsService",
			})
		);
	});

	it("uses the active incident and persists sent escalation thresholds", async () => {
		const { service, notificationsRepository, incidentsRepository, emailProvider } = createService();
		const startTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();

		notificationsRepository.findNotificationsByIds.mockResolvedValue([createNotification()]);
		incidentsRepository.findActiveByMonitorId.mockResolvedValue({
			id: "incident-1",
			monitorId: "monitor-1",
			teamId: "team-1",
			startTime,
			status: true,
			escalationsSent: [],
		});
		emailProvider.sendMessage.mockResolvedValue(true);

		await service.handleEscalations(createMonitor(), startTime);

		expect(incidentsRepository.findActiveByMonitorId).toHaveBeenCalledWith("monitor-1", "team-1");
		expect(emailProvider.sendMessage).toHaveBeenCalledTimes(1);
		expect(incidentsRepository.updateEscalationsSent).toHaveBeenCalledWith("incident-1", [5]);
	});
});
