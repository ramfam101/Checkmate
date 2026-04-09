import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { NotificationsService } from "../src/service/infrastructure/notificationsService.ts";
import type { Monitor } from "../src/types/monitor.ts";
import type { MonitorStatusResponse } from "../src/types/network.ts";
import type { Notification } from "../src/types/notification.ts";

const createLogger = () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() });

const createNotificationsRepositoryMock = () => ({
	findNotificationsByIds: jest.fn<(ids: string[]) => Promise<Notification[]>>().mockResolvedValue([]),
});

const createMonitorsRepositoryMock = () => ({
	updateById: jest.fn(),
});

const createEmailProviderMock = () => ({
	sendMessage: jest.fn<(notification: Notification, message: any) => Promise<boolean>>().mockResolvedValue(true),
	sendTestAlert: jest.fn<(notification: Partial<Notification>) => Promise<boolean>>().mockResolvedValue(true),
});

const createSettingsServiceMock = () => ({
	getSettings: jest.fn().mockReturnValue({ clientHost: "http://localhost:5173" }),
});

const createNotificationMessageBuilderMock = () => ({
	buildMessage: jest.fn(),
});

const createService = () => {
	const notificationsRepository = createNotificationsRepositoryMock();
	const monitorsRepository = createMonitorsRepositoryMock();
	const emailProvider = createEmailProviderMock();
	const settingsService = createSettingsServiceMock();
	const notificationMessageBuilder = createNotificationMessageBuilderMock();

	const service = new NotificationsService(
		notificationsRepository,
		monitorsRepository,
		{
			sendMessage: jest.fn<(notification: Notification, message: any) => Promise<boolean>>().mockResolvedValue(true),
			sendTestAlert: jest.fn<(notification: Partial<Notification>) => Promise<boolean>>().mockResolvedValue(true),
		}, // webhookProvider
		emailProvider,
		{
			sendMessage: jest.fn<(notification: Notification, message: any) => Promise<boolean>>().mockResolvedValue(true),
			sendTestAlert: jest.fn<(notification: Partial<Notification>) => Promise<boolean>>().mockResolvedValue(true),
		}, // slackProvider
		{
			sendMessage: jest.fn<(notification: Notification, message: any) => Promise<boolean>>().mockResolvedValue(true),
			sendTestAlert: jest.fn<(notification: Partial<Notification>) => Promise<boolean>>().mockResolvedValue(true),
		}, // discordProvider
		{
			sendMessage: jest.fn<(notification: Notification, message: any) => Promise<boolean>>().mockResolvedValue(true),
			sendTestAlert: jest.fn<(notification: Partial<Notification>) => Promise<boolean>>().mockResolvedValue(true),
		}, // pagerDutyProvider
		{
			sendMessage: jest.fn<(notification: Notification, message: any) => Promise<boolean>>().mockResolvedValue(true),
			sendTestAlert: jest.fn<(notification: Partial<Notification>) => Promise<boolean>>().mockResolvedValue(true),
		}, // matrixProvider
		{
			sendMessage: jest.fn<(notification: Notification, message: any) => Promise<boolean>>().mockResolvedValue(true),
			sendTestAlert: jest.fn<(notification: Partial<Notification>) => Promise<boolean>>().mockResolvedValue(true),
		}, // teamsProvider
		settingsService,
		createLogger(),
		notificationMessageBuilder
	);

	return {
		service,
		notificationsRepository,
		monitorsRepository,
		emailProvider,
		settingsService,
		notificationMessageBuilder,
	};
};

