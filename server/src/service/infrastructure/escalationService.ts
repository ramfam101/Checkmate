import type { Monitor } from "@/types/monitor.js";
import type { NotificationEscalation, NotificationEscalationTracker } from "@/types/escalation.js";
import type { IIncidentsRepository } from "@/repositories/index.js";
import type { IEscalationRepository } from "@/repositories/escalationRepository.js";
import type { INotificationsService } from "./notificationsService.js";
import type { INotificationMessageBuilder } from "@/service/infrastructure/notificationMessageBuilder.js";
import type { ISettingsService } from "@/service/system/settingsService.js";
import { ILogger } from "@/utils/logger.js";
import { v4 as uuidv4 } from "uuid";

export interface IEscalationService {
	processEscalations(monitor: Monitor): Promise<void>;
	acknowledgeIncident(incidentId: string, teamId: string): Promise<void>;
	createEscalationTracker(
		incidentId: string,
		monitor: Monitor,
		escalationRule: NotificationEscalation
	): Promise<NotificationEscalationTracker>;
}

const SERVICE_NAME = "EscalationService";

export class EscalationService implements IEscalationService {
	static SERVICE_NAME = SERVICE_NAME;

	private escalationRepository: IEscalationRepository;
	private incidentsRepository: IIncidentsRepository;
	private notificationsService: INotificationsService;
	private notificationMessageBuilder: INotificationMessageBuilder;
	private settingsService: ISettingsService;
	private logger: ILogger;

	constructor(
		escalationRepository: IEscalationRepository,
		incidentsRepository: IIncidentsRepository,
		notificationsService: INotificationsService,
		notificationMessageBuilder: INotificationMessageBuilder,
		settingsService: ISettingsService,
		logger: ILogger
	) {
		this.escalationRepository = escalationRepository;
		this.incidentsRepository = incidentsRepository;
		this.notificationsService = notificationsService;
		this.notificationMessageBuilder = notificationMessageBuilder;
		this.settingsService = settingsService;
		this.logger = logger;
	}

	processEscalations = async (monitor: Monitor): Promise<void> => {
		const rules = (monitor.escalationRules ?? []).filter((r) => r.delayMinutes > 0);
		if (rules.length === 0) {
			return;
		}

		const activeIncident = await this.incidentsRepository.findActiveByMonitorId(monitor.id, monitor.teamId);
		if (!activeIncident) {
			return;
		}

		for (const rule of rules) {
			await this.checkAndEscalate(activeIncident.id, monitor, rule);
		}
	};

	private checkAndEscalate = async (
		incidentId: string,
		monitor: Monitor,
		escalationRule: NotificationEscalation
	): Promise<void> => {
		const ruleKey = this.ruleKey(escalationRule);
		let tracker = await this.escalationRepository.findByIncidentAndRule(incidentId, ruleKey);

		if (!tracker) {
			tracker = await this.createEscalationTracker(incidentId, monitor, escalationRule);
		}

		if (tracker.isEscalated || tracker.acknowledgedAt) {
			return;
		}

		const createdTime = new Date(tracker.createdAt).getTime();
		const delayMs = tracker.delayMinutes * 60 * 1000;

		if (Date.now() - createdTime >= delayMs) {
			await this.sendEscalation(monitor, tracker);
			await this.escalationRepository.updateById(tracker.id, monitor.teamId, {
				isEscalated: true,
				escalatedAt: new Date().toISOString(),
			});
			this.logger.info({
				message: `Incident ${incidentId} escalated for monitor ${monitor.id}`,
				service: SERVICE_NAME,
			});
		}
	};

	private sendEscalation = async (monitor: Monitor, tracker: NotificationEscalationTracker): Promise<void> => {
		const escalationNotification = await this.notificationsService.findById(
			tracker.escalationNotificationId,
			monitor.teamId
		);
		const settings = this.settingsService.getSettings();
		const clientHost = settings.clientHost || "Host not defined";
		const notificationMessage = this.notificationMessageBuilder.buildEscalationMessage(
			monitor,
			tracker.delayMinutes,
			clientHost
		);
		await this.notificationsService.sendDirectNotification(escalationNotification, notificationMessage);
	};

	createEscalationTracker = async (
		incidentId: string,
		monitor: Monitor,
		escalationRule: NotificationEscalation
	): Promise<NotificationEscalationTracker> => {
		const primaryNotificationId = monitor.notifications[0] ?? escalationRule.channelId;
		const tracker: NotificationEscalationTracker = {
			id: uuidv4(),
			incidentId,
			monitorId: monitor.id,
			teamId: monitor.teamId,
			escalationRuleId: this.ruleKey(escalationRule),
			primaryNotificationId,
			escalationNotificationId: escalationRule.channelId,
			delayMinutes: escalationRule.delayMinutes,
			createdAt: new Date().toISOString(),
			isEscalated: false,
		};
		return await this.escalationRepository.create(tracker);
	};

	private ruleKey = (rule: NotificationEscalation): string =>
		rule.id ?? `${rule.channelId}:${rule.delayMinutes}`;

	acknowledgeIncident = async (incidentId: string, teamId: string): Promise<void> => {
		const trackers = await this.escalationRepository.findByIncident(incidentId);
		await Promise.all(
			trackers.map((tracker) =>
				this.escalationRepository.updateById(tracker.id, teamId, {
					acknowledgedAt: new Date().toISOString(),
				})
			)
		);
		this.logger.info({
			message: `Escalation stopped for incident ${incidentId}`,
			service: SERVICE_NAME,
		});
	};
}
