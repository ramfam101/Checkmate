import { IncidentModel } from "@/db/models/Incident.js";
import { MonitorModel } from "@/db/models/Monitor.js";
import { NotificationModel } from "@/db/models/Notification.js";
import type { IEmailService } from "@/service/infrastructure/emailService.js";
import type { ILogger } from "@/utils/logger.js";

const SERVICE_NAME = "EscalationService";

export interface IEscalationService {
	checkEscalations(): Promise<void>;
}

export class EscalationService implements IEscalationService {
	static SERVICE_NAME = SERVICE_NAME;

	private emailService: IEmailService;
	private logger: ILogger;

	constructor(emailService: IEmailService, logger: ILogger) {
		this.emailService = emailService;
		this.logger = logger;
	}

	checkEscalations = async (): Promise<void> => {
		// Only look at open (unresolved) incidents
		const openIncidents = await IncidentModel.find({ endTime: null });

		for (const incident of openIncidents) {
			const monitor = await MonitorModel.findById(incident.monitorId);

			// Skip if monitor not found or has no escalation rules
			if (!monitor || !monitor.escalations?.length) continue;

			const incidentAgeMinutes =
				(Date.now() - new Date(incident.startTime).getTime()) / 60000;

			for (const rule of monitor.escalations) {
				// Skip if this threshold was already sent for this incident
				if (incident.escalationsSent?.includes(rule.time)) continue;

				// Fire if the incident has been open at least as long as the rule
				if (incidentAgeMinutes >= rule.time) {

                    // Look up the real email address from the notification
                    const notification = await NotificationModel.findById(rule.email);
                    
                    if (!notification?.address) {
                        this.logger.warn({
                            message: `No email address found for notification ID ${rule.email}`,
                            service: SERVICE_NAME,
                            method: "checkEscalations",
                        });
                        continue;
                    }

					const sent = await this.sendEscalationEmail(
						notification.address,
						{ name: monitor.name, url: monitor.url, type: monitor.type },
						rule.time
					);

					if (sent) {
						// Mark this threshold as sent so it never fires again
						await IncidentModel.updateOne(
							{ _id: incident._id },
							{ $push: { escalationsSent: rule.time } }
						);
						this.logger.info({
							message: `Escalation sent for monitor ${monitor.name} at ${rule.time} min`,
							service: SERVICE_NAME,
							method: "checkEscalations",
						});
					} else {
						this.logger.warn({
							message: `Escalation email failed for monitor ${monitor.name} at ${rule.time} min`,
							service: SERVICE_NAME,
							method: "checkEscalations",
						});
					}
				}
			}
		}
	};

	private sendEscalationEmail = async (
        to: string,
        monitor: { name: string; url: string; type: string },
        minutesDown: number
    ): Promise<boolean> => {
        this.logger.info({
            message: `Sending escalation email to: ${to}`,
            service: SERVICE_NAME,
            method: "sendEscalationEmail",
        });

        const subject = `[ESCALATION] ${monitor.name} has been down for ${minutesDown} minute(s)`;

        const html = await this.emailService.buildEmail("unifiedNotificationTemplate", {
            title: `Escalation Alert: ${monitor.name}`,
            summary: `${monitor.name} has been down for at least ${minutesDown} minute(s). Immediate attention is required.`,
            monitorName: monitor.name,
            monitorUrl: monitor.url,        
            monitorType: monitor.type,     
            monitorStatus: "down",
            headerColor: "red",
            details: [                     
                `URL: ${monitor.url}`,
                `Status: Down`,
                `Type: ${monitor.type}`,
                `Down for: ${minutesDown} minute(s)`,
            ],
        });

        if (!html) {
            this.logger.warn({
                message: "Failed to build escalation email content",
                service: SERVICE_NAME,
                method: "sendEscalationEmail",
            });
            return false;
        }

        this.logger.info({
            message: `Escalation sent for monitor ${monitor.name} at ${minutesDown} min`,
            service: SERVICE_NAME,
            method: "sendEscalationEmail",
        });

        const messageId = await this.emailService.sendEmail(to, subject, html);
        return !!messageId;
    };
}