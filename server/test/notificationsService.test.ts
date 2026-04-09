import { describe, expect, it, jest } from "@jest/globals";
import { NotificationsService } from "../src/service/infrastructure/notificationsService.ts";
import type { Monitor, Notification } from "../src/types/index.js";
import type { NotificationMessage } from "../src/types/notificationMessage.js";
import type { MonitorActionDecision } from "../src/service/infrastructure/SuperSimpleQueue/SuperSimpleQueueHelper.ts";

describe("NotificationsService", () => {
	const createService = () => {
		const notificationsRepository = {
			findById: jest.fn(),
			findNotificationsByIds: jest.fn(),
			create: jest.fn(),
			findByTeamId: jest.fn(),
			updateById: jest.fn(),
			deleteById: jest.fn(),
		};
		const monitorsRepository = {
			removeNotificationFromMonitors: jest.fn(),
		};
		const providerMock = { sendMessage: jest.fn(), sendTestAlert: jest.fn() };
		const settingsService = { getSettings: jest.fn().mockReturnValue({ clientHost: "http://localhost" }) };
		const notificationMessageBuilder = { buildMessage: jest.fn().mockReturnValue({} as NotificationMessage) };
		const logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() };

		const service = new NotificationsService(
			notificationsRepository as any,
			monitorsRepository as any,
			providerMock as any,
			providerMock as any,
			providerMock as any,
			providerMock as any,
			providerMock as any,
			providerMock as any,
			providerMock as any,
			settingsService as any,
			logger as any,
			notificationMessageBuilder as any
		);

		return { service, notificationsRepository, emailProvider: providerMock };
	};

	it("returns false when escalation is not requested", async () => {
		const { service, notificationsRepository } = createService();
		const monitor = { id: "m1", teamId: "team" } as Monitor;
		const decision: MonitorActionDecision = {
			shouldCreateIncident: false,
			shouldResolveIncident: false,
			shouldSendNotification: false,
			shouldSendEscalation: false,
			incidentReason: null,
			notificationReason: null,
		};

		const result = await service.handleEscalation(monitor, decision);
		expect(result).toBe(false);
		expect(notificationsRepository.findById).not.toHaveBeenCalled();
	});

	it("sends escalation email when configured notification IDs exist", async () => {
		const { service, notificationsRepository, emailProvider } = createService();
		const monitor = {
			id: "m1",
			teamId: "team",
			name: "Test Monitor",
			type: "http",
			status: "down",
			url: "http://example.com",
		} as Monitor;
		const decision: MonitorActionDecision = {
			shouldCreateIncident: false,
			shouldResolveIncident: false,
			shouldSendNotification: false,
			shouldSendEscalation: true,
			escalationNotificationIds: ["n1"],
			incidentReason: null,
			notificationReason: "escalation",
		};

		notificationsRepository.findById.mockResolvedValue({
			id: "n1",
			userId: "u1",
			teamId: "team",
			type: "email",
			notificationName: "Escalation Email",
			address: "escalation@example.com",
			createdAt: "2026-04-08T00:00:00.000Z",
			updatedAt: "2026-04-08T00:00:00.000Z",
		} as Notification);
		(emailProvider.sendMessage as jest.Mock).mockResolvedValue(true);
		const result = await service.handleEscalation(monitor, decision);

		expect(result).toBe(true);
		expect(notificationsRepository.findById).toHaveBeenCalledWith("n1", "team");
		expect(emailProvider.sendMessage).toHaveBeenCalled();
	});
});
