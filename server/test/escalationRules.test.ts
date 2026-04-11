
import { jest } from "@jest/globals";
import { IncidentService } from "../src/service/business/incidentService";
import { NotificationsService } from "../src/service/infrastructure/notificationsService";

describe("Escalation Rules Integration", () => {
  it("schedules escalation notifications according to escalationRules", async () => {
    const mockSchedule = jest.fn();
    const notificationsService = {
      scheduleEscalationNotifications: mockSchedule,
    } as unknown as NotificationsService;

    const incidentService = new IncidentService(
      {} as any, // logger
      { findActiveByMonitorId: jest.fn(), create: jest.fn().mockResolvedValue({ id: "incident-1" }) } as any, // incidentsRepository
      {} as any, // monitorsRepository
      {} as any, // usersRepository
      { extractThresholdBreaches: jest.fn() } as any, // notificationMessageBuilder
      notificationsService
    );

    const monitor = {
      id: "monitor-1",
      teamId: "team-1",
      escalationRules: [
        { delayMinutes: 1, notificationChannelIds: ["notif-1"] },
        { delayMinutes: 5, notificationChannelIds: ["notif-2"] },
      ],
    } as any;
    const decision = { shouldCreateIncident: true, shouldResolveIncident: false } as any;
    const monitorStatusResponse = {} as any;

    await incidentService.handleIncident(monitor, 500, decision, monitorStatusResponse);

    expect(mockSchedule).toHaveBeenCalledWith(monitor, monitorStatusResponse, decision);
  });
});
