import Monitor from "@/db/models/Monitor.js";
import Incident from "@/db/models/Incident.js";

async function addEscalationFields() {
	// Add escalation fields to existing monitors
	const monitors = await Monitor.find({});
	for (const monitor of monitors) {
		// Set default values for escalation fields if they don't exist
		if (monitor.escalationEnabled === undefined) {
			monitor.escalationEnabled = false;
		}
		if (monitor.escalationDelayMinutes === undefined) {
			monitor.escalationDelayMinutes = 30;
		}
		if (monitor.escalationNotifications === undefined) {
			monitor.escalationNotifications = [];
		}
		if (monitor.escalationMessage === undefined) {
			monitor.escalationMessage = "ESCALATION: Issue has persisted for {{minutes}} minutes without resolution.";
		}
		await monitor.save();
	}

	// Add escalation fields to existing incidents
	const incidents = await Incident.find({});
	for (const incident of incidents) {
		// Set default values for escalation fields if they don't exist
		if (incident.escalated === undefined) {
			incident.escalated = false;
		}
		if (incident.escalatedAt === undefined) {
			incident.escalatedAt = null;
		}
		if (incident.escalationLevel === undefined) {
			incident.escalationLevel = 0;
		}
		await incident.save();
	}
}

export { addEscalationFields };