import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { NotificationsService } from "../src/service/infrastructure/notificationsService.ts";
import type { Monitor } from "../src/types/monitor.ts";
import type { Notification } from "../src/types/notification.ts";
import type { MonitorStatusResponse } from "../src/types/network.ts";

const createLogger = () => ({
	info: jest.fn(),
	warn: jest.fn(),
	error: jest.fn(),
	debug: jest.fn(),
});

const createNotification = (overrides: Partial<Notification>): Notification => ({
	id: "notification-1",
	userId: "user-1",
	teamId: "team-1",
	type: "email",
	notificationName: "Email Channel",
	address: "alerts@example.com",
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
	...overrides,
});

const createMonitor = (): Monitor => ({
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
	notifications: [],
	escalationAfterMinutes: 10,
	escalationNotifications: ["notification-1", "notification-2"],
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

const createStatus = (): MonitorStatusResponse => ({
	monitorId: "monitor-1",
	teamId: "team-1",
	type: "http",
	status: false,
	code: 500,
	message: "Monitor down",
});

describe("NotificationsService.handleEscalationNotifications", () => {
	let notificationsRepository: { findNotificationsByIds: jest.Mock<any> };
	let emailProvider: { sendMessage: jest.Mock<any> };
	let buildMessageMock: jest.Mock<any>;
	let service: NotificationsService;

	beforeEach(() => {
		notificationsRepository = {
			findNotificationsByIds: jest.fn(),
		};

		emailProvider = {
			sendMessage: jest.fn(() => Promise.resolve(true)),
		};

		buildMessageMock = jest.fn(() => ({
			type: "escalation",
			severity: "critical",
			monitor: {
				id: "monitor-1",
				name: "API",
				url: "https://example.com",
				type: "http",
				status: "down",
			},
			content: { title: "Escalation: API still down", summary: "Still down", details: [], timestamp: new Date() },
			clientHost: "https://app.example.com",
			metadata: { teamId: "team-1", notificationReason: "escalation" },
		}));

		service = new NotificationsService(
			notificationsRepository as any,
			{} as any,
			{} as any,
			emailProvider as any,
			{} as any,
			{} as any,
			{} as any,
			{} as any,
			{} as any,
			{ getSettings: () => ({ clientHost: "https://app.example.com" }) } as any,
			createLogger() as any,
			{ buildMessage: buildMessageMock } as any
		);
	});

	it("sends escalation only to email channels", async () => {
		notificationsRepository.findNotificationsByIds.mockResolvedValue([
			createNotification({ id: "notification-1", type: "email" }),
			createNotification({ id: "notification-2", type: "slack", notificationName: "Slack Channel" }),
		]);

		const sent = await service.handleEscalationNotifications(createMonitor(), createStatus());

		expect(sent).toBe(true);
		expect(notificationsRepository.findNotificationsByIds).toHaveBeenCalledWith(["notification-1", "notification-2"]);
		expect(emailProvider.sendMessage).toHaveBeenCalledTimes(1);
		expect(emailProvider.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ id: "notification-1", type: "email" }), expect.any(Object));
	});

	it("passes escalation notificationReason to message builder", async () => {
		notificationsRepository.findNotificationsByIds.mockResolvedValue([
			createNotification({ id: "notification-1", type: "email" }),
		]);

		await service.handleEscalationNotifications(createMonitor(), createStatus());

		expect(buildMessageMock).toHaveBeenCalledWith(
			expect.any(Object),
			expect.any(Object),
			expect.objectContaining({ notificationReason: "escalation" }),
			expect.any(String)
		);
	});

	it("returns false when no email channels are configured", async () => {
		notificationsRepository.findNotificationsByIds.mockResolvedValue([
			createNotification({ id: "notification-2", type: "slack", notificationName: "Slack Channel" }),
		]);

		const sent = await service.handleEscalationNotifications(createMonitor(), createStatus());
		expect(sent).toBe(false);
		expect(emailProvider.sendMessage).not.toHaveBeenCalled();
	});

	it("returns false when escalationNotifications is empty", async () => {
		const monitor = createMonitor();
		monitor.escalationNotifications = [];

		const sent = await service.handleEscalationNotifications(monitor, createStatus());
		expect(sent).toBe(false);
		expect(notificationsRepository.findNotificationsByIds).not.toHaveBeenCalled();
	});
});
