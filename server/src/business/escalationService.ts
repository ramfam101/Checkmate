import mongoose from "mongoose";
import IncidentModel from "@/db/models/Incident.js";
import MonitorModel from "@/db/models/Monitor.js";
import NotificationModel from "@/db/models/Notification.js";
import type { IncidentDocument } from "@/db/models/Incident.js";
import type { NotificationDocument } from "@/db/models/Notification.js";
import type { NotificationMessage } from "@/types/notificationMessage.js";
import type { INotificationsService } from "@/service/infrastructure/notificationsService.js";
import type { ISettingsService } from "@/service/system/settingsService.js";
import type { ILogger } from "@/utils/logger.js";
import type { Notification } from "@/types/notification.js";

const SERVICE_NAME = "escalationService";

type EscalationDependencies = {
	notificationsService: Pick<INotificationsService, "sendNotificationMessage">;
	settingsService: ISettingsService;
	logger: ILogger;
};

type ProcessEscalationsOptions = {
	monitorIds?: string[];
	notificationIds?: string[];
	catchUpBaseNotification?: boolean;
};

let escalationDependencies: EscalationDependencies | null = null;

export const initializeEscalationService = (dependencies: EscalationDependencies) => {
	escalationDependencies = dependencies;
};

const toObjectIds = (values: string[] | undefined): mongoose.Types.ObjectId[] => {
	if (!values?.length) {
		return [];
	}

	return values.flatMap((value) => {
		try {
			return [new mongoose.Types.ObjectId(value)];
		} catch {
			return [];
		}
	});
};

const toStringId = (value?: mongoose.Types.ObjectId | string | null): string => {
	if (!value) {
		return "";
	}
	return value instanceof mongoose.Types.ObjectId ? value.toString() : String(value);
};

const mapNotification = (doc: NotificationDocument): Notification => {
	const toDateString = (value?: Date | string | null): string => {
		if (!value) {
			return new Date(0).toISOString();
		}
		return value instanceof Date ? value.toISOString() : String(value);
	};

	return {
		id: toStringId(doc._id),
		userId: toStringId(doc.userId),
		teamId: toStringId(doc.teamId),
		type: doc.type,
		notificationName: doc.notificationName,
		address: doc.address ?? undefined,
		phone: doc.phone ?? undefined,
		homeserverUrl: doc.homeserverUrl ?? undefined,
		roomId: doc.roomId ?? undefined,
		accessToken: doc.accessToken ?? undefined,
		escalationRules: (doc.escalationRules ?? []).map((rule: NotificationDocument["escalationRules"][number]) => ({
			type: rule.type,
			delayMinutes: rule.delayMinutes,
			trigger: rule.trigger,
		})),
		createdAt: toDateString(doc.createdAt),
		updatedAt: toDateString(doc.updatedAt),
	};
};

const hasNotificationLog = (incident: IncidentDocument, notificationId: string, delayMinutes: number): boolean => {
	return (incident.escalationLogs ?? []).some(
		(log) => toStringId(log.notificationId) === notificationId && log.delayMinutes === delayMinutes
	);
};

const buildActiveIncidentCatchUpMessage = ({
	monitor,
	incident,
	clientHost,
}: {
	monitor: { id: string; name?: string | null; url?: string | null; type?: string | null; status?: string | null; teamId?: string | null };
	incident: IncidentDocument;
	clientHost: string;
}): NotificationMessage => {
	const isThresholdIncident = incident.statusCode === 9999;
	const title = isThresholdIncident ? `Threshold Exceeded: ${monitor.name}` : `Monitor Down: ${monitor.name}`;
	const summary = isThresholdIncident
		? `Monitor "${monitor.name}" still has an active threshold breach.`
		: `Monitor "${monitor.name}" currently has an active downtime incident.`;
	const details = [
		`Monitor URL: ${monitor.url ?? "Unknown"}`,
		`Incident started at: ${incident.createdAt instanceof Date ? incident.createdAt.toISOString() : String(incident.createdAt)}`,
	];

	if (incident.message) {
		details.push(`Incident message: ${incident.message}`);
	}

	if (incident.statusCode) {
		details.push(`Status code: ${incident.statusCode}`);
	}

	return {
		type: isThresholdIncident ? "threshold_breach" : "monitor_down",
		severity: isThresholdIncident ? "warning" : "critical",
		monitor: {
			id: monitor.id,
			name: monitor.name ?? "Unknown monitor",
			url: monitor.url ?? "",
			type: monitor.type ?? "unknown",
			status: monitor.status ?? (isThresholdIncident ? "breached" : "down"),
		},
		content: {
			title,
			summary,
			details,
			incident: {
				id: toStringId(incident._id),
				url: `${clientHost}/incidents`,
				createdAt: incident.createdAt,
			},
			timestamp: new Date(),
		},
		clientHost,
		metadata: {
			teamId: monitor.teamId ?? "",
			notificationReason: "active_incident_catchup",
		},
	};
};

