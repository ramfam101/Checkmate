export type NotificationEscalationRule = {
	notificationId: string;
	delayMinutes: number;
};

export function normalizeNotificationEscalations(input: unknown): NotificationEscalationRule[] {
	if (!input) return [];

	if (Array.isArray(input)) {
		return input
			.map((rule: any) => ({
				notificationId: String(rule?.notificationId ?? "").trim(),
				delayMinutes: Number(rule?.delayMinutes),
			}))
			.filter((rule) => rule.notificationId && Number.isFinite(rule.delayMinutes) && rule.delayMinutes >= 0);
	}

	const legacy = input as any;
	const ids = Array.isArray(legacy?.notificationIds) ? legacy.notificationIds : [];
	const delays = Array.isArray(legacy?.delayMinutes) ? legacy.delayMinutes : ids.map(() => legacy?.delayMinutes);

	return ids
		.map((id: any, idx: number) => ({
			notificationId: String(id ?? "").trim(),
			delayMinutes: Number(delays[idx]),
		}))
		.filter((rule) => rule.notificationId && Number.isFinite(rule.delayMinutes) && rule.delayMinutes >= 0);
}