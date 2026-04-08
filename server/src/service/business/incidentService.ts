const SERVICE_NAME = "incidentService";
import type { Monitor } from "@/types/monitor.js";
import type { MonitorStatusResponse } from "@/types/network.js";
import { AppError } from "@/utils/AppError.js";
import { getDateForRange } from "@/utils/dataUtils.js";
import type { IIncidentsRepository, IMonitorsRepository, IUsersRepository } from "@/repositories/index.js";
import type { Incident, IncidentSummary, User } from "@/types/index.js";
import type { MonitorActionDecision } from "@/service/infrastructure/SuperSimpleQueue/SuperSimpleQueueHelper.js";
import type { INotificationMessageBuilder } from "@/service/infrastructure/notificationMessageBuilder.js";
import type { ILogger } from "@/utils/logger.js";
import type { INotificationsService } from "@/service/index.js";

export interface IIncidentService {
    handleIncident(
        monitor: Monitor,
        code: number,
        decision: MonitorActionDecision,
        monitorStatusResponse?: MonitorStatusResponse
    ): Promise<Incident | null>;
    resolveIncident(incidentId: string, userId: string, teamId: string, comment?: string, userEmail?: string): Promise<Incident>;
    getIncidentsByTeam(
        teamId: string,
        sortOrder: string,
        dateRange: string,
        page: number,
        rowsPerPage: number,
        status: boolean | undefined,
        monitorId: string | undefined,
        resolutionType: string | undefined
    ): Promise<{ incidents: Incident[]; count: number }>;
    getIncidentSummary(teamId: string, limit?: number): Promise<IncidentSummary>;
    getIncidentById(incidentId: string, teamId: string): Promise<{ incident: Incident; monitor: Monitor; user: User | null }>;
}

export class IncidentService implements IIncidentService {
    static SERVICE_NAME = SERVICE_NAME;

    private logger: ILogger;
    private incidentsRepository: IIncidentsRepository;
    private monitorsRepository: IMonitorsRepository;
    private usersRepository: IUsersRepository;
    private notificationMessageBuilder: INotificationMessageBuilder;
    private notificationService: INotificationsService;

    constructor(
        logger: ILogger,
        incidentsRepository: IIncidentsRepository,
        monitorsRepository: IMonitorsRepository,
        usersRepository: IUsersRepository,
        notificationMessageBuilder: INotificationMessageBuilder,
        notificationService: INotificationsService
    ) {
        this.logger = logger;
        this.incidentsRepository = incidentsRepository;
        this.monitorsRepository = monitorsRepository;
        this.usersRepository = usersRepository;
        this.notificationMessageBuilder = notificationMessageBuilder;
        this.notificationService = notificationService;
    }

    get serviceName() {
        return IncidentService.SERVICE_NAME;
    }

    handleIncident = async (
        monitor: Monitor,
        code: number,
        decision: MonitorActionDecision,
        monitorStatusResponse?: MonitorStatusResponse
    ): Promise<Incident | null> => {
        const activeIncident = await this.incidentsRepository.findActiveByMonitorId(monitor.id, monitor.teamId);

        if (!decision.shouldCreateIncident && !decision.shouldResolveIncident) {
            if (activeIncident && monitor.status === "down") {
                await this.processEscalations(monitor, activeIncident);
            }
            return activeIncident || null;
        }

        if (decision.shouldCreateIncident) {
            if (activeIncident) {
                await this.processEscalations(monitor, activeIncident);
                return activeIncident;
            } else {
                let statusCode = code;
                let message: string | undefined;

                if (decision.incidentReason === "threshold_breach") {
                    statusCode = 9999;
                    message = this.buildThresholdBreachMessage(monitor, monitorStatusResponse);
                }

                const incident = {
                    monitorId: monitor.id,
                    teamId: monitor.teamId,
                    startTime: Date.now().toString(),
                    status: true,
                    statusCode,
                    message,
                    notifiedEscalations: [],
                };
                return await this.incidentsRepository.create(incident as any);
            }
        }

        if (decision.shouldResolveIncident && activeIncident) {
            activeIncident.status = false;
            activeIncident.endTime = Date.now().toString();
            activeIncident.resolutionType = "automatic";
            return await this.incidentsRepository.updateById(activeIncident.id, activeIncident.teamId, activeIncident);
        }

        return null;
    };