describe("NotificationsService", () => {
	describe("handleEscalationNotifications", () => {
		let service: NotificationsService;
		let monitorsRepository: ReturnType<typeof createMonitorsRepositoryMock>;
		let emailProvider: ReturnType<typeof createEmailProviderMock>;
		let notificationMessageBuilder: ReturnType<typeof createNotificationMessageBuilderMock>;

		beforeEach(() => {
			const mocks = createService();
			service = mocks.service;
			monitorsRepository = mocks.monitorsRepository;
			emailProvider = mocks.emailProvider;
			notificationMessageBuilder = mocks.notificationMessageBuilder;
		});

		it("does nothing if monitor is not down", async () => {
			const monitor = { status: "up", escalationRules: [{ delayMinutes: 5, notificationId: "n1" }] } as unknown as Monitor;
			const statusResponse = { status: true } as MonitorStatusResponse;

			const result = await service.handleEscalationNotifications(monitor, statusResponse);

			expect(result).toBe(false);
			expect(monitorsRepository.updateById).not.toHaveBeenCalled();
		});

		it("does nothing if no escalation rules exist", async () => {
			const monitor = { status: "down", escalationRules: [] } as unknown as Monitor;
			const statusResponse = { status: false } as MonitorStatusResponse;

			const result = await service.handleEscalationNotifications(monitor, statusResponse);

			expect(result).toBe(false);
			expect(monitorsRepository.updateById).not.toHaveBeenCalled();
		});

		it("sets downtimeStartedAt if not set and no rules are due", async () => {
			const monitor = {
				id: "m1",
				teamId: "team1",
				status: "down",
				escalationRules: [{ delayMinutes: 5, notificationId: "n1" }],
				downtimeStartedAt: null,
				escalationNotificationsSent: [],
			} as unknown as Monitor;
			const statusResponse = { status: false } as MonitorStatusResponse;

			// Mock Date.now to return a fixed time
			const fixedTime = 1000000;
			jest.spyOn(Date, "now").mockReturnValue(fixedTime);

			const result = await service.handleEscalationNotifications(monitor, statusResponse);

			expect(result).toBe(false);
			expect(monitorsRepository.updateById).toHaveBeenCalledWith("m1", "team1", {
				downtimeStartedAt: fixedTime,
				escalationNotificationsSent: [],
			});

			jest.restoreAllMocks();
		});

		it("sends escalation notification when delay has passed", async () => {
			const mocks = createService();
			const service = mocks.service;
			const notificationsRepository = mocks.notificationsRepository;
			const monitorsRepository = mocks.monitorsRepository;
			const emailProvider = mocks.emailProvider;
			const notificationMessageBuilder = mocks.notificationMessageBuilder;
			const monitor = {
				id: "m1",
				teamId: "team1",
				userId: "user1",
				status: "down",
				escalationRules: [{ delayMinutes: 5, notificationId: "n1" }],
				downtimeStartedAt: 1000000, // 1 second ago in mock time
				escalationNotificationsSent: [],
			} as unknown as Monitor;
			const statusResponse = { status: false } as MonitorStatusResponse;

			// Mock Date.now to return time after delay (5 minutes = 300000 ms)
			const currentTime = 1000000 + 300001;
			jest.spyOn(Date, "now").mockReturnValue(currentTime);

			// Mock the message builder
			const mockMessage = { type: "monitor_down", content: { title: "Test" } };
			notificationMessageBuilder.buildMessage.mockReturnValue(mockMessage);

			// Mock notification lookup
			const mockNotification = { id: "n1", type: "email", address: "test@example.com" } as Notification;
			notificationsRepository.findNotificationsByIds.mockResolvedValue([mockNotification]);

			// Mock email provider to succeed
			emailProvider.sendMessage.mockResolvedValue(true);

			const result = await service.handleEscalationNotifications(monitor, statusResponse);

			expect(result).toBe(true);
			expect(emailProvider.sendMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "email",
					address: "test@example.com",
					notificationName: "Escalation Alert",
				}),
				mockMessage
			);
			expect(monitorsRepository.updateById).toHaveBeenCalledWith("m1", "team1", {
				downtimeStartedAt: 1000000,
				escalationNotificationsSent: ["n1"],
			});

			jest.restoreAllMocks();
		});

		it("does not send duplicate escalation notifications", async () => {
			const mocks = createService();
			const service = mocks.service;
			const monitor = {
				id: "m1",
				teamId: "team1",
				userId: "user1",
				status: "down",
				escalationRules: [{ delayMinutes: 5, notificationId: "n1" }],
				downtimeStartedAt: 1000000,
				escalationNotificationsSent: ["n1"], // Already sent
			} as unknown as Monitor;
			const statusResponse = { status: false } as MonitorStatusResponse;

			const currentTime = 1000000 + 300001;
			jest.spyOn(Date, "now").mockReturnValue(currentTime);

			const result = await service.handleEscalationNotifications(monitor, statusResponse);

			expect(result).toBe(false);
			expect(emailProvider.sendMessage).not.toHaveBeenCalled();

			jest.restoreAllMocks();
		});

		it("handles multiple escalation rules with different delays", async () => {
			const mocks = createService();
			const service = mocks.service;
			const notificationsRepository = mocks.notificationsRepository;
			const monitorsRepository = mocks.monitorsRepository;
			const emailProvider = mocks.emailProvider;
			const notificationMessageBuilder = mocks.notificationMessageBuilder;
			const monitor = {
				id: "m1",
				teamId: "team1",
				userId: "user1",
				status: "down",
				escalationRules: [
					{ delayMinutes: 1, notificationId: "n1" },
					{ delayMinutes: 10, notificationId: "n2" },
				],
				downtimeStartedAt: 1000000,
				escalationNotificationsSent: [],
			} as unknown as Monitor;
			const statusResponse = { status: false } as MonitorStatusResponse;

			// Time after first delay but before second
			const currentTime = 1000000 + 60001; // 1 min 1 sec
			jest.spyOn(Date, "now").mockReturnValue(currentTime);

			const mockMessage = { type: "monitor_down", content: { title: "Test" } };
			notificationMessageBuilder.buildMessage.mockReturnValue(mockMessage);

			const mockNotifications = [
				{ id: "n1", type: "email", address: "first@example.com" } as Notification,
				{ id: "n2", type: "email", address: "second@example.com" } as Notification,
			];
			notificationsRepository.findNotificationsByIds.mockResolvedValue(mockNotifications);

			emailProvider.sendMessage.mockResolvedValue(true);

			const result = await service.handleEscalationNotifications(monitor, statusResponse);

			expect(result).toBe(true);
			expect(emailProvider.sendMessage).toHaveBeenCalledTimes(1);
			expect(emailProvider.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ address: "first@example.com" }), mockMessage);
			expect(monitorsRepository.updateById).toHaveBeenCalledWith("m1", "team1", {
				downtimeStartedAt: 1000000,
				escalationNotificationsSent: ["n1"],
			});

			jest.restoreAllMocks();
		});
	});

	describe("handleNotifications integration with escalation", () => {
		it("sends regular notifications immediately on status change", async () => {
			const mocks = createService();
			const service = mocks.service;
			const notificationsRepository = mocks.notificationsRepository;
			const emailProvider = mocks.emailProvider;
			const notificationMessageBuilder = mocks.notificationMessageBuilder;

			const monitor = {
				id: "m1",
				teamId: "team1",
				notifications: ["n1"],
			} as unknown as Monitor;
			const statusResponse = { status: false } as MonitorStatusResponse;
			const decision = {
				shouldSendNotification: true,
				notificationReason: "status_change" as const,
			};

			const mockNotification = { id: "n1", type: "email", address: "regular@example.com" } as Notification;
			notificationsRepository.findNotificationsByIds.mockResolvedValue([mockNotification]);

			const mockMessage = { type: "monitor_down", content: { title: "Monitor Down" } };
			notificationMessageBuilder.buildMessage.mockReturnValue(mockMessage);

			emailProvider.sendMessage.mockResolvedValue(true);

			const result = await service.handleNotifications(monitor, statusResponse, decision);

			expect(result).toBe(true);
			expect(notificationsRepository.findNotificationsByIds).toHaveBeenCalledWith(["n1"]);
			expect(notificationMessageBuilder.buildMessage).toHaveBeenCalledWith(monitor, statusResponse, decision, "http://localhost:5173");
			expect(emailProvider.sendMessage).toHaveBeenCalledWith(mockNotification, mockMessage);
		});

		it("sends regular notifications immediately and escalation notifications after delay", async () => {
			const mocks = createService();
			const service = mocks.service;
			const notificationsRepository = mocks.notificationsRepository;
			const monitorsRepository = mocks.monitorsRepository;
			const emailProvider = mocks.emailProvider;
			const notificationMessageBuilder = mocks.notificationMessageBuilder;

			// Monitor with regular notifications and escalation rules
			const monitor = {
				id: "m1",
				teamId: "team1",
				notifications: ["n1"], // Regular notification
				escalationRules: [{ delayMinutes: 5, notificationId: "n2" }], // Escalation notification
				downtimeStartedAt: 1000000,
				escalationNotificationsSent: [],
			} as unknown as Monitor;
			const statusResponse = { status: false } as MonitorStatusResponse;

			// First call: status change triggers regular notification
			const decision = {
				shouldSendNotification: true,
				notificationReason: "status_change" as const,
			};

			const mockNotifications = [
				{ id: "n1", type: "email", address: "regular@example.com" } as Notification,
				{ id: "n2", type: "email", address: "escalation@example.com" } as Notification,
			];
			notificationsRepository.findNotificationsByIds.mockResolvedValue(mockNotifications);

			const mockMessage = { type: "monitor_down", content: { title: "Monitor Down" } };
			notificationMessageBuilder.buildMessage.mockReturnValue(mockMessage);
			emailProvider.sendMessage.mockResolvedValue(true);

			// Send regular notification
			const result1 = await service.handleNotifications(monitor, statusResponse, decision);
			expect(result1).toBe(true);
			expect(emailProvider.sendMessage).toHaveBeenCalledWith(mockNotifications[0], mockMessage);

			// Reset mocks for escalation test
			emailProvider.sendMessage.mockClear();

			// Second call: after delay, check for escalation
			const currentTime = 1000000 + 300001; // After 5 minutes
			jest.spyOn(Date, "now").mockReturnValue(currentTime);

			const result2 = await service.handleEscalationNotifications(monitor, statusResponse);
			expect(result2).toBe(true);
			expect(emailProvider.sendMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "email",
					address: "escalation@example.com",
					notificationName: "Escalation Alert",
				}),
				mockMessage
			);
			expect(monitorsRepository.updateById).toHaveBeenCalledWith("m1", "team1", {
				downtimeStartedAt: 1000000,
				escalationNotificationsSent: ["n2"],
			});

			jest.restoreAllMocks();
		});

		it("sends escalation email after delay and tracks it properly", async () => {
			const mocks = createService();
			const service = mocks.service;
			const monitorsRepository = mocks.monitorsRepository;
			const emailProvider = mocks.emailProvider;
			const notificationMessageBuilder = mocks.notificationMessageBuilder;

			// Monitor with escalation rule using email instead of notificationId
			const monitor = {
				id: "m1",
				teamId: "team1",
				notifications: ["n1"], // Regular notification
				escalationRules: [{ delayMinutes: 10, email: "escalation@example.com" }],
				downtimeStartedAt: 1000000,
				escalationNotificationsSent: [],
			} as unknown as Monitor;
			const statusResponse = { status: false } as MonitorStatusResponse;

			// Time after escalation delay
			const currentTime = 1000000 + 600001; // 10 min 1 sec
			jest.spyOn(Date, "now").mockReturnValue(currentTime);

			const mockMessage = { type: "monitor_down", content: { title: "Escalation Alert" } };
			notificationMessageBuilder.buildMessage.mockReturnValue(mockMessage);

			emailProvider.sendMessage.mockResolvedValue(true);

			const result = await service.handleEscalationNotifications(monitor, statusResponse);

			expect(result).toBe(true);
			expect(emailProvider.sendMessage).toHaveBeenCalledTimes(1);
			expect(emailProvider.sendMessage).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "email",
					address: "escalation@example.com",
					notificationName: "Escalation Alert",
				}),
				mockMessage
			);
			expect(monitorsRepository.updateById).toHaveBeenCalledWith("m1", "team1", {
				downtimeStartedAt: 1000000,
				escalationNotificationsSent: ["escalation@example.com"],
			});

			jest.restoreAllMocks();
		});
	});
});
