import QueueService from "../infrastructure/queueService.js";
import IncidentRepository from "../../repositories/incidents/incidentRepository.js";
import NotificationModel, { NotificationDocument } from "../../db/models/Notification.js";
import { Types } from "mongoose";

async function scheduleEscalationJobs(notification: NotificationDocument, incidentId: Types.ObjectId) {
	if (!notification?.escalations?.length) return;

	for (const esc of notification.escalations) {
		const delayMs = Math.max(0, esc.delayMinutes) * 60_000;
		await QueueService.enqueueDelayed(
			"incident:escalation:check",
			{
				incidentId: incidentId.toString(),
				channelId: esc.channelId.toString(),
			},
			delayMs
		);
	}
}

// Called when an incident is created or when sending initial alerts
export async function handleNotificationForIncident(notificationId: string, incidentId: string) {
	// use .lean() and cast to avoid Mongoose Document type missing runtime props like `enabled`
	const notification = (await NotificationModel.findById(notificationId).lean().exec()) as any;
	if (!notification || !notification.enabled) return;

	// NOTE: initial send should be performed by the existing NotificationsService/provider pipeline.
	// This helper only schedules escalation checks for now.
	await scheduleEscalationJobs(notification, new Types.ObjectId(incidentId));
}

// Worker / processor for the delayed escalation check job
QueueService.process("incident:escalation:check", async (job) => {
	const { incidentId, channelId } = job.data as { incidentId: string; channelId: string };
	const incident = await IncidentRepository.findById(incidentId);
	if (!incident) return;

	const inc = incident as any;

	// Robust resolved detection across different Incident shapes:
	const isResolved =
		(typeof inc.status === "string" && inc.status === "resolved") || // string-status variant
		inc.resolutionType != null || // has resolution type
		!!inc.resolvedAt || // has resolved timestamp
		inc.status === true; // boolean-status variant (true meaning resolved)

	// Robust acknowledged detection:
	const isAcknowledged = !!inc.acknowledged || !!inc.acknowledgedAt || !!inc.acknowledgedBy;

	if (isResolved || isAcknowledged) return;

	// TODO: Wire this to the notifications send pipeline (provider/NotificationsService) to actually send to channelId.
	// For now just log the escalation event so the job completes.
	console.warn(`Escalation triggered for incident ${incidentId} -> channel ${channelId}`);
});
