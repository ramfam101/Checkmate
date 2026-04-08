import Monitor from "@/db/models/Monitor.js";

async function addEscalationFieldsToMonitors() {
	// Add default escalation fields to all existing monitors
	await Monitor.updateMany(
		{
			escalationEnabled: { $exists: false }
		},
		{
			$set: {
				escalationEnabled: false,
				escalationDelay: 30,
				escalationNotifications: []
			}
		}
	);
}

export { addEscalationFieldsToMonitors };