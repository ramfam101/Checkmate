import type { Pool } from "pg";

export const addNotificationEscalationMinutes = async (pool: Pool) => {
	await pool.query(`
		ALTER TABLE notifications
		ADD COLUMN IF NOT EXISTS escalation_minutes INTEGER[] NOT NULL DEFAULT '{}'::integer[];
	`);
};

export const dropNotificationEscalationMinutes = async (pool: Pool) => {
	await pool.query(`
		ALTER TABLE notifications
		DROP COLUMN IF EXISTS escalation_minutes;
	`);
};