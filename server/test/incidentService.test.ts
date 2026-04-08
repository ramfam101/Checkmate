import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { IncidentService } from "../src/service/business/incidentService.ts";
import type { IIncidentsRepository } from "../src/repositories/incidents/IIncidentsRepository.ts";
import type { IMonitorsRepository } from "../src/repositories/monitors/IMonitorsRepository.ts";
import type { IUsersRepository } from "../src/repositories/users/IUsersRepository.ts";
import type { INotificationMessageBuilder } from "../src/service/infrastructure/notificationMessageBuilder.ts";
import type { INotificationsService } from "../src/service/infrastructure/notificationsService.ts";
import type { ILogger } from "../src/utils/logger.ts";
import type { Monitor } from "../src/types/monitor.ts";

const createIncidentsRepositoryMock = () =>
	({
		findActiveByMonitorId: jest.fn(),
		create: jest.fn(),
		findById: jest.fn(),
		updateById: jest.fn(),
		findActiveByIncidentId: jest.fn(),
		findByTeamId: jest.fn(),
		findIncidentsCountByTeamId: jest.fn(),
		findIncidentSummaryByTeamId: jest.fn(),
	}) as unknown as IIncidentsRepository;

const createMonitorsRepositoryMock = () =>
	({
		findById: jest.fn(),
	}) as unknown as IMonitorsRepository;

const createUsersRepositoryMock = () =>
	({
		findById: jest.fn(),
	}) as unknown as IUsersRepository;

const createLoggerMock = () =>
	({
		info: jest.fn(),
		warn: jest.fn(),
		error: jest.fn(),
	}) as unknown as ILogger;

const createService = ({
	incidentsRepository = createIncidentsRepositoryMock(),
	monitorsRepository = createMonitorsRepositoryMock(),
	usersRepository = createUsersRepositoryMock(),
	notificationMessageBuilder = {
		extractThresholdBreaches: jest.fn().mockReturnValue([]),
	} as unknown as INotificationMessageBuilder,
	notificationsService = {
		handleNotifications: jest.fn(async () => true),
	} as unknown as INotificationsService,
	logger = createLoggerMock(),
}: {
	incidentsRepository?: IIncidentsRepository;
	monitorsRepository?: IMonitorsRepository;
	usersRepository?: IUsersRepository;
	notificationMessageBuilder?: INotificationMessageBuilder;
	notificationsService?: INotificationsService;
	logger?: ILogger;
} = {}) =>
	new IncidentService(
		logger,
		incidentsRepository,
		monitorsRepository,
		usersRepository,
		notificationMessageBuilder,
		notificationsService
	);

const createMonitor = (overrides: Partial<Monitor> = {}): Monitor => ({
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
	escalationNotifications: ["email-1", "email-2"],
	escalationDelay: 5,
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

describe("IncidentService escalation scheduling", () => {
	afterEach(() => {
		jest.useRealTimers();
	});

	it("schedules escalation notifications using the delay stored with each notification", async () => {
		jest.useFakeTimers();

		const incident = {
			id: "incident-1",
			monitorId: "monitor-1",
			teamId: "team-1",
			startTime: new Date().toISOString(),
			endTime: null,
			status: true,
			message: null,
			statusCode: 500,
			resolutionType: null,
			escalationSent: false,
			escalationTime: null,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
		};

		const incidentsRepository = createIncidentsRepositoryMock();
		(incidentsRepository.findActiveByMonitorId as jest.Mock).mockImplementation(async () => null);
		(incidentsRepository.create as jest.Mock).mockImplementation(async () => incident);
		(incidentsRepository.findById as jest.Mock).mockImplementation(async () => ({ ...incident }));
		(incidentsRepository.updateById as jest.Mock).mockImplementation(async (_id, _teamId, patch) => ({
			...incident,
			...(patch as Record<string, unknown>),
		}));

		const monitor = createMonitor({
			escalationNotificationDelays: [
				{ notificationId: "email-1", delay: 1 },
				{ notificationId: "email-2", delay: 2 },
			],
		});

		const monitorsRepository = createMonitorsRepositoryMock();
		(monitorsRepository.findById as jest.Mock).mockImplementation(async () => monitor);

		const notificationsService = {
			handleNotifications: jest.fn(async () => true),
		} as unknown as INotificationsService;

		const service = createService({
			incidentsRepository,
			monitorsRepository,
			notificationsService,
		});

		await service.handleIncident(
			monitor,
			500,
			{
				shouldCreateIncident: true,
				shouldResolveIncident: false,
				shouldSendNotification: true,
				incidentReason: "status_change",
				notificationReason: "status_change",
			},
			undefined
		);

		expect((notificationsService.handleNotifications as jest.Mock).mock.calls).toHaveLength(0);

		await jest.advanceTimersByTimeAsync(60_000);
		expect(notificationsService.handleNotifications).toHaveBeenCalledTimes(1);
		expect(notificationsService.handleNotifications).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ escalationNotifications: ["email-1"] }),
			expect.any(Object),
			expect.objectContaining({ shouldSendNotification: true }),
			true
		);

		await jest.advanceTimersByTimeAsync(60_000);
		expect(notificationsService.handleNotifications).toHaveBeenCalledTimes(2);
		expect(notificationsService.handleNotifications).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ escalationNotifications: ["email-2"] }),
			expect.any(Object),
			expect.objectContaining({ shouldSendNotification: true }),
			true
		);
	});
});
