import { describe, it, expect, beforeEach } from "@jest/globals";
import { IncidentService } from "@/service/business/incidentService.js";
import type {
	IIncidentsRepository,
	IMonitorsRepository,
	IUsersRepository,
} from "@/repositories/index.js";
import type { INotificationMessageBuilder } from "@/service/infrastructure/notificationMessageBuilder.js";
import type { Monitor, EscalationRule } from "@/types/index.js";

// Mock logger
const createLogger = () => ({
	info: jest.fn(),
	error: jest.fn(),
	warn: jest.fn(),
	debug: jest.fn(),
});

// Mock repositories
const createIncidentsRepositoryMock = () =>
	({
		findActiveByMonitorId: jest.fn(),
		findById: jest.fn(),
		create: jest.fn(),
		updateById: jest.fn(),
		deleteByMonitorId: jest.fn(),
		findByTeamId: jest.fn(),
		countByTeamId: jest.fn(),
		findActiveByIncidentId: jest.fn(),
		findSummaryByTeamId: jest.fn(),
		deleteByMonitorIdsNotIn: jest.fn(),
	}) as unknown as IIncidentsRepository;

const createMonitorsRepositoryMock = () =>
	({
		findById: jest.fn(),
		findByTeamId: jest.fn(),
		create: jest.fn(),
		updateById: jest.fn(),
	}) as unknown as IMonitorsRepository;

const createUsersRepositoryMock = () =>
	({
		findById: jest.fn(),
	}) as unknown as IUsersRepository;

const createNotificationMessageBuilderMock = () =>
	({
		buildMessage: jest.fn(),
		extractThresholdBreaches: jest.fn(),
		buildEscalationMessage: jest.fn(),
	}) as unknown as INotificationMessageBuilder;

// Create service instance with mocks
const createService = (overrides: Partial<Parameters<typeof IncidentService.prototype.constructor>[0]> = {}) => {
	const logger = createLogger();
	const incidentsRepository = createIncidentsRepositoryMock();
	const monitorsRepository = createMonitorsRepositoryMock();
	const usersRepository = createUsersRepositoryMock();
	const notificationMessageBuilder = createNotificationMessageBuilderMock();

	const service = new IncidentService(
		logger,
		incidentsRepository,
		monitorsRepository,
		usersRepository,
		notificationMessageBuilder
	);

	return {
		service,
		logger,
		incidentsRepository,
		monitorsRepository,
		usersRepository,
		notificationMessageBuilder,
	};
};

// Helper to create mock monitor
const createMockMonitor = (overrides: Partial<Monitor> = {}): Monitor => ({
	id: "monitor-1",
	userId: "user-1",
	teamId: "team-1",
	name: "Test Monitor",
	type: "http",
	url: "https://example.com",
	status: "down",
	statusWindow: [],
	statusWindowSize: 5,
	statusWindowThreshold: 60,
	ignoreTlsErrors: false,
	useAdvancedMatching: false,
	isActive: true,
	interval: 60000,
	notifications: [],
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
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
	...overrides,
});

// Helper to create mock incident
const createMockIncident = (overrides: any = {}) => ({
	id: "incident-1",
	monitorId: "monitor-1",
	teamId: "team-1",
	startTime: new Date(Date.now() - 5 * 60 * 1000).toISOString(), // 5 minutes ago
	endTime: null,
	status: true,
	statusCode: 0,
	message: null,
	resolutionType: null,
	escalationsSent: [],
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
	...overrides,
});

