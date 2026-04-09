import { describe, expect, it } from "@jest/globals";
import { NotificationMessageBuilder } from "../src/service/infrastructure/notificationMessageBuilder.ts";
import type { Monitor } from "../src/types/monitor.ts";
import type { MonitorStatusResponse } from "../src/types/network.ts";
import type { MonitorActionDecision } from "../src/service/infrastructure/SuperSimpleQueue/SuperSimpleQueueHelper.ts";

const buildMonitor = (): Monitor => ({
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
	notifications: ["notif-1"],
	escalationEnabled: true,
	escalationSteps: [
		{ id: "step-15", afterMinutes: 15, notificationIds: ["notif-2"], label: "On-call" },
	],
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
});

describe("NotificationMessageBuilder escalation", () => {
	it("builds escalation message type and metadata", () => {
		const builder = new NotificationMessageBuilder();
		const monitor = buildMonitor();
		const statusResponse = {
			status: false,
			code: 503,
			message: "Service unavailable",
		} as MonitorStatusResponse;
		const decision: MonitorActionDecision = {
			shouldCreateIncident: false,
			shouldResolveIncident: false,
			shouldSendNotification: true,
			incidentReason: null,
			notificationReason: "escalation",
			escalation: {
				stepId: "step-15",
				afterMinutes: 15,
				label: "On-call",
				incidentId: "incident-1",
				incidentDurationMinutes: 17,
			},
		};

		const message = builder.buildMessage(monitor, statusResponse, decision, "https://checkmate.local");

		expect(message.type).toBe("incident_escalation");
		expect(message.severity).toBe("critical");
		expect(message.metadata.escalation?.stepId).toBe("step-15");
		expect(message.content.incident?.id).toBe("incident-1");
		expect(message.content.summary).toContain("17 minute");
	});
});