    private formatDowntimeDuration = (downtimeMinutes: number): string => {
        if (downtimeMinutes < 1) {
            return "less than 1 minute";
        }

        const hours = Math.floor(downtimeMinutes / 60);
        const minutes = Math.floor(downtimeMinutes % 60);

        if (hours > 0) {
            if (minutes > 0) {
                return `${hours} hour${hours > 1 ? "s" : ""} and ${minutes} minute${minutes > 1 ? "s" : ""}`;
            }
            return `${hours} hour${hours > 1 ? "s" : ""}`;
        }

        return `${minutes} minute${minutes > 1 ? "s" : ""}`;
    };

    private processEscalations = async (monitor: Monitor, incident: Incident) => {
        if (!monitor.escalationLevels?.length) return;

        const downtimeMinutes = (Date.now() - Number(incident.startTime)) / 60000;

        for (const level of monitor.escalationLevels) {
            const hasBeenNotified = incident.notifiedEscalations?.includes(level.notificationId);

            if (downtimeMinutes >= level.delayMinutes && !hasBeenNotified) {
                const formattedDuration = this.formatDowntimeDuration(downtimeMinutes);

                // Send escalation notification
                await this.notificationService.sendToChannel(level.notificationId, {
                    monitor,
                    type: "monitor_down",
                    isEscalation: true,
                    escalationDelayMinutes: level.delayMinutes,
                    severity: "critical",
                    content: {
                        title: `Escalation Alert: ${monitor.name}`,
                        summary: `${monitor.name} has been down for more than ${this.formatDowntimeDuration(level.delayMinutes)}.`,
                        details: [
                            `Server: ${monitor.name}`,
                            `Downtime: ${formattedDuration}`,
                            `Escalation Threshold: ${this.formatDowntimeDuration(level.delayMinutes)}`,
                        ],
                    },
                });

                // Record that we've notified for this escalation level
                incident.notifiedEscalations = [...(incident.notifiedEscalations || []), level.notificationId];
                await this.incidentsRepository.updateById(incident.id, monitor.teamId, incident);

                this.logger.info({
                    message: "Escalation notification sent",
                    service: SERVICE_NAME,
                    method: "processEscalations",
                    monitorId: monitor.id,
                    monitorName: monitor.name,
                    delayMinutes: level.delayMinutes,
                    downtimeMinutes: Math.round(downtimeMinutes),
                });
            }
        }
    };

    private buildThresholdBreachMessage(monitor: Monitor, monitorStatusResponse?: MonitorStatusResponse): string {
        if (!monitorStatusResponse) return "Threshold breach detected";
        const breaches = this.notificationMessageBuilder.extractThresholdBreaches(monitor, monitorStatusResponse);
        if (breaches.length === 0) return "Threshold breach detected";
        return breaches.map((b) => `${b.metric.toUpperCase()}: ${b.formattedValue} (threshold: ${b.threshold}${b.unit})`).join(", ");
    }

    resolveIncident = async (incidentId: string, userId: string, teamId: string, comment?: string, userEmail?: string) => {
        const incident = await this.incidentsRepository.findActiveByIncidentId(incidentId, teamId);
        if (!incident) throw new AppError({ message: "Incident not found", status: 404 });

        incident.resolutionType = "manual";
        incident.status = false;
        incident.resolvedBy = userId;
        incident.resolvedByEmail = userEmail || null;
        incident.comment = comment || null;
        incident.endTime = Date.now().toString();

        return await this.incidentsRepository.updateById(incident.id, teamId, incident);
    };

    getIncidentsByTeam = async (teamId: string, sortOrder: string, dateRange: string, page: number, rowsPerPage: number, status: boolean | undefined, monitorId: string | undefined, resolutionType: string | undefined) => {
        const startDate = getDateForRange(dateRange);
        const incidents = await this.incidentsRepository.findByTeamId(teamId, startDate, page, rowsPerPage, sortOrder, status, monitorId, resolutionType);
        const count = await this.incidentsRepository.countByTeamId(teamId, startDate, status, monitorId, resolutionType);
        return { incidents, count };
    };

    getIncidentSummary = async (teamId: string, limit?: number) => {
        return await this.incidentsRepository.findSummaryByTeamId(teamId, limit ?? 10);
    };

    getIncidentById = async (incidentId: string, teamId: string) => {
        const incident = await this.incidentsRepository.findById(incidentId, teamId);
        const monitor = await this.monitorsRepository.findById(incident.monitorId, teamId);
        let user = incident.resolvedBy ? await this.usersRepository.findById(incident.resolvedBy) : null;
        return { incident, monitor, user };
    };
}
