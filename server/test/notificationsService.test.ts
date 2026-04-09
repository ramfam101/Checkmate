import { describe, expect, it, jest } from "@jest/globals";
import { NotificationsService } from "../src/service/infrastructure/notificationsService.ts";
import type { Monitor, Incident } from "../src/types/index.ts";
import { createMockLogger } from "./helpers/createMockLogger.ts";

const createService = ({
	activeIncident,
	escalationSendResult = true,
}: {
	activeIncident?: Partial<Incident> | null;
	escalationSendResult?: boolean;
} = {}) => {
	const notificationsRepository = {
		findNotificationsByIds: jest.fn().mockResolvedValue([
			{ id: "n2", type: "email", notificationName: "Escalation Email" },
		]),
		create: jest.fn(),
		findById: jest.fn(),
		findByTeamId: jest.fn(),
		updateById: jest.fn(),
		deleteById: jest.fn(),
	};
	const incidentsRepository = {
		findActiveByMonitorId: jest.fn().mockResolvedValue(
			activeIncident === undefined
				? {
						id: "incident-1",
						teamId: "team-1",
						monitorId: "monitor-1",
						startTime: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
						status: true,
						resolutionType: null,
						escalationNotifiedAt: null,
					}
				: activeIncident
		),
		updateById: jest.fn().mockResolvedValue({}),
	};
	const monitorsRepository = {
		removeNotificationFromMonitors: jest.fn(),
	};
	const emailProvider = {
		sendMessage: jest.fn().mockResolvedValue(escalationSendResult),
		sendTestAlert: jest.fn(),
	};
	const noopProvider = {
		sendMessage: jest.fn(),
		sendTestAlert: jest.fn(),
	};
	const settingsService = {
		getSettings: jest.fn().mockReturnValue({ clientHost: "http://localhost:3000" }),
	};
	const notificationMessageBuilder = {
		buildMessage: jest.fn().mockReturnValue({
			type: "monitor_down",
			severity: "critical",
			monitor: { id: "monitor-1", name: "API", url: "https://example.com", type: "http", status: "down" },
			content: { title: "Down", summary: "Down", details: [], timestamp: new Date() },
			clientHost: "http://localhost:3000",
			metadata: { teamId: "team-1", notificationReason: "status_change" },
		}),
	};

	const service = new NotificationsService(
		notificationsRepository as any,
		incidentsRepository as any,
		monitorsRepository as any,
		noopProvider as any,
		emailProvider as any,
		noopProvider as any,
		noopProvider as any,
		noopProvider as any,
		noopProvider as any,
		noopProvider as any,
		noopProvider as any,
		settingsService as any,
		createMockLogger() as any,
		notificationMessageBuilder as any
	);

	return {
		service,
		notificationsRepository,
		incidentsRepository,
		emailProvider,
	};
};

describe("NotificationsService", () => {
	it("sends escalation notifications once an active incident passes the configured duration", async () => {
		const { service, incidentsRepository, emailProvider } = createService();
		const monitor = {
			id: "monitor-1",
			teamId: "team-1",
			name: "API",
			url: "https://example.com",
			type: "http",
			status: "down",
			notifications: ["n1"],
			escalationMinutes: 1,
			escalationNotifications: ["n2"],
		} as Monitor;
		const statusResponse = { status: false, code: 500, message: "Down" } as any;

		const result = await service.handleEscalationNotifications(monitor, statusResponse);

		expect(result).toBe(true);
		expect(emailProvider.sendMessage).toHaveBeenCalledTimes(1);
		expect(incidentsRepository.updateById).toHaveBeenCalledWith(
			"incident-1",
			"team-1",
			expect.objectContaining({ escalationNotifiedAt: expect.any(String) })
		);
	});

	it("does not resend escalation notifications when the incident was already escalated", async () => {
		const { service, incidentsRepository, emailProvider } = createService({
			activeIncident: {
				id: "incident-1",
				teamId: "team-1",
				monitorId: "monitor-1",
				startTime: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
				status: true,
				resolutionType: null,
				escalationNotifiedAt: new Date().toISOString(),
			},
		});
		const monitor = {
			id: "monitor-1",
			teamId: "team-1",
			name: "API",
			url: "https://example.com",
			type: "http",
			status: "down",
			notifications: ["n1"],
			escalationMinutes: 1,
			escalationNotifications: ["n2"],
		} as Monitor;

		const result = await service.handleEscalationNotifications(monitor, { status: false, code: 500, message: "Down" } as any);

		expect(result).toBe(false);
		expect(emailProvider.sendMessage).not.toHaveBeenCalled();
		expect(incidentsRepository.updateById).not.toHaveBeenCalled();
	});
});
