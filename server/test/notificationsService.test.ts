import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { NotificationsService } from "../src/service/infrastructure/notificationsService.ts";
import type { Monitor } from "../src/types/monitor.ts";
import type { NotificationMessage } from "../src/types/notificationMessage.ts";

const buildMonitor = (overrides: Partial<Monitor> = {}): Monitor =>
	({
		id: "monitor-1",
		userId: "user-1",
		teamId: "team-1",
		name: "API Monitor",
		description: "",
		status: "down",
		statusWindow: [],
		statusWindowSize: 5,
		statusWindowThreshold: 60,
		type: "http",
		ignoreTlsErrors: false,
		useAdvancedMatching: false,
		url: "https://example.com/health",
		isActive: true,
		interval: 60000,
		notifications: ["primary-channel"],
		escalation: {
			enabled: true,
			delayMinutes: 1,
			channelId: "escalation-channel",
		},
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
	} as Monitor);

const buildMessage = (type: NotificationMessage["type"]): NotificationMessage => ({
	type,
	severity: type === "monitor_down_escalation" ? "critical" : "info",
	monitor: {
		id: "monitor-1",
		name: "API Monitor",
		url: "https://example.com/health",
		type: "http",
		status: "down",
	},
	content: {
		title: "title",
		summary: "summary",
		timestamp: new Date(),
	},
	clientHost: "http://client-host",
	metadata: {
		teamId: "team-1",
		notificationReason: "status_change",
	},
});

describe("NotificationsService escalation", () => {
	const primaryNotification = {
		id: "primary-channel",
		teamId: "team-1",
		type: "email",
		address: "primary@example.com",
	};
	const escalationNotification = {
		id: "escalation-channel",
		teamId: "team-1",
		type: "email",
		address: "escalation@example.com",
	};

	let notificationsRepository: any;
	let monitorsRepository: any;
	let emailProvider: any;
	let service: NotificationsService;
	let notificationMessageBuilder: any;

	beforeEach(() => {
		jest.useFakeTimers();
		notificationsRepository = {
			findNotificationsByIds: jest.fn(async () => [primaryNotification]),
			findById: jest.fn(async () => escalationNotification),
		};
		monitorsRepository = {
			findById: jest.fn(async () => buildMonitor({ status: "down" })),
		};
		emailProvider = {
			sendMessage: jest.fn(async () => true),
			sendTestAlert: jest.fn(async () => true),
		};
		notificationMessageBuilder = {
			buildMessage: jest.fn().mockReturnValue(buildMessage("monitor_down")),
			buildEscalationMessage: jest.fn().mockReturnValue(buildMessage("monitor_down_escalation")),
		};

		service = new NotificationsService(
			notificationsRepository,
			monitorsRepository,
			{ sendMessage: jest.fn(async () => false), sendTestAlert: jest.fn(async () => false) } as any, // webhook
			emailProvider,
			{ sendMessage: jest.fn(async () => false), sendTestAlert: jest.fn(async () => false) } as any, // slack
			{ sendMessage: jest.fn(async () => false), sendTestAlert: jest.fn(async () => false) } as any, // discord
			{ sendMessage: jest.fn(async () => false), sendTestAlert: jest.fn(async () => false) } as any, // pagerDuty
			{ sendMessage: jest.fn(async () => false), sendTestAlert: jest.fn(async () => false) } as any, // matrix
			{ sendMessage: jest.fn(async () => false), sendTestAlert: jest.fn(async () => false) } as any, // teams
			{ getSettings: jest.fn(() => ({ clientHost: "http://client-host" })) } as any,
			{ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any,
			notificationMessageBuilder
		);
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it("sends escalation email after configured delay when monitor is still down", async () => {
		const monitor = buildMonitor({ status: "down" });
		const decision = {
			shouldCreateIncident: true,
			shouldResolveIncident: false,
			shouldSendNotification: true,
			incidentReason: "status_down",
			notificationReason: "status_change",
		};

		await service.handleNotifications(monitor, { code: 503, message: "Down" } as any, decision);
		expect(emailProvider.sendMessage).toHaveBeenCalledTimes(1);

		await jest.advanceTimersByTimeAsync(60000);

		expect(monitorsRepository.findById).toHaveBeenCalledWith(monitor.id, monitor.teamId);
		expect(notificationsRepository.findById).toHaveBeenCalledWith("escalation-channel", monitor.teamId);
		expect(notificationMessageBuilder.buildEscalationMessage).toHaveBeenCalled();
		expect(emailProvider.sendMessage).toHaveBeenCalledTimes(2);
	});

	it("does not send escalation when monitor recovers before timer fires", async () => {
		monitorsRepository.findById.mockImplementation(async () => buildMonitor({ status: "up" }));
		const monitor = buildMonitor({ status: "down" });
		const decision = {
			shouldCreateIncident: true,
			shouldResolveIncident: false,
			shouldSendNotification: true,
			incidentReason: "status_down",
			notificationReason: "status_change",
		};

		await service.handleNotifications(monitor, { code: 503, message: "Down" } as any, decision);
		await jest.advanceTimersByTimeAsync(60000);

		expect(emailProvider.sendMessage).toHaveBeenCalledTimes(1);
		expect(notificationsRepository.findById).not.toHaveBeenCalled();
	});

	it("cancels pending escalation timer when monitor sends a non-down notification", async () => {
		const downDecision = {
			shouldCreateIncident: true,
			shouldResolveIncident: false,
			shouldSendNotification: true,
			incidentReason: "status_down",
			notificationReason: "status_change",
		};
		const upDecision = {
			shouldCreateIncident: false,
			shouldResolveIncident: true,
			shouldSendNotification: true,
			incidentReason: null,
			notificationReason: "status_change",
		};

		await service.handleNotifications(buildMonitor({ status: "down" }), { code: 503, message: "Down" } as any, downDecision);
		await service.handleNotifications(buildMonitor({ status: "up" }), { code: 200, message: "Up" } as any, upDecision);

		await jest.advanceTimersByTimeAsync(60000);
		expect(emailProvider.sendMessage).toHaveBeenCalledTimes(2);
		expect(notificationsRepository.findById).not.toHaveBeenCalled();
	});
});
