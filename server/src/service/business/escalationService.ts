import { IEmailService } from "../email/IEmailService.js";
import { IMonitorsRepository } from "../../repositories/monitors/IMonitorsRepository.js";
import { IChecksRepository } from "../../repositories/checks/IChecksRepository.js";
import { INotificationsRepository } from "../../repositories/notifications/INotificationsRepository.js";
import { ILogger } from "../../utils/logger.js";
import { Monitor } from "../../types/index.js";
import { NotificationMessageBuilder } from "../infrastructure/notificationMessageBuilder.js";

export class EscalationService {
    private emailService: IEmailService;
    private monitorsRepository: IMonitorsRepository;
    private checksRepository: IChecksRepository;
    private notificationsRepository: INotificationsRepository;
    private logger: ILogger;
    private messageBuilder: NotificationMessageBuilder;

    constructor(
        emailService: IEmailService,
        monitorsRepository: IMonitorsRepository,
        checksRepository: IChecksRepository,
        notificationsRepository: INotificationsRepository,
        logger: ILogger
    ) {
        this.emailService = emailService;
        this.monitorsRepository = monitorsRepository;
        this.checksRepository = checksRepository;
        this.notificationsRepository = notificationsRepository;
        this.logger = logger;
        this.messageBuilder = new NotificationMessageBuilder();
    }

    public async checkAndSendEscalations() {
        try {

            const monitors = await this.monitorsRepository.findAll();
            
            for (const monitor of monitors ?? []) {
                if (!monitor.escalationDelay || monitor.escalationNotifications.length === 0) {
                    continue;
                }

                const latestCheck = monitor.recentChecks?.[0];

                
                if (!latestCheck || latestCheck.status === "up") {
                    continue;
                }

                const downDurationMinutes = (Date.now() - new Date(latestCheck.createdAt).getTime()) / (1000 * 60);
                
                if (downDurationMinutes >= monitor.escalationDelay) {
                    await this.sendEscalationEmails(monitor);
                } else {
                    this.logger.debug({
                        message: `Monitor ${monitor.name} - not enough downtime yet`,
                        service: "EscalationService",
                    });
                }
            }
        } catch (error) {
            this.logger.error({
                message: "Error checking escalations",
                service: "EscalationService",
                details: { error: (error as Error).message },
            });
        }
    }

    private async sendEscalationEmails(monitor: Monitor) {
        try {
            this.logger.info({
                message: `Processing ${monitor.escalationNotifications.length} escalation notifications for ${monitor.name}`,
                service: "EscalationService",
            });

            for (const notificationId of monitor.escalationNotifications) {

                const notification = await this.notificationsRepository.findById(notificationId, monitor.teamId);

                const emailAddress = notification.email || notification.data?.email || notification.address || notification.webhookUrl;

                if (!emailAddress) {
                    this.logger.warn({
                        message: `No email address found in notification: ${JSON.stringify(notification)}`,
                        service: "EscalationService",
                    });
                    continue;
                }

                const message = this.messageBuilder.buildMessage(
                    monitor,
                    { code: 0, message: `Monitor has been down for ${monitor.escalationDelay} minutes`, payload: null },
                    { notificationReason: "escalation" },
                    "escalation"
                );

                await this.emailService.sendEmail(
                    emailAddress,
                    "Escalation: Monitor is still down",
                    `${message.content.summary}\n\n${message.content.details.join("\n")}`,
                );

                this.logger.info({
                    message: `Escalation email sent to ${emailAddress}`,
                    service: "EscalationService",
                });
            }

            this.logger.info({
                message: `Escalation emails sent for monitor: ${monitor.name}`,
                service: "EscalationService",
            });
        } catch (error) {
            this.logger.error({
                message: "Error sending escalation emails",
                service: "EscalationService",
                details: { error: (error as Error).message, stack: (error as Error).stack },
            });
        }
    }
}