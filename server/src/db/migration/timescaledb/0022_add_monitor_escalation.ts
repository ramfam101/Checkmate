import type { Pool } from "pg";

export const addMonitorEscalation = async (pool: Pool) => {
	await pool.query(`
		ALTER TABLE monitors
		ADD COLUMN IF NOT EXISTS escalation JSONB,
		ADD COLUMN IF NOT EXISTS last_status_change_at TIMESTAMPTZ;
	`);
};

export const dropMonitorEscalation = async (pool: Pool) => {
	await pool.query(`
		ALTER TABLE monitors
		DROP COLUMN IF EXISTS escalation,
		DROP COLUMN IF EXISTS last_status_change_at;
	`);
};
