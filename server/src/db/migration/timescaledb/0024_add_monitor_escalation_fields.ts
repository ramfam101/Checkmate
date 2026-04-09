import type { Pool } from "pg";

export const addMonitorEscalationFields = async (pool: Pool) => {
	await pool.query(`
		ALTER TABLE monitors
		ADD COLUMN IF NOT EXISTS escalation_minutes INTEGER[] NOT NULL DEFAULT '{}'::integer[],
		ADD COLUMN IF NOT EXISTS escalation_notification_ids UUID[] NOT NULL DEFAULT '{}'::uuid[];
	`);
};

export const dropMonitorEscalationFields = async (pool: Pool) => {
	await pool.query(`
		ALTER TABLE monitors
		DROP COLUMN IF EXISTS escalation_minutes,
		DROP COLUMN IF EXISTS escalation_notification_ids;
	`);
};
