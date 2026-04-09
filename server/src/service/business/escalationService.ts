import type { Monitor } from "@/types/index.js";
import type { Incident } from "@/types/incident.js";
import type { EscalationHistoryEntry } from "@/types/escalation.js";
import { IIncidentsRepository, INotificationsRepository } from "@/repositories/index.js";
import { INotificationProvider } from "@/service/infrastructure/notificationProviders/INotificationProvider.js";
import type { ISettingsService } from "@/service/system/settingsService.js";
import { ILogger } from "@/utils/logger.js";
import type { INotificationMessageBuilder } from "@/service/infrastructure/notificationMessageBuilder.js";
import type { MonitorActionDecision } from "@/service/infrastructure/SuperSimpleQueue/SuperSimpleQueueHelper.js";
import type { MonitorStatusResponse } from "@/types/network.js";
import type { Notification } from "@/types/notification.js";

export interface IEscalationService {
	evaluateAndTriggerEscalations: (incident: Incident, monitor: Monitor) => Promise<void>;
	cancelPendingEscalations: (incidentId: string, teamId: string) => Promise<void>;
}

const SERVICE_NAME = "EscalationService";

export class EscalationService implements IEscalationService {
	static SERVICE_NAME = SERVICE_NAME;

	private incidentsRepository: IIncidentsRepository;
	private notificationsRepository: INotificationsRepository;
	private webhookProvider: INotificationProvider;
	private emailProvider: INotificationProvider;
	private slackProvider: INotificationProvider;
	private discordProvider: INotificationProvider;
	private pagerDutyProvider: INotificationProvider;
	private matrixProvider: INotificationProvider;
	private teamsProvider: INotificationProvider;
	private logger: ILogger;
	private settingsService: ISettingsService;
	private notificationMessageBuilder: INotificationMessageBuilder;

	constructor(
		incidentsRepository: IIncidentsRepository,
		notificationsRepository: INotificationsRepository,
		webhookProvider: INotificationProvider,
		emailProvider: INotificationProvider,
		slackProvider: INotificationProvider,
		discordProvider: INotificationProvider,
		pagerDutyProvider: INotificationProvider,
		matrixProvider: INotificationProvider,
		teamsProvider: INotificationProvider,
		settingsService: ISettingsService,
		logger: ILogger,
		notificationMessageBuilder: INotificationMessageBuilder
	) {
		this.incidentsRepository = incidentsRepository;
		this.notificationsRepository = notificationsRepository;
		this.webhookProvider = webhookProvider;
		this.emailProvider = emailProvider;
		this.slackProvider = slackProvider;
		this.discordProvider = discordProvider;
		this.pagerDutyProvider = pagerDutyProvider;
		this.matrixProvider = matrixProvider;
		this.teamsProvider = teamsProvider;
		this.settingsService = settingsService;
		this.logger = logger;
		this.notificationMessageBuilder = notificationMessageBuilder;
	}

	private calculateIncidentDurationMinutes = (incident: Incident): number => {
		const startTime = new Date(incident.startTime).getTime();
		const now = Date.now();
		const durationMs = now - startTime;
		return Math.floor(durationMs / (1000 * 60));
	};

	private sendEscalationNotification = async (
		notification: Notification,
		monitor: Monitor,
		monitorStatusResponse: MonitorStatusResponse,
		decision: MonitorActionDecision
	): Promise<boolean> => {
		const settings = this.settingsService.getSettings();
		const clientHost = settings.clientHost || "Host not defined";
		const notificationMessage = this.notificationMessageBuilder.buildMessage(monitor, monitorStatusResponse, decision, clientHost);

		switch (notification.type) {
			case "webhook":
				return (await this.webhookProvider.sendMessage?.(notification, notificationMessage)) || false;
			case "slack":
				return (await this.slackProvider.sendMessage?.(notification, notificationMessage)) || false;
			case "matrix":
				return (await this.matrixProvider.sendMessage?.(notification, notificationMessage)) || false;
			case "pager_duty":
				return (await this.pagerDutyProvider.sendMessage?.(notification, notificationMessage)) || false;
			case "discord":
				return (await this.discordProvider.sendMessage?.(notification, notificationMessage)) || false;
			case "email":
				return (await this.emailProvider.sendMessage?.(notification, notificationMessage)) || false;
			case "teams":
				return (await this.teamsProvider.sendMessage?.(notification, notificationMessage)) || false;
			default:
				this.logger.warn({
					message: `Unknown notification type: ${notification.type}`,
					service: SERVICE_NAME,
					method: "sendEscalationNotification",
				});
				return false;
		}
	};

