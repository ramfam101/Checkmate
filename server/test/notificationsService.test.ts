import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { NotificationsService } from "../src/service/infrastructure/notificationsService.ts";
import type { Monitor } from "../src/types/monitor.ts";
import type { MonitorStatusResponse } from "../src/types/network.ts";
import type { Notification } from "../src/types/notification.ts";

const createLogger = () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() });

const createService = (overrides?: Partial<ConstructorParameters<typeof NotificationsService>[0]>) => {
	const notificationsRepository = {
		findNotificationsByIds: jest.fn(),
	};
	const monitorsRepository = {
		findById: jest.fn(),
	};
	const incidentsRepository = {
		findActiveByMonitorId: jest.fn(),
	};
	const notificationMessageBuilder = {
		buildMessage: jest.fn().mockReturnValue({ title: "Escalation", content: {} }),
		extractThresholdBreaches: jest.fn(),
	};
	const providers = {
		webhookProvider: { sendMessage: jest.fn(), sendTestAlert: jest.fn() },
		emailProvider: { sendMessage: jest.fn().mockResolvedValue(true), sendTestAlert: jest.fn() },
		slackProvider: { sendMessage: jest.fn(), sendTestAlert: jest.fn() },
		discordProvider: { sendMessage: jest.fn(), sendTestAlert: jest.fn() },
		pagerDutyProvider: { sendMessage: jest.fn(), sendTestAlert: jest.fn() },
		matrixProvider: { sendMessage: jest.fn(), sendTestAlert: jest.fn() },
		teamsProvider: { sendMessage: jest.fn(), sendTestAlert: jest.fn() },
	};

	const service = new NotificationsService(
		notificationsRepository as any,
		monitorsRepository as any,
		incidentsRepository as any,
		providers.webhookProvider as any,
		providers.emailProvider as any,
		providers.slackProvider as any,
		providers.discordProvider as any,
		providers.pagerDutyProvider as any,
		providers.matrixProvider as any,
		providers.teamsProvider as any,
		{ getSettings: jest.fn().mockReturnValue({ clientHost: "http://localhost" }) } as any,
		createLogger() as any,
		notificationMessageBuilder as any,
		...(overrides ? [overrides] : [])
	);

	return { service, notificationsRepository, monitorsRepository, incidentsRepository, notificationMessageBuilder, providers };
};

const createMonitor = (overrides?: Partial<Monitor>): Monitor =>
	({
		id: "monitor-1",
		teamId: "team-1",
		name: "Example",
		url: "https://example.com",
		type: "http",
		status: "down",
		notifications: [],
		escalationAfterMinutes: 1,
		escalationNotifications: ["notify-1"],
		statusWindow: [],
		statusWindowSize: 5,
		statusWindowThreshold: 60,
		ignoreTlsErrors: false,
		useAdvancedMatching: false,
		isActive: true,
		interval: 60000,
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

const createStatusResponse = (): MonitorStatusResponse =>
	({
		monitor: { id: "monitor-1" },
		status: true,
		code: 500,
		message: "failure",
		payload: null,
	} as unknown as MonitorStatusResponse);

describe("NotificationsService escalation", () => {
	beforeEach(() => {
		jest.useFakeTimers();
	});

	afterEach(() => {
		jest.useRealTimers();
		jest.clearAllMocks();
	});

	it("sends escalation notifications after the configured delay", async () => {
		const { service, notificationsRepository, monitorsRepository, incidentsRepository, providers, notificationMessageBuilder } = createService();
		const monitor = createMonitor();
		const response = createStatusResponse();

		notificationsRepository.findNotificationsByIds.mockImplementation((ids: string[]) =>
			ids.length ? Promise.resolve([{ id: "notify-1", type: "email" } as Partial<Notification>]) : Promise.resolve([])
		);
		monitorsRepository.findById.mockResolvedValue(monitor);
		incidentsRepository.findActiveByMonitorId.mockResolvedValue({ id: "incident-1" });

		await service.handleNotifications(monitor, response, {
			shouldCreateIncident: true,
			shouldResolveIncident: false,
			shouldSendNotification: true,
			incidentReason: "status_down",
			notificationReason: "status_change",
		});

		await jest.advanceTimersByTimeAsync(60_000);
		await Promise.resolve();

		expect(notificationMessageBuilder.buildMessage).toHaveBeenCalledTimes(2);
		expect(notificationsRepository.findNotificationsByIds).toHaveBeenLastCalledWith(["notify-1"]);
		expect(providers.emailProvider.sendMessage).toHaveBeenCalledTimes(1);
		expect(providers.emailProvider.sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({ id: "notify-1", type: "email" }),
			expect.objectContaining({ title: "Escalation" })
		);
	});

	it("cancels a pending escalation when the monitor recovers", async () => {
		const { service, notificationsRepository, monitorsRepository, incidentsRepository, providers } = createService();
		const monitor = createMonitor();
		const response = createStatusResponse();

		notificationsRepository.findNotificationsByIds.mockImplementation((ids: string[]) =>
			ids.length ? Promise.resolve([{ id: "notify-1", type: "email" } as Partial<Notification>]) : Promise.resolve([])
		);
		monitorsRepository.findById.mockResolvedValue(monitor);
		incidentsRepository.findActiveByMonitorId.mockResolvedValue({ id: "incident-1" });

		await service.handleNotifications(monitor, response, {
			shouldCreateIncident: true,
			shouldResolveIncident: false,
			shouldSendNotification: true,
			incidentReason: "status_down",
			notificationReason: "status_change",
		});

		await service.handleNotifications(
			{ ...monitor, status: "up" },
			{ ...response, status: true },
			{
				shouldCreateIncident: false,
				shouldResolveIncident: true,
				shouldSendNotification: true,
				incidentReason: null,
				notificationReason: "status_change",
			}
		);

		await jest.advanceTimersByTimeAsync(60_000);
		await Promise.resolve();

		expect(providers.emailProvider.sendMessage).not.toHaveBeenCalled();
	});
});