const buildEscalationMessage = ({
	monitor,
	incident,
	clientHost,
	delayMinutes,
	elapsedMinutes,
}: {
	monitor: { id: string; name?: string | null; url?: string | null; type?: string | null; status?: string | null; teamId?: string | null };
	incident: IncidentDocument;
	clientHost: string;
	delayMinutes: number;
	elapsedMinutes: number;
}): NotificationMessage => {
	const isThresholdIncident = incident.statusCode === 9999;
	const title = isThresholdIncident ? `Escalation: Threshold Exceeded for ${monitor.name}` : `Escalation: Monitor Down for ${monitor.name}`;
	const summary = isThresholdIncident
		? `Incident for \"${monitor.name}\" is still active ${elapsedMinutes} minute(s) after it started.`
		: `Monitor \"${monitor.name}\" is still down ${elapsedMinutes} minute(s) after it went offline.`;
	const details = [
		`Escalation delay reached: ${delayMinutes} minute(s)`,
		`Elapsed since incident creation: ${elapsedMinutes} minute(s)`,
		`Monitor URL: ${monitor.url ?? "Unknown"}`,
	];

	if (incident.message) {
		details.push(`Incident message: ${incident.message}`);
	}

	if (incident.statusCode) {
		details.push(`Status code: ${incident.statusCode}`);
	}

	return {
		type: isThresholdIncident ? "threshold_breach" : "monitor_down",
		severity: isThresholdIncident ? "warning" : "critical",
		monitor: {
			id: monitor.id,
			name: monitor.name ?? "Unknown monitor",
			url: monitor.url ?? "",
			type: monitor.type ?? "unknown",
			status: monitor.status ?? "down",
		},
		content: {
			title,
			summary,
			details,
			incident: {
				id: toStringId(incident._id),
				url: `${clientHost}/incidents`,
				createdAt: incident.createdAt,
				duration: `${elapsedMinutes} minute(s)`,
			},
			timestamp: new Date(),
		},
		clientHost,
		metadata: {
			teamId: monitor.teamId ?? "",
			notificationReason: "escalation",
		},
	};
};