	evaluateAndTriggerEscalations = async (incident: Incident, monitor: Monitor): Promise<void> => {
		try {
			const escalationRules = monitor.escalationRules || [];
			if (escalationRules.length === 0) {
				return;
			}

			if (!incident.escalationHistory) {
				incident.escalationHistory = [];
			}

			const durationMinutes = this.calculateIncidentDurationMinutes(incident);

			for (const rule of escalationRules) {
				let historyEntry = incident.escalationHistory.find((e) => e.delayMinutes === rule.delayMinutes);

				if (!historyEntry) {
					historyEntry = {
						delayMinutes: rule.delayMinutes,
						firedAt: null,
						channels: [],
						status: "pending",
					};
					incident.escalationHistory.push(historyEntry);
				}

				if (historyEntry.status === "pending" && durationMinutes >= rule.delayMinutes) {
					const mockMonitorStatusResponse = {} as MonitorStatusResponse;
					const mockDecision: MonitorActionDecision = {
						shouldSendNotification: true,
						notificationReason: null,
						shouldCreateIncident: false,
						shouldResolveIncident: false,
						incidentReason: null,
					};

					const tasks = rule.channels.map(async (channelId) => {
						try {
							const notification = await this.notificationsRepository.findById(channelId, monitor.teamId);
							if (!notification) {
								this.logger.warn({
									message: `Notification channel not found: ${channelId}`,
									service: SERVICE_NAME,
									method: "evaluateAndTriggerEscalations",
								});
								return false;
							}

							const sent = await this.sendEscalationNotification(
								notification,
								monitor,
								mockMonitorStatusResponse,
								mockDecision
							);

							if (sent) {
								historyEntry!.channels.push(notification.notificationName);
								this.logger.info({
									message: `Escalation sent to ${notification.notificationName}`,
									service: SERVICE_NAME,
									method: "evaluateAndTriggerEscalations",
								});
							}

							return sent;
						} catch (err) {
							this.logger.error({
								message: `Failed to send escalation to channel ${channelId}`,
								service: SERVICE_NAME,
								method: "evaluateAndTriggerEscalations",
								details: { error: String(err) },
							});
							return false;
						}
					});

					const outcomes = await Promise.all(tasks);
					const succeeded = outcomes.filter(Boolean).length;

					if (succeeded > 0) {
						historyEntry.status = "sent";
						historyEntry.firedAt = new Date();
						this.logger.info({
							message: `Escalation fired for incident ${incident.id} at ${rule.delayMinutes} minutes`,
							service: SERVICE_NAME,
							method: "evaluateAndTriggerEscalations",
						});
					}
				}
			}

			await this.incidentsRepository.updateById(incident.id, monitor.teamId, {
				escalationHistory: incident.escalationHistory,
			});
		} catch (err) {
			this.logger.error({
				message: "Error evaluating escalations",
				service: SERVICE_NAME,
				method: "evaluateAndTriggerEscalations",
				details: { error: String(err) },
			});
		}
	};

	cancelPendingEscalations = async (incidentId: string, teamId: string): Promise<void> => {
		try {
			const incident = await this.incidentsRepository.findById(incidentId, teamId);
			if (!incident || !incident.escalationHistory) {
				return;
			}

			let updated = false;
			for (const entry of incident.escalationHistory) {
				if (entry.status === "pending") {
					entry.status = "cancelled";
					updated = true;
				}
			}

			if (updated) {
				await this.incidentsRepository.updateById(incidentId, teamId, {
					escalationHistory: incident.escalationHistory,
				});
				this.logger.info({
					message: `Cancelled pending escalations for incident ${incidentId}`,
					service: SERVICE_NAME,
					method: "cancelPendingEscalations",
				});
			}
		} catch (err) {
			this.logger.error({
				message: "Error cancelling escalations",
				service: SERVICE_NAME,
				method: "cancelPendingEscalations",
				details: { error: String(err) },
			});
		}
	};
}
