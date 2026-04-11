import { describe, it, beforeEach, expect, jest } from "@jest/globals";
import { NotificationsService } from "@/service/infrastructure/notificationsService.js";
import type { Monitor } from "@/types/index.js";

describe("Escalation Feature - Monitor Level", () => {
	let notificationsService: NotificationsService;
	let incidentsRepositoryStub: any;
	let emailProviderStub: any;
	let settingsServiceStub: any;
	let loggerStub: any;

	beforeEach(() => {
		incidentsRepositoryStub = {
			findActiveByMonitorId: jest.fn(),
		};

		emailProviderStub = {
			sendMessage: jest.fn().mockResolvedValue(true),
		};

		settingsServiceStub = {
			getSettings: jest.fn().mockReturnValue({
				clientHost: "http://localhost:5173",
			}),
		};

		loggerStub = {
			warn: jest.fn(),
			error: jest.fn(),
			info: jest.fn(),
			debug: jest.fn(),
		};

		notificationsService = new NotificationsService(
			{},
			{},
			incidentsRepositoryStub,
			{},
			emailProviderStub,
			{},
			{},
			{},
			{},
			{},
			settingsServiceStub,
			loggerStub,
			{}
		) as any;
	});

	describe("handleEscalations", () => {
		it("should return true when escalation is not enabled on monitor", async () => {
			const monitor: Partial<Monitor> = {
				id: "1",
				teamId: "1",
				name: "Test Monitor",
				type: "http",
				escalationEnabled: false,
			};

			const result = await notificationsService.handleEscalations(monitor as Monitor);
			expect(result).toBe(true);
			expect(emailProviderStub.sendMessage).not.toHaveBeenCalled();
		});

		it("should return true when escalation recipient is not set", async () => {
			const monitor: Partial<Monitor> = {
				id: "1",
				teamId: "1",
				name: "Test Monitor",
				type: "http",
				escalationEnabled: true,
				escalationRecipient: "",
			};

			const result = await notificationsService.handleEscalations(monitor as Monitor);
			expect(result).toBe(true);
			expect(emailProviderStub.sendMessage).not.toHaveBeenCalled();
		});

		it("should return true when no active incident exists", async () => {
			const monitor: Partial<Monitor> = {
				id: "1",
				teamId: "1",
				name: "Test Monitor",
				type: "http",
				escalationEnabled: true,
				escalationRecipient: "escalation@example.com",
			};

			incidentsRepositoryStub.findActiveByMonitorId.mockResolvedValue(null);

			const result = await notificationsService.handleEscalations(monitor as Monitor);
			expect(result).toBe(true);
			expect(emailProviderStub.sendMessage).not.toHaveBeenCalled();
		});

		it("should send escalation when incident duration exceeds threshold", async () => {
			const monitor: Partial<Monitor> = {
				id: "1",
				teamId: "1",
				name: "Test Monitor",
				type: "http",
				status: "down",
				escalationEnabled: true,
				escalationRecipient: "escalation@example.com",
				escalationThresholdMinutes: 60,
			};

			const activeIncident = {
				id: "incident1",
				startTime: new Date(Date.now() - 120 * 60 * 1000), // 120 minutes ago
				status: true,
			};

			incidentsRepositoryStub.findActiveByMonitorId.mockResolvedValue(activeIncident);

			const result = await notificationsService.handleEscalations(monitor as Monitor);
			expect(result).toBe(true);
			expect(emailProviderStub.sendMessage).toHaveBeenCalled();
		});

		it("should not send escalation if incident duration is below threshold", async () => {
			const monitor: Partial<Monitor> = {
				id: "1",
				teamId: "1",
				name: "Test Monitor",
				type: "http",
				status: "down",
				escalationEnabled: true,
				escalationRecipient: "escalation@example.com",
				escalationThresholdMinutes: 60,
			};

			const activeIncident = {
				id: "incident1",
				startTime: new Date(Date.now() - 30 * 60 * 1000), // 30 minutes ago
				status: true,
			};

			incidentsRepositoryStub.findActiveByMonitorId.mockResolvedValue(activeIncident);

			const result = await notificationsService.handleEscalations(monitor as Monitor);
			expect(result).toBe(true);
			expect(emailProviderStub.sendMessage).not.toHaveBeenCalled();
		});

		it("should respect custom escalation thresholds on monitor", async () => {
			const monitor: Partial<Monitor> = {
				id: "1",
				teamId: "1",
				name: "Test Monitor",
				type: "http",
				status: "down",
				escalationEnabled: true,
				escalationRecipient: "escalation@example.com",
				escalationThresholdMinutes: 20, // Custom threshold of 20 minutes
			};

			const activeIncident = {
				id: "incident1",
				startTime: new Date(Date.now() - 30 * 60 * 1000), // 30 minutes ago
				status: true,
			};

			incidentsRepositoryStub.findActiveByMonitorId.mockResolvedValue(activeIncident);

			await notificationsService.handleEscalations(monitor as Monitor);

			// Should send because 30 >= 20
			expect(emailProviderStub.sendMessage).toHaveBeenCalled();
		});

		it("should handle errors gracefully", async () => {
			const monitor: Partial<Monitor> = {
				id: "1",
				teamId: "1",
				name: "Test Monitor",
				type: "http",
				escalationEnabled: true,
				escalationRecipient: "escalation@example.com",
			};

			incidentsRepositoryStub.findActiveByMonitorId.mockRejectedValue(new Error("Database error"));

			const result = await notificationsService.handleEscalations(monitor as Monitor);
			expect(result).toBe(false);
			expect(loggerStub.error).toHaveBeenCalled();
		});
	});
});
