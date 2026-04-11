import { describe, expect, it, jest } from "@jest/globals";
import { NotificationsService } from "../src/service/infrastructure/notificationsService.ts";
import { NotificationMessageBuilder } from "../src/service/infrastructure/notificationMessageBuilder.ts";
import type { Incident, Monitor, Notification } from "../src/types/index.ts";

const createLogger = () => ({
	info: jest.fn(),
	warn: jest.fn(),
	error: jest.fn(),
	debug: jest.fn(),
});

const buildNotification = (overrides: Partial<Notification> = {}): Notification => ({
	id: "notification-1",
	userId: "user-1",
	teamId: "team-1",
	type: "email",
	notificationName: "Primary email",
	address: "ops@example.com",
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
	...overrides,
});

const buildIncident = (overrides: Partial<Incident> = {}): Incident => ({
	id: "incident-1",
	monitorId: "monitor-1",
	teamId: "team-1",
	startTime: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
	endTime: null,
	status: true,
	resolutionType: null,
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
	escalationEvents: [],
	...overrides,
});

const buildMonitor = (overrides: Partial<Monitor> = {}): Monitor => ({
	id: "monitor-1",
	userId: "user-1",
	teamId: "team-1",
	name: "API",
	description: "",
	status: "down",
	statusWindow: [],
	statusWindowSize: 1,
	statusWindowThreshold: 1,
	type: "http",
	ignoreTlsErrors: false,
	useAdvancedMatching: false,
	url: "https://api.example.com",
	isActive: true,
	interval: 60000,
	notifications: ["notification-1"],
	escalationAfterMinutes: 15,
	escalationNotifications: ["notification-1"],
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
});

const createService = () => {
	const notificationsRepository = {
		create: jest.fn(),
		findById: jest.fn(),
		findNotificationsByIds: jest.fn<() => Promise<Notification[]>>(),
		findByTeamId: jest.fn(),
		updateById: jest.fn(),
		deleteById: jest.fn(),
	};
	const monitorsRepository = {
		removeNotificationFromMonitors: jest.fn(),
	};
	const incidentsRepository = {
		findActiveByMonitorId: jest.fn<() => Promise<Incident | null>>(),
		updateById: jest.fn(),
	};
	const emailProvider = {
		sendMessage: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
		sendTestAlert: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
	};
	const noopProvider = {
		sendMessage: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
		sendTestAlert: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
	};
	const settingsService = {
		getSettings: jest.fn().mockReturnValue({ clientHost: "http://localhost:5173" }),
	};
	const logger = createLogger();

	const service = new NotificationsService(
		notificationsRepository as never,
		monitorsRepository as never,
		incidentsRepository as never,
		noopProvider as never,
		emailProvider as never,
		noopProvider as never,
		noopProvider as never,
		noopProvider as never,
		noopProvider as never,
		noopProvider as never,
		settingsService as never,
		logger as never,
		new NotificationMessageBuilder()
	);

	return {
		service,
		notificationsRepository,
		incidentsRepository,
		emailProvider,
	};
};

describe("NotificationsService escalations", () => {
	it("sends an escalated notification once when an incident crosses its configured duration", async () => {
		const { service, notificationsRepository, incidentsRepository, emailProvider } = createService();
		const notification = buildNotification();
		const activeIncident = buildIncident();
		const monitor = buildMonitor();
		const statusResponse = { code: 503, message: "Service unavailable" } as never;

		notificationsRepository.findNotificationsByIds.mockResolvedValue([notification]);
		incidentsRepository.findActiveByMonitorId.mockResolvedValue(activeIncident);
		incidentsRepository.updateById.mockImplementation(async (_id, _teamId, patch) => ({
			...activeIncident,
			...patch,
		}));

		const result = await service.handleEscalations(monitor, statusResponse);

		expect(result).toBe(true);
		expect(emailProvider.sendMessage).toHaveBeenCalledTimes(1);
		expect(emailProvider.sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({ id: "notification-1" }),
			expect.objectContaining({
				metadata: expect.objectContaining({
					isEscalation: true,
					escalationMinutes: 15,
					incidentId: "incident-1",
				}),
				content: expect.objectContaining({
					title: expect.stringContaining("Escalation"),
				}),
			})
		);
		expect(incidentsRepository.updateById).toHaveBeenCalledWith(
			"incident-1",
			"team-1",
			expect.objectContaining({
				escalationEvents: [
					expect.objectContaining({
						notificationId: "notification-1",
						minutes: 15,
					}),
				],
			})
		);
	});

	it("allows a small grace window so 1-minute escalations are not skipped by scheduler jitter", async () => {
		const { service, notificationsRepository, incidentsRepository, emailProvider } = createService();
		const notification = buildNotification();
		const activeIncident = buildIncident({
			startTime: new Date(Date.now() - (15 * 60 * 1000 - 4000)).toISOString(),
		});
		const monitor = buildMonitor({ interval: 60000 });
		const statusResponse = { code: 503, message: "Service unavailable" } as never;

		notificationsRepository.findNotificationsByIds.mockResolvedValue([notification]);
		incidentsRepository.findActiveByMonitorId.mockResolvedValue(activeIncident);
		incidentsRepository.updateById.mockImplementation(async (_id, _teamId, patch) => ({
			...activeIncident,
			...patch,
		}));

		const result = await service.handleEscalations(monitor, statusResponse);

		expect(result).toBe(true);
		expect(emailProvider.sendMessage).toHaveBeenCalledTimes(1);
	});

	it("does not resend an escalation that was already recorded for the same incident and channel", async () => {
		const { service, notificationsRepository, incidentsRepository, emailProvider } = createService();
		const notification = buildNotification();
		const activeIncident = buildIncident({
			escalationEvents: [
				{
					notificationId: "notification-1",
					minutes: 15,
					sentAt: new Date().toISOString(),
				},
			],
		});
		const monitor = buildMonitor();
		const statusResponse = { code: 503, message: "Service unavailable" } as never;

		notificationsRepository.findNotificationsByIds.mockResolvedValue([notification]);
		incidentsRepository.findActiveByMonitorId.mockResolvedValue(activeIncident);

		const result = await service.handleEscalations(monitor, statusResponse);

		expect(result).toBe(false);
		expect(emailProvider.sendMessage).not.toHaveBeenCalled();
		expect(incidentsRepository.updateById).not.toHaveBeenCalled();
	});
});
