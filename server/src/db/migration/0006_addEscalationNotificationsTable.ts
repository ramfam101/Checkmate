// Migration 0006: Add escalation_notifications collection
// This migration ensures the EscalationNotification collection exists
// MongoDB creates collections automatically on first insert, so this is primarily
// for migration tracking purposes

async function addEscalationNotificationsTable() {
	// No action needed - collection will be created automatically by Mongoose
	// when the EscalationNotification model is first used
}

export { addEscalationNotificationsTable };