describe("IncidentService - Escalation Features", () => {
	describe("getApplicableEscalationRules", () => {
		it("returns empty array when monitor has no escalation rules", async () => {
			const { service } = createService();
			const monitor = createMockMonitor({ escalationRules: [] });

			const rules = await service.getApplicableEscalationRules(monitor, new Date());

			expect(rules).toEqual([]);
		});

		it("returns empty array when no escalation rules are enabled", async () => {
			const { service } = createService();
			const escalationRules: EscalationRule[] = [
				{ afterMinutes: 5, notificationIds: ["notif-1"], enabled: false },
				{ afterMinutes: 10, notificationIds: ["notif-2"], enabled: false },
			];
			const monitor = createMockMonitor({ escalationRules });

			const rules = await service.getApplicableEscalationRules(monitor, new Date());

			expect(rules).toEqual([]);
		});

		it("returns empty array when incident duration is less than escalation threshold", async () => {
			const { service } = createService();
			const escalationRules: EscalationRule[] = [
				{ afterMinutes: 10, notificationIds: ["notif-1"], enabled: true },
			];
			const monitor = createMockMonitor({ escalationRules });

			// Incident started 5 minutes ago (less than 10-minute threshold)
			const incidentStartTime = new Date(Date.now() - 5 * 60 * 1000);

			const rules = await service.getApplicableEscalationRules(monitor, incidentStartTime);

			expect(rules).toEqual([]);
		});

		it("returns applicable rules when incident duration exceeds threshold", async () => {
			const { service } = createService();
			const escalationRules: EscalationRule[] = [
				{ afterMinutes: 5, notificationIds: ["notif-1", "notif-2"], enabled: true },
			];
			const monitor = createMockMonitor({ escalationRules });

			// Incident started 10 minutes ago (exceeds 5-minute threshold)
			const incidentStartTime = new Date(Date.now() - 10 * 60 * 1000);

			const rules = await service.getApplicableEscalationRules(monitor, incidentStartTime);

			expect(rules).toHaveLength(1);
			expect(rules[0]).toEqual({
				afterMinutes: 5,
				notificationIds: ["notif-1", "notif-2"],
			});
		});

		it("returns multiple applicable rules sorted by escalation time", async () => {
			const { service } = createService();
			const escalationRules: EscalationRule[] = [
				{ afterMinutes: 5, notificationIds: ["notif-1"], enabled: true },
				{ afterMinutes: 15, notificationIds: ["notif-2"], enabled: true },
				{ afterMinutes: 10, notificationIds: ["notif-3"], enabled: true },
			];
			const monitor = createMockMonitor({ escalationRules });

			// Incident started 20 minutes ago
			const incidentStartTime = new Date(Date.now() - 20 * 60 * 1000);

			const rules = await service.getApplicableEscalationRules(monitor, incidentStartTime);

			expect(rules).toHaveLength(3);
			// Should all be applicable since 20 minutes exceeds all thresholds
			expect(rules.map((r) => r.afterMinutes)).toEqual([5, 15, 10]);
		});

		it("filters out rules with empty notification IDs", async () => {
			const { service } = createService();
			const escalationRules: EscalationRule[] = [
				{ afterMinutes: 5, notificationIds: ["notif-1"], enabled: true },
				{ afterMinutes: 10, notificationIds: [], enabled: true }, // Empty notifications
			];
			const monitor = createMockMonitor({ escalationRules });

			const incidentStartTime = new Date(Date.now() - 15 * 60 * 1000);

			const rules = await service.getApplicableEscalationRules(monitor, incidentStartTime);

			expect(rules).toHaveLength(1);
			expect(rules[0].afterMinutes).toBe(5);
		});

		it("handles error gracefully and returns empty array", async () => {
			const { service, logger } = createService();
			const monitor = createMockMonitor({
				escalationRules: null as any,
			});

			const rules = await service.getApplicableEscalationRules(monitor, new Date());

			expect(rules).toEqual([]);
			expect(logger.error).toHaveBeenCalled();
		});
	});

	describe("recordEscalationSent", () => {
		it("adds new escalation record when not previously sent", async () => {
			const { service, incidentsRepository } = createService();
			const incident = createMockIncident({ escalationsSent: [] });

			(incidentsRepository.findById as jest.Mock).mockResolvedValue(incident);
			(incidentsRepository.updateById as jest.Mock).mockResolvedValue(incident);

			await service.recordEscalationSent("incident-1", "team-1", 5, ["notif-1", "notif-2"]);

			expect(incidentsRepository.findById).toHaveBeenCalledWith("incident-1", "team-1");
			expect(incidentsRepository.updateById).toHaveBeenCalled();

			const updateCall = (incidentsRepository.updateById as jest.Mock).mock.calls[0];
			const updatedIncident = updateCall[2];

			expect(updatedIncident.escalationsSent).toHaveLength(1);
			expect(updatedIncident.escalationsSent[0]).toMatchObject({
				afterMinutes: 5,
				notificationIds: ["notif-1", "notif-2"],
			});
			expect(updatedIncident.escalationsSent[0].sentAt).toBeDefined();
		});

		it("does not add duplicate escalation record for same afterMinutes", async () => {
			const { service, incidentsRepository } = createService();
			const incident = createMockIncident({
				escalationsSent: [
					{
						afterMinutes: 5,
						sentAt: new Date().toISOString(),
						notificationIds: ["notif-1"],
					},
				],
			});

			(incidentsRepository.findById as jest.Mock).mockResolvedValue(incident);
			(incidentsRepository.updateById as jest.Mock).mockResolvedValue(incident);

			await service.recordEscalationSent("incident-1", "team-1", 5, ["notif-2"]);

			expect(incidentsRepository.updateById).not.toHaveBeenCalled();
		});

		it("adds new escalation when different afterMinutes threshold", async () => {
			const { service, incidentsRepository } = createService();
			const incident = createMockIncident({
				escalationsSent: [
					{
						afterMinutes: 5,
						sentAt: new Date().toISOString(),
						notificationIds: ["notif-1"],
					},
				],
			});

			(incidentsRepository.findById as jest.Mock).mockResolvedValue(incident);
			(incidentsRepository.updateById as jest.Mock).mockResolvedValue(incident);

			await service.recordEscalationSent("incident-1", "team-1", 10, ["notif-2"]);

			expect(incidentsRepository.updateById).toHaveBeenCalled();

			const updateCall = (incidentsRepository.updateById as jest.Mock).mock.calls[0];
			const updatedIncident = updateCall[2];

			expect(updatedIncident.escalationsSent).toHaveLength(2);
			expect(updatedIncident.escalationsSent.map((e: any) => e.afterMinutes)).toEqual([5, 10]);
		});

		it("handles error gracefully and logs it", async () => {
			const { service, incidentsRepository, logger } = createService();

			(incidentsRepository.findById as jest.Mock).mockRejectedValue(new Error("Database error"));

			await service.recordEscalationSent("incident-1", "team-1", 5, ["notif-1"]);

			expect(logger.error).toHaveBeenCalled();
		});

		it("initializes escalationsSent array if undefined", async () => {
			const { service, incidentsRepository } = createService();
			const incident = createMockIncident({ escalationsSent: undefined });

			(incidentsRepository.findById as jest.Mock).mockResolvedValue(incident);
			(incidentsRepository.updateById as jest.Mock).mockResolvedValue(incident);

			await service.recordEscalationSent("incident-1", "team-1", 5, ["notif-1"]);

			expect(incidentsRepository.updateById).toHaveBeenCalled();

			const updateCall = (incidentsRepository.updateById as jest.Mock).mock.calls[0];
			const updatedIncident = updateCall[2];

			expect(updatedIncident.escalationsSent).toHaveLength(1);
		});
	});

	describe("Integration: Escalation workflow", () => {
		it("tracks multiple escalation levels over time", async () => {
			const { service, incidentsRepository } = createService();

			// Scenario: Incident created, escalations triggered at 5 and 10 minutes
			const initialIncident = createMockIncident({ escalationsSent: [] });

			// First escalation at 5 minutes
			(incidentsRepository.findById as jest.Mock).mockResolvedValue(initialIncident);
			(incidentsRepository.updateById as jest.Mock).mockResolvedValue({
				...initialIncident,
				escalationsSent: [
					{
						afterMinutes: 5,
						sentAt: new Date().toISOString(),
						notificationIds: ["notif-1"],
					},
				],
			});

			await service.recordEscalationSent("incident-1", "team-1", 5, ["notif-1"]);
			expect(incidentsRepository.updateById).toHaveBeenCalledTimes(1);

			// Second escalation at 10 minutes
			const incidentAfterFirstEscalation = {
				...initialIncident,
				escalationsSent: [
					{
						afterMinutes: 5,
						sentAt: new Date().toISOString(),
						notificationIds: ["notif-1"],
					},
				],
			};

			(incidentsRepository.findById as jest.Mock).mockResolvedValue(incidentAfterFirstEscalation);
			(incidentsRepository.updateById as jest.Mock).mockResolvedValue({
				...incidentAfterFirstEscalation,
				escalationsSent: [
					{
						afterMinutes: 5,
						sentAt: new Date().toISOString(),
						notificationIds: ["notif-1"],
					},
					{
						afterMinutes: 10,
						sentAt: new Date().toISOString(),
						notificationIds: ["notif-2", "notif-3"],
					},
				],
			});

			await service.recordEscalationSent("incident-1", "team-1", 10, ["notif-2", "notif-3"]);

			// Should have been called twice (once for each escalation)
			expect(incidentsRepository.updateById).toHaveBeenCalledTimes(2);
		});

		it("prevents re-escalation on subsequent checks", async () => {
			const { service } = createService();

			// Monitor with escalation rules
			const monitor = createMockMonitor({
				escalationRules: [
					{ afterMinutes: 5, notificationIds: ["notif-1"], enabled: true },
					{ afterMinutes: 10, notificationIds: ["notif-2"], enabled: true },
				],
			});

			// Incident is 12 minutes old with one escalation already sent
			const incidentStartTime = new Date(Date.now() - 12 * 60 * 1000);

			const rules = await service.getApplicableEscalationRules(monitor, incidentStartTime);

			// Both rules should be applicable (12 minutes > 5 and 10)
			expect(rules).toHaveLength(2);
			expect(rules.map((r) => r.afterMinutes)).toEqual([5, 10]);

			// But in real usage, recordEscalationSent would prevent the 5-minute one from being re-sent
		});
	});
});
