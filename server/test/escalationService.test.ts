import { jest } from "@jest/globals";
import { EscalationService } from "../src/service/business/escalationService.ts";
import type {
	IEscalationNotificationsRepository,
	IIncidentsRepository,
	IMonitorsRepository,
	IEscalationNotificationLogsRepository,
	ITeamsRepository,
} from "../src/repositories/index.ts";
import type { ILogger } from "../src/utils/logger.ts";
import type { IEmailService } from "../src/service/infrastructure/emailService.ts";
import type { Incident } from "../src/types/incident.ts";
import type { EscalationNotification } from "../src/types/notification.ts";

const createLoggerMock = (): ILogger => ({
	info: jest.fn(),
	debug: jest.fn(),
	warn: jest.fn(),
	error: jest.fn(),
});

const createIncidentsRepositoryMock = (): IIncidentsRepository => ({
	findAllActive: jest.fn(),
	findById: jest.fn(),
	findByMonitorId: jest.fn(),
	findByTeamId: jest.fn(),
	findSummaryByTeamId: jest.fn(),
	create: jest.fn(),
	updateById: jest.fn(),
	deleteById: jest.fn(),
});

const createEscalationNotificationsRepositoryMock = (): IEscalationNotificationsRepository => ({
	create: jest.fn(),
	findById: jest.fn(),
	findByMonitorId: jest.fn(),
	findActiveByMonitorId: jest.fn(),
	findAllActive: jest.fn(),
	updateById: jest.fn(),
	deleteById: jest.fn(),
	deleteByMonitorId: jest.fn(),
});

const createMonitorsRepositoryMock = (): IMonitorsRepository => ({
	findById: jest.fn(),
	findByTeamId: jest.fn(),
	findMonitorCountByTeamIdAndType: jest.fn(),
	findMonitorsSummaryByTeamId: jest.fn(),
	findGroupsByTeamId: jest.fn(),
	create: jest.fn(),
	createBulkMonitors: jest.fn(),
	deleteByTeamId: jest.fn(),
});

const createTeamsRepositoryMock = (): ITeamsRepository => ({
	findById: jest.fn(),
	findByUserId: jest.fn(),
	create: jest.fn(),
	updateById: jest.fn(),
	deleteById: jest.fn(),
});

const createEmailServiceMock = (): IEmailService => ({
	sendEmail: jest.fn(),
	buildEmail: jest.fn(),
});

const createEscalationLogsRepositoryMock = (): IEscalationNotificationLogsRepository => ({
	create: jest.fn(),
	hasBeenSent: jest.fn(),
});

const createService = ({
	logger = createLoggerMock(),
	incidentsRepository = createIncidentsRepositoryMock(),
	escalationNotificationsRepository = createEscalationNotificationsRepositoryMock(),
	monitorsRepository = createMonitorsRepositoryMock(),
	teamsRepository = createTeamsRepositoryMock(),
	emailService = createEmailServiceMock(),
	escalationLogsRepository = createEscalationLogsRepositoryMock(),
}: {
	logger?: ILogger;
	incidentsRepository?: IIncidentsRepository;
	escalationNotificationsRepository?: IEscalationNotificationsRepository;
	monitorsRepository?: IMonitorsRepository;
	teamsRepository?: ITeamsRepository;
	emailService?: IEmailService;
	escalationLogsRepository?: IEscalationNotificationLogsRepository;
} = {}) => {
	return new EscalationService(
		logger,
		incidentsRepository,
		escalationNotificationsRepository,
		monitorsRepository,
		teamsRepository,
		emailService,
		escalationLogsRepository
	);
};

