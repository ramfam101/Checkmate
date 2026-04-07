import { useMemo } from "react";
import { notificationSchema } from "@/Validation/notifications";
import type { Notification } from "@/Types/Notification";

interface UseNotificationFormOptions {
	data?: Notification | null;
}

export const useNotificationForm = ({ data = null }: UseNotificationFormOptions = {}) => {
	return useMemo(() => {
		// Ensure escalation levels only has 1 item max
		const escalationWithOneLevel = data?.escalation
			? {
					enabled: data.escalation.enabled,
					levels: data.escalation.levels
						? [data.escalation.levels[0]]
						: [{ delayMinutes: 15, address: "" }],
				}
			: { enabled: false, levels: [{ delayMinutes: 15, address: "" }] };

		const defaults =
			data?.type === "matrix"
				? {
						type: "matrix" as const,
						notificationName: data.notificationName || "",
						homeserverUrl: data.homeserverUrl || "",
						roomId: data.roomId || "",
						accessToken: data.accessToken || "",
						escalation: escalationWithOneLevel,
					}
				: {
						type: (data?.type || "email") as Exclude<Notification["type"], "matrix">,
						notificationName: data?.notificationName || "",
						address: data?.address || "",
						escalation: escalationWithOneLevel,
					};

		return { schema: notificationSchema, defaults };
	}, [data]);
};
