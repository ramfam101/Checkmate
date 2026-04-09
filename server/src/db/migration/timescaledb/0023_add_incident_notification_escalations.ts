import type { Pool } from "pg";

export const addIncidentNotificationEscalations = async (pool: Pool) => {
	await pool.query(`
		ALTER TABLE incidents
		ADD COLUMN IF NOT EXISTS notification_escalations JSONB NOT NULL DEFAULT '{}'::jsonb;
	`);
};

export const dropIncidentNotificationEscalations = async (pool: Pool) => {
	await pool.query(`
		ALTER TABLE incidents
		DROP COLUMN IF EXISTS notification_escalations;
	`);
};