import type { Pool } from "pg";

export const createMonitorEscalationFields = async (pool: Pool) => {
	await pool.query(`
		ALTER TABLE monitors
			ADD COLUMN IF NOT EXISTS escalation_minutes INTEGER DEFAULT 3,
			ADD COLUMN IF NOT EXISTS escalation_notifications UUID[];
	`);
};

export const dropMonitorEscalationFields = async (pool: Pool) => {
	await pool.query(`
		ALTER TABLE monitors
			DROP COLUMN IF EXISTS escalation_minutes,
			DROP COLUMN IF EXISTS escalation_notifications;
	`);
};