export async function processEscalations(options: ProcessEscalationsOptions = {}): Promise<void> {
	if (!escalationDependencies) {
		throw new Error("Escalation service has not been initialized");
	}

	const { notificationsService, settingsService, logger } = escalationDependencies;
	const clientHost = settingsService.getSettings().clientHost || "Host not defined";
	const now = Date.now();
	const monitorObjectIds = toObjectIds(options.monitorIds);
	const notificationObjectIds = toObjectIds(options.notificationIds);
	const incidentQuery: Record<string, unknown> = {
		status: true,
		$or: [{ endTime: null }, { endTime: { $exists: false } }],
	};

	if (monitorObjectIds.length > 0) {
		incidentQuery.monitorId = { $in: monitorObjectIds };
	}

	const incidents = await IncidentModel.find(incidentQuery).lean();

	for (const incident of incidents) {
		try {
			const createdAt = incident.createdAt instanceof Date ? incident.createdAt : new Date(incident.createdAt);
			const elapsedMs = now - createdAt.getTime();
			if (elapsedMs < 0) {
				continue;
			}

			const elapsedMinutes = Math.floor(elapsedMs / (1000 * 60));
			const monitor = await MonitorModel.findById(incident.monitorId).lean();
			if (!monitor || !Array.isArray(monitor.notifications) || monitor.notifications.length === 0) {
				continue;
			}

			const applicableNotificationIds =
				notificationObjectIds.length > 0
					? monitor.notifications.filter((notificationId) =>
						notificationObjectIds.some((candidate) => candidate.equals(notificationId))
					)
					: monitor.notifications;

			if (applicableNotificationIds.length === 0) {
				continue;
			}

			const notifications = await NotificationModel.find({ _id: { $in: applicableNotificationIds } }).lean();
			if (notifications.length === 0) {
				continue;
			}

			for (const notificationDoc of notifications) {
				const sentLogs = incident.escalationLogs ?? [];
				const notificationId = toStringId(notificationDoc._id);
				const shouldCatchUpBaseNotification =
					options.catchUpBaseNotification === true && !hasNotificationLog(incident, notificationId, 0);
				const pendingRules = (notificationDoc.escalationRules ?? []).filter((rule) => {
					if (rule.trigger !== "escalation") {
						return false;
					}
					if (rule.delayMinutes > elapsedMinutes) {
						return false;
					}
					if (rule.type !== notificationDoc.type) {
						logger.warn({
							message: `Skipping escalation rule ${rule.delayMinutes} for notification ${notificationId} because rule type ${rule.type} does not match notification type ${notificationDoc.type}`,
							service: SERVICE_NAME,
							method: "processEscalations",
						});
						return false;
					}
					return !sentLogs.some((log) => toStringId(log.notificationId) === notificationId && log.delayMinutes === rule.delayMinutes);
				});

				if (pendingRules.length === 0) {
					if (!shouldCatchUpBaseNotification) {
						continue;
					}
				}

				const notification = mapNotification(notificationDoc);

				if (shouldCatchUpBaseNotification) {
					const catchUpMessage = buildActiveIncidentCatchUpMessage({
						monitor: {
							id: toStringId(monitor._id),
							name: monitor.name,
							url: monitor.url,
							type: monitor.type,
							status: monitor.status,
							teamId: toStringId(monitor.teamId),
						},
						incident,
						clientHost,
					});

					const sentCatchUp = await notificationsService.sendNotificationMessage(notification, catchUpMessage);
					if (sentCatchUp) {
						await IncidentModel.updateOne(
							{
								_id: incident._id,
								escalationLogs: {
									$not: {
										$elemMatch: {
											notificationId: notificationDoc._id,
											delayMinutes: 0,
										},
									},
								},
							},
							{
								$push: {
									escalationLogs: {
										notificationId: notificationDoc._id,
										delayMinutes: 0,
										sentAt: new Date(),
									},
								},
							}
						);
					}
				}

				for (const rule of pendingRules) {
					const message = buildEscalationMessage({
						monitor: {
							id: toStringId(monitor._id),
							name: monitor.name,
							url: monitor.url,
							type: monitor.type,
							status: monitor.status,
							teamId: toStringId(monitor.teamId),
						},
						incident,
						clientHost,
						delayMinutes: rule.delayMinutes,
						elapsedMinutes,
					});

					const sent = await notificationsService.sendNotificationMessage(notification, message);
					if (!sent) {
						continue;
					}

					await IncidentModel.updateOne(
						{
							_id: incident._id,
							escalationLogs: {
								$not: {
									$elemMatch: {
										notificationId: notificationDoc._id,
										delayMinutes: rule.delayMinutes,
									},
								},
							},
						},
						{
							$push: {
								escalationLogs: {
									notificationId: notificationDoc._id,
									delayMinutes: rule.delayMinutes,
									sentAt: new Date(),
								},
							},
						}
					);
				}
			}
		} catch (error: unknown) {
			logger.error({
				message: error instanceof Error ? error.message : "Unknown escalation processing error",
				service: SERVICE_NAME,
				method: "processEscalations",
				details: { incidentId: toStringId(incident._id) },
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	}
}