import { describe, expect, it } from "@jest/globals";
import { createMonitorBodyValidation, editMonitorBodyValidation } from "../src/validation/monitorValidation.ts";

describe("monitor escalation validation", () => {
	it("rejects create payload when escalations are enabled with no steps", () => {
		const payload = {
			name: "Ping monitor",
			type: "ping",
			url: "example.com",
			escalationEnabled: true,
			escalationSteps: [],
		};

		expect(() => createMonitorBodyValidation.parse(payload)).toThrow("Escalation steps are required");
	});

	it("accepts edit payload with ordered escalation steps", () => {
		const payload = {
			escalationEnabled: true,
			escalationSteps: [
				{ id: "step-1", afterMinutes: 15, notificationIds: ["n1"] },
				{ id: "step-2", afterMinutes: 30, notificationIds: ["n2"] },
			],
		};

		const parsed = editMonitorBodyValidation.parse(payload);
		expect(parsed.escalationSteps?.length).toBe(2);
	});
});