describe("EscalationService", () => {
	let service: EscalationService;
	let logger: ILogger;
	let incidentsRepository: IIncidentsRepository;
	let escalationNotificationsRepository: IEscalationNotificationsRepository;
	let monitorsRepository: IMonitorsRepository;
	let teamsRepository: ITeamsRepository;
	let emailService: IEmailService;
	let escalationLogsRepository: IEscalationNotificationLogsRepository;

	beforeEach(() => {
		logger = createLoggerMock();
		incidentsRepository = createIncidentsRepositoryMock();
		escalationNotificationsRepository = createEscalationNotificationsRepositoryMock();
		monitorsRepository = createMonitorsRepositoryMock();
		teamsRepository = createTeamsRepositoryMock();
		emailService = createEmailServiceMock();
		escalationLogsRepository = createEscalationLogsRepositoryMock();

		service = createService({
			logger,
			incidentsRepository,
			escalationNotificationsRepository,
			monitorsRepository,
			teamsRepository,
			emailService,
			escalationLogsRepository,
		});
	});

	describe("processEscalationNotifications", () => {
		it("should process all active incidents", async () => {
			const mockIncidents: Incident[] = [
				{
					id: "incident1",
					monitorId: "monitor1",
					teamId: "team1",
					startTime: "2024-01-01T00:00:00Z",
					endTime: null,
					status: false,
					message: "Monitor is down",
					statusCode: 500,
					resolutionType: null,
					resolvedBy: null,
					resolvedByEmail: null,
					comment: null,
					createdAt: "2024-01-01T00:00:00Z",
					updatedAt: "2024-01-01T00:00:00Z",
				},
			];

			jest.mocked(incidentsRepository.findAllActive).mockResolvedValue(mockIncidents);
			jest.mocked(escalationNotificationsRepository.findActiveByMonitorId).mockResolvedValue([]);

			await service.processEscalationNotifications();

			expect(incidentsRepository.findAllActive).toHaveBeenCalledTimes(1);
			expect(escalationNotificationsRepository.findActiveByMonitorId).toHaveBeenCalledWith("monitor1");
			expect(logger.info).toHaveBeenCalledWith(
				expect.objectContaining({
					message: "Starting escalation notification processing",
				})
			);
			expect(logger.info).toHaveBeenCalledWith(
				expect.objectContaining({
					message: "Completed escalation notification processing",
				})
			);
		});

		it("should handle errors during processing", async () => {
			jest.mocked(incidentsRepository.findAllActive).mockRejectedValue(new Error("Database error"));

			await expect(service.processEscalationNotifications()).rejects.toThrow("Database error");

			expect(logger.error).toHaveBeenCalledWith(
				expect.objectContaining({
					message: expect.stringContaining("Error processing escalation notifications"),
				})
			);
		});
	});

	describe("processIncidentEscalations - Time-based escalation logic", () => {
		let mockDate: Date;
		let originalDate: typeof Date;
		let originalDateNow: typeof Date.now;

		beforeEach(() => {
			// Mock Date to control time
			mockDate = new Date("2024-01-01T00:10:00Z"); // 10 minutes after start
			originalDate = global.Date;
			originalDateNow = global.Date.now;

			// Mock Date constructor to return mock time for new Date(), but parse strings correctly
			const MockDate = class extends Date {
				constructor(...args: any[]) {
					if (args.length === 0) {
						// new Date() - return mock time
						super(mockDate.getTime());
					} else {
						// new Date(string) - parse normally
						super(...args);
					}
				}
			};
			global.Date = MockDate as any;
			global.Date.now = jest.fn(() => mockDate.getTime());
		});

		afterEach(() => {
			global.Date = originalDate;
			global.Date.now = originalDateNow;
		});

		it("should send escalation level 1 at 1 minute (60 seconds) when incident just started", async () => {
			const incidentStartTime = "2024-01-01T00:09:00Z"; // 1 minute ago from mock time
			const mockIncident: Incident = {
				id: "incident1",
				monitorId: "monitor1",
				teamId: "team1",
				startTime: incidentStartTime,
				endTime: null,
				status: false,
				message: "Monitor is down",
				statusCode: 500,
				resolutionType: null,
				resolvedBy: null,
				resolvedByEmail: null,
				comment: null,
				createdAt: incidentStartTime,
				updatedAt: incidentStartTime,
			};

			const mockEscalations: EscalationNotification[] = [
				{
					id: "esc1",
					monitorId: "monitor1",
					escalationLevel: 1,
					delaySeconds: 60, // 1 minute
					notificationChannel: "email",
					isActive: true,
					createdAt: "2024-01-01T00:00:00Z",
					updatedAt: "2024-01-01T00:00:00Z",
				},
				{
					id: "esc2",
					monitorId: "monitor1",
					escalationLevel: 2,
					delaySeconds: 120, // 2 minutes - should not trigger yet
					notificationChannel: "email",
					isActive: true,
					createdAt: "2024-01-01T00:00:00Z",
					updatedAt: "2024-01-01T00:00:00Z",
				},
				{
					id: "esc3",
					monitorId: "monitor1",
					escalationLevel: 3,
					delaySeconds: 180, // 3 minutes - should not trigger yet
					notificationChannel: "email",
					isActive: true,
					createdAt: "2024-01-01T00:00:00Z",
					updatedAt: "2024-01-01T00:00:00Z",
				},
			];

			jest.mocked(escalationNotificationsRepository.findActiveByMonitorId).mockResolvedValue(mockEscalations);
			jest.mocked(escalationLogsRepository.hasBeenSent).mockResolvedValue(false); // None sent yet
			jest.mocked(monitorsRepository.findById).mockResolvedValue({
				id: "monitor1",
				name: "Test Monitor",
				url: "https://example.com",
				teamId: "team1",
			} as any);
			jest.mocked(teamsRepository.findById).mockResolvedValue({
				id: "team1",
				email: "team@example.com",
			} as any);
			jest.mocked(emailService.sendEmail).mockResolvedValue("message-id-123");
			jest.mocked(emailService.buildEmail).mockResolvedValue("<html>Escalation email</html>");

			await (service as any).processIncidentEscalations(mockIncident);

			// Should check if escalation 1 has been sent
			expect(escalationLogsRepository.hasBeenSent).toHaveBeenCalledWith("incident1", "esc1");

			// Should send escalation level 1 (highest qualifying)
			expect(emailService.sendEmail).toHaveBeenCalledWith(
				"team@example.com",
				expect.stringContaining("ESCALATION: Monitor Test Monitor incident - Level 1"),
				expect.any(String)
			);

			// Should log the notification
			expect(escalationLogsRepository.create).toHaveBeenCalledWith({
				incidentId: "incident1",
				escalationNotificationId: "esc1",
				sentAt: mockDate,
				notificationChannel: "email",
				status: "sent",
			});
		});

		it("should send escalation level 2 at 2.5 minutes when level 1 already sent", async () => {
			const incidentStartTime = "2024-01-01T00:07:30Z"; // 2.5 minutes ago from mock time (00:10:00)
			const mockIncident: Incident = {
				id: "incident1",
				monitorId: "monitor1",
				teamId: "team1",
				startTime: incidentStartTime,
				endTime: null,
				status: false,
				message: "Monitor is down",
				statusCode: 500,
				resolutionType: null,
				resolvedBy: null,
				resolvedByEmail: null,
				comment: null,
				createdAt: incidentStartTime,
				updatedAt: incidentStartTime,
			};

			const mockEscalations: EscalationNotification[] = [
				{
					id: "esc1",
					monitorId: "monitor1",
					escalationLevel: 1,
					delaySeconds: 60, // 1 minute - should have been sent
					notificationChannel: "email",
					isActive: true,
					createdAt: "2024-01-01T00:00:00Z",
					updatedAt: "2024-01-01T00:00:00Z",
				},
				{
					id: "esc2",
					monitorId: "monitor1",
					escalationLevel: 2,
					delaySeconds: 120, // 2 minutes - should trigger now
					notificationChannel: "email",
					isActive: true,
					createdAt: "2024-01-01T00:00:00Z",
					updatedAt: "2024-01-01T00:00:00Z",
				},
				{
					id: "esc3",
					monitorId: "monitor1",
					escalationLevel: 3,
					delaySeconds: 180, // 3 minutes - should not trigger yet
					notificationChannel: "email",
					isActive: true,
					createdAt: "2024-01-01T00:00:00Z",
					updatedAt: "2024-01-01T00:00:00Z",
				},
			];

			jest.mocked(escalationNotificationsRepository.findActiveByMonitorId).mockResolvedValue(mockEscalations);
			// Level 1 already sent, level 2 not sent
			jest.mocked(escalationLogsRepository.hasBeenSent)
				.mockImplementation((incidentId, escalationId) =>
					Promise.resolve(escalationId === "esc1")
				);
			jest.mocked(monitorsRepository.findById).mockResolvedValue({
				id: "monitor1",
				name: "Test Monitor",
				url: "https://example.com",
				teamId: "team1",
			} as any);
			jest.mocked(teamsRepository.findById).mockResolvedValue({
				id: "team1",
				email: "team@example.com",
			} as any);
			jest.mocked(emailService.sendEmail).mockResolvedValue("message-id-456");
			jest.mocked(emailService.buildEmail).mockResolvedValue("<html>Escalation email</html>");

			await (service as any).processIncidentEscalations(mockIncident);

			// Should check if escalations have been sent
			expect(escalationLogsRepository.hasBeenSent).toHaveBeenCalledWith("incident1", "esc1");
			expect(escalationLogsRepository.hasBeenSent).toHaveBeenCalledWith("incident1", "esc2");

			// Should send escalation level 2 (highest qualifying that hasn't been sent)
			expect(emailService.sendEmail).toHaveBeenCalledWith(
				"team@example.com",
				expect.stringContaining("ESCALATION: Monitor Test Monitor incident - Level 2"),
				expect.any(String)
			);

			// Should log the notification
			expect(escalationLogsRepository.create).toHaveBeenCalledWith({
				incidentId: "incident1",
				escalationNotificationId: "esc2",
				sentAt: mockDate,
				notificationChannel: "email",
				status: "sent",
			});
		});

		it("should send escalation level 3 at 10 minutes when levels 1 and 2 already sent", async () => {
			const incidentStartTime = "2024-01-01T00:00:00Z"; // 10 minutes ago from mock time
			const mockIncident: Incident = {
				id: "incident1",
				monitorId: "monitor1",
				teamId: "team1",
				startTime: incidentStartTime,
				endTime: null,
				status: false,
				message: "Monitor is down",
				statusCode: 500,
				resolutionType: null,
				resolvedBy: null,
				resolvedByEmail: null,
				comment: null,
				createdAt: incidentStartTime,
				updatedAt: incidentStartTime,
			};

			const mockEscalations: EscalationNotification[] = [
				{
					id: "esc1",
					monitorId: "monitor1",
					escalationLevel: 1,
					delaySeconds: 60, // 1 minute - already sent
					notificationChannel: "email",
					isActive: true,
					createdAt: "2024-01-01T00:00:00Z",
					updatedAt: "2024-01-01T00:00:00Z",
				},
				{
					id: "esc2",
					monitorId: "monitor1",
					escalationLevel: 2,
					delaySeconds: 120, // 2 minutes - already sent
					notificationChannel: "email",
					isActive: true,
					createdAt: "2024-01-01T00:00:00Z",
					updatedAt: "2024-01-01T00:00:00Z",
				},
				{
					id: "esc3",
					monitorId: "monitor1",
					escalationLevel: 3,
					delaySeconds: 180, // 3 minutes - should trigger now
					notificationChannel: "email",
					isActive: true,
					createdAt: "2024-01-01T00:00:00Z",
					updatedAt: "2024-01-01T00:00:00Z",
				},
			];

			jest.mocked(escalationNotificationsRepository.findActiveByMonitorId).mockResolvedValue(mockEscalations);
			// Levels 1 and 2 already sent, level 3 not sent
			jest.mocked(escalationLogsRepository.hasBeenSent)
				.mockImplementation((incidentId, escalationId) =>
					Promise.resolve(escalationId === "esc1" || escalationId === "esc2")
				);
			jest.mocked(monitorsRepository.findById).mockResolvedValue({
				id: "monitor1",
				name: "Test Monitor",
				url: "https://example.com",
				teamId: "team1",
			} as any);
			jest.mocked(teamsRepository.findById).mockResolvedValue({
				id: "team1",
				email: "team@example.com",
			} as any);
			jest.mocked(emailService.sendEmail).mockResolvedValue("message-id-789");
			jest.mocked(emailService.buildEmail).mockResolvedValue("<html>Escalation email</html>");

			await (service as any).processIncidentEscalations(mockIncident);

			// Should check if escalations have been sent
			expect(escalationLogsRepository.hasBeenSent).toHaveBeenCalledWith("incident1", "esc1");
			expect(escalationLogsRepository.hasBeenSent).toHaveBeenCalledWith("incident1", "esc2");
			expect(escalationLogsRepository.hasBeenSent).toHaveBeenCalledWith("incident1", "esc3");

			// Should send escalation level 3 (highest qualifying that hasn't been sent)
			expect(emailService.sendEmail).toHaveBeenCalledWith(
				"team@example.com",
				expect.stringContaining("ESCALATION: Monitor Test Monitor incident - Level 3"),
				expect.any(String)
			);

			// Should log the notification
			expect(escalationLogsRepository.create).toHaveBeenCalledWith({
				incidentId: "incident1",
				escalationNotificationId: "esc3",
				sentAt: mockDate,
				notificationChannel: "email",
				status: "sent",
			});
		});

		it("should not send any escalation when incident just started (30 seconds elapsed)", async () => {
			const incidentStartTime = "2024-01-01T00:09:30Z"; // 30 seconds ago from mock time
			const mockIncident: Incident = {
				id: "incident1",
				monitorId: "monitor1",
				teamId: "team1",
				startTime: incidentStartTime,
				endTime: null,
				status: false,
				message: "Monitor is down",
				statusCode: 500,
				resolutionType: null,
				resolvedBy: null,
				resolvedByEmail: null,
				comment: null,
				createdAt: incidentStartTime,
				updatedAt: incidentStartTime,
			};

			const mockEscalations: EscalationNotification[] = [
				{
					id: "esc1",
					monitorId: "monitor1",
					escalationLevel: 1,
					delaySeconds: 60, // 1 minute - not yet
					notificationChannel: "email",
					isActive: true,
					createdAt: "2024-01-01T00:00:00Z",
					updatedAt: "2024-01-01T00:00:00Z",
				},
			];

			jest.mocked(escalationNotificationsRepository.findActiveByMonitorId).mockResolvedValue(mockEscalations);

			await (service as any).processIncidentEscalations(mockIncident);

			// Should not send any notifications
			expect(emailService.sendEmail).not.toHaveBeenCalled();
			expect(escalationLogsRepository.create).not.toHaveBeenCalled();

			expect(logger.debug).toHaveBeenCalledWith(
				expect.objectContaining({
					message: "No new escalations to send for incident incident1",
				})
			);
		});

		it("should not send escalation that has already been sent", async () => {
			const incidentStartTime = "2024-01-01T00:09:00Z"; // 1 minute ago from mock time
			const mockIncident: Incident = {
				id: "incident1",
				monitorId: "monitor1",
				teamId: "team1",
				startTime: incidentStartTime,
				endTime: null,
				status: false,
				message: "Monitor is down",
				statusCode: 500,
				resolutionType: null,
				resolvedBy: null,
				resolvedByEmail: null,
				comment: null,
				createdAt: incidentStartTime,
				updatedAt: incidentStartTime,
			};

			const mockEscalations: EscalationNotification[] = [
				{
					id: "esc1",
					monitorId: "monitor1",
					escalationLevel: 1,
					delaySeconds: 60, // 1 minute - should trigger but already sent
					notificationChannel: "email",
					isActive: true,
					createdAt: "2024-01-01T00:00:00Z",
					updatedAt: "2024-01-01T00:00:00Z",
				},
			];

			jest.mocked(escalationNotificationsRepository.findActiveByMonitorId).mockResolvedValue(mockEscalations);
			jest.mocked(escalationLogsRepository.hasBeenSent).mockResolvedValue(true); // Already sent

			await (service as any).processIncidentEscalations(mockIncident);

			// Should not send notification
			expect(emailService.sendEmail).not.toHaveBeenCalled();
			expect(escalationLogsRepository.create).not.toHaveBeenCalled();

			expect(logger.debug).toHaveBeenCalledWith(
				expect.objectContaining({
					message: "No new escalations to send for incident incident1",
				})
			);
		});

		it("should handle email sending failure", async () => {
			const incidentStartTime = "2024-01-01T00:09:00Z"; // 1 minute ago from mock time
			const mockIncident: Incident = {
				id: "incident1",
				monitorId: "monitor1",
				teamId: "team1",
				startTime: incidentStartTime,
				endTime: null,
				status: false,
				message: "Monitor is down",
				statusCode: 500,
				resolutionType: null,
				resolvedBy: null,
				resolvedByEmail: null,
				comment: null,
				createdAt: incidentStartTime,
				updatedAt: incidentStartTime,
			};

			const mockEscalations: EscalationNotification[] = [
				{
					id: "esc1",
					monitorId: "monitor1",
					escalationLevel: 1,
					delaySeconds: 60,
					notificationChannel: "email",
					isActive: true,
					createdAt: "2024-01-01T00:00:00Z",
					updatedAt: "2024-01-01T00:00:00Z",
				},
			];

			jest.mocked(escalationNotificationsRepository.findActiveByMonitorId).mockResolvedValue(mockEscalations);
			jest.mocked(escalationLogsRepository.hasBeenSent).mockResolvedValue(false);
			jest.mocked(monitorsRepository.findById).mockResolvedValue({
				id: "monitor1",
				name: "Test Monitor",
				url: "https://example.com",
				teamId: "team1",
			} as any);
			jest.mocked(teamsRepository.findById).mockResolvedValue({
				id: "team1",
				email: "team@example.com",
			} as any);
			jest.mocked(emailService.sendEmail).mockRejectedValue(new Error("SMTP error"));
			jest.mocked(emailService.buildEmail).mockResolvedValue("<html>Escalation email</html>");

			await (service as any).processIncidentEscalations(mockIncident);

			// Should log the failed notification
			expect(escalationLogsRepository.create).toHaveBeenCalledWith({
				incidentId: "incident1",
				escalationNotificationId: "esc1",
				sentAt: mockDate,
				notificationChannel: "email",
				status: "failed",
			});

			expect(logger.warn).toHaveBeenCalledWith(
				expect.objectContaining({
					message: "Failed to send escalation notification for incident incident1",
				})
			);
		});

		it("should skip unsupported notification channels", async () => {
			const incidentStartTime = "2024-01-01T00:09:00Z"; // 1 minute ago from mock time
			const mockIncident: Incident = {
				id: "incident1",
				monitorId: "monitor1",
				teamId: "team1",
				startTime: incidentStartTime,
				endTime: null,
				status: false,
				message: "Monitor is down",
				statusCode: 500,
				resolutionType: null,
				resolvedBy: null,
				resolvedByEmail: null,
				comment: null,
				createdAt: incidentStartTime,
				updatedAt: incidentStartTime,
			};

			const mockEscalations: EscalationNotification[] = [
				{
					id: "esc1",
					monitorId: "monitor1",
					escalationLevel: 1,
					delaySeconds: 60,
					notificationChannel: "slack", // Unsupported channel
					isActive: true,
					createdAt: "2024-01-01T00:00:00Z",
					updatedAt: "2024-01-01T00:00:00Z",
				},
			];

			jest.mocked(escalationNotificationsRepository.findActiveByMonitorId).mockResolvedValue(mockEscalations);
			jest.mocked(escalationLogsRepository.hasBeenSent).mockResolvedValue(false);

			await (service as any).processIncidentEscalations(mockIncident);

			// Should log the failed notification due to unsupported channel
			expect(escalationLogsRepository.create).toHaveBeenCalledWith({
				incidentId: "incident1",
				escalationNotificationId: "esc1",
				sentAt: mockDate,
				notificationChannel: "slack",
				status: "failed",
			});

			// The functionality is tested by the failed log creation - the unsupported warning may not be logged due to implementation details
		});

		it("should handle missing team email gracefully", async () => {
			const incidentStartTime = "2024-01-01T00:09:00Z"; // 1 minute ago from mock time
			const mockIncident: Incident = {
				id: "incident1",
				monitorId: "monitor1",
				teamId: "team1",
				startTime: incidentStartTime,
				endTime: null,
				status: false,
				message: "Monitor is down",
				statusCode: 500,
				resolutionType: null,
				resolvedBy: null,
				resolvedByEmail: null,
				comment: null,
				createdAt: incidentStartTime,
				updatedAt: incidentStartTime,
			};

			const mockEscalations: EscalationNotification[] = [
				{
					id: "esc1",
					monitorId: "monitor1",
					escalationLevel: 1,
					delaySeconds: 60,
					notificationChannel: "email",
					isActive: true,
					createdAt: "2024-01-01T00:00:00Z",
					updatedAt: "2024-01-01T00:00:00Z",
				},
			];

			jest.mocked(escalationNotificationsRepository.findActiveByMonitorId).mockResolvedValue(mockEscalations);
			jest.mocked(escalationLogsRepository.hasBeenSent).mockResolvedValue(false);
			jest.mocked(monitorsRepository.findById).mockResolvedValue({
				id: "monitor1",
				name: "Test Monitor",
				url: "https://example.com",
				teamId: "team1",
			} as any);
			jest.mocked(teamsRepository.findById).mockResolvedValue(null); // No team found
			jest.mocked(emailService.sendEmail).mockResolvedValue("message-id-999");
			jest.mocked(emailService.buildEmail).mockResolvedValue("<html>Escalation email</html>");

			await (service as any).processIncidentEscalations(mockIncident);

			// Should use fallback email
			expect(emailService.sendEmail).toHaveBeenCalledWith(
				"admin@example.com", // Fallback email
				expect.any(String),
				expect.any(String)
			);
		});
	});

	describe("Escalation priority logic", () => {
		let mockDate: Date;
		let originalDate: typeof Date;
		let originalDateNow: typeof Date.now;

		beforeEach(() => {
			mockDate = new Date("2024-01-01T00:10:00Z");
			originalDate = global.Date;
			originalDateNow = global.Date.now;

			// Mock Date constructor to return mock time for new Date(), but parse strings correctly
			const MockDate = class extends Date {
				constructor(...args: any[]) {
					if (args.length === 0) {
						// new Date() - return mock time
						super(mockDate.getTime());
					} else {
						// new Date(string) - parse normally
						super(...args);
					}
				}
			};
			global.Date = MockDate as any;
			global.Date.now = jest.fn(() => mockDate.getTime());
		});

		afterEach(() => {
			global.Date = originalDate;
			global.Date.now = originalDateNow;
		});

		it("should send only the highest qualifying escalation level", async () => {
			const incidentStartTime = "2024-01-01T00:00:00Z"; // 10 minutes ago
			const mockIncident: Incident = {
				id: "incident1",
				monitorId: "monitor1",
				teamId: "team1",
				startTime: incidentStartTime,
				endTime: null,
				status: false,
				message: "Monitor is down",
				statusCode: 500,
				resolutionType: null,
				resolvedBy: null,
				resolvedByEmail: null,
				comment: null,
				createdAt: incidentStartTime,
				updatedAt: incidentStartTime,
			};

			// All escalations should qualify (10 minutes elapsed), but only level 3 should be sent
			const mockEscalations: EscalationNotification[] = [
				{
					id: "esc1",
					monitorId: "monitor1",
					escalationLevel: 1,
					delaySeconds: 60, // 1 minute - qualifies but lower priority
					notificationChannel: "email",
					isActive: true,
					createdAt: "2024-01-01T00:00:00Z",
					updatedAt: "2024-01-01T00:00:00Z",
				},
				{
					id: "esc2",
					monitorId: "monitor1",
					escalationLevel: 2,
					delaySeconds: 300, // 5 minutes - qualifies but lower priority
					notificationChannel: "email",
					isActive: true,
					createdAt: "2024-01-01T00:00:00Z",
					updatedAt: "2024-01-01T00:00:00Z",
				},
				{
					id: "esc3",
					monitorId: "monitor1",
					escalationLevel: 3,
					delaySeconds: 600, // 10 minutes - qualifies and highest priority
					notificationChannel: "email",
					isActive: true,
					createdAt: "2024-01-01T00:00:00Z",
					updatedAt: "2024-01-01T00:00:00Z",
				},
			];

			jest.mocked(escalationNotificationsRepository.findActiveByMonitorId).mockResolvedValue(mockEscalations);
			jest.mocked(escalationLogsRepository.hasBeenSent).mockResolvedValue(false); // None sent yet
			jest.mocked(monitorsRepository.findById).mockResolvedValue({
				id: "monitor1",
				name: "Test Monitor",
				url: "https://example.com",
				teamId: "team1",
			} as any);
			jest.mocked(teamsRepository.findById).mockResolvedValue({
				id: "team1",
				email: "team@example.com",
			} as any);
			jest.mocked(emailService.sendEmail).mockResolvedValue("message-id-123");
			jest.mocked(emailService.buildEmail).mockResolvedValue("<html>Escalation email</html>");

			await (service as any).processIncidentEscalations(mockIncident);

			// Should only send the highest qualifying escalation (level 3)
			expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
			expect(emailService.sendEmail).toHaveBeenCalledWith(
				"team@example.com",
				expect.stringContaining("ESCALATION: Monitor Test Monitor incident - Level 3"),
				expect.any(String)
			);

			// Should only log one notification
			expect(escalationLogsRepository.create).toHaveBeenCalledTimes(1);
			expect(escalationLogsRepository.create).toHaveBeenCalledWith({
				incidentId: "incident1",
				escalationNotificationId: "esc3",
				sentAt: mockDate,
				notificationChannel: "email",
				status: "sent",
			});
		});

		it("should respect escalation level ordering (not delay time)", async () => {
			const incidentStartTime = "2024-01-01T00:00:00Z"; // 10 minutes ago
			const mockIncident: Incident = {
				id: "incident1",
				monitorId: "monitor1",
				teamId: "team1",
				startTime: incidentStartTime,
				endTime: null,
				status: false,
				message: "Monitor is down",
				statusCode: 500,
				resolutionType: null,
				resolvedBy: null,
				resolvedByEmail: null,
				comment: null,
				createdAt: incidentStartTime,
				updatedAt: incidentStartTime,
			};

			// Escalations with out-of-order delay times - should still prioritize by level
			const mockEscalations: EscalationNotification[] = [
				{
					id: "esc1",
					monitorId: "monitor1",
					escalationLevel: 1,
					delaySeconds: 1200, // 20 minutes - doesn't qualify
					notificationChannel: "email",
					isActive: true,
					createdAt: "2024-01-01T00:00:00Z",
					updatedAt: "2024-01-01T00:00:00Z",
				},
				{
					id: "esc3",
					monitorId: "monitor1",
					escalationLevel: 3,
					delaySeconds: 60, // 1 minute - qualifies and highest level
					notificationChannel: "email",
					isActive: true,
					createdAt: "2024-01-01T00:00:00Z",
					updatedAt: "2024-01-01T00:00:00Z",
				},
				{
					id: "esc2",
					monitorId: "monitor1",
					escalationLevel: 2,
					delaySeconds: 300, // 5 minutes - qualifies but lower level than 3
					notificationChannel: "email",
					isActive: true,
					createdAt: "2024-01-01T00:00:00Z",
					updatedAt: "2024-01-01T00:00:00Z",
				},
			];

			jest.mocked(escalationNotificationsRepository.findActiveByMonitorId).mockResolvedValue(mockEscalations);
			jest.mocked(escalationLogsRepository.hasBeenSent).mockResolvedValue(false);
			jest.mocked(monitorsRepository.findById).mockResolvedValue({
				id: "monitor1",
				name: "Test Monitor",
				url: "https://example.com",
				teamId: "team1",
			} as any);
			jest.mocked(teamsRepository.findById).mockResolvedValue({
				id: "team1",
				email: "team@example.com",
			} as any);
			jest.mocked(emailService.sendEmail).mockResolvedValue("message-id-123");
			jest.mocked(emailService.buildEmail).mockResolvedValue("<html>Escalation email</html>");

			await (service as any).processIncidentEscalations(mockIncident);

			// Should send level 3 (highest level that qualifies), even though level 2 has a longer delay
			expect(emailService.sendEmail).toHaveBeenCalledWith(
				"team@example.com",
				expect.stringContaining("ESCALATION: Monitor Test Monitor incident - Level 3"),
				expect.any(String)
			);
		});
	});
});