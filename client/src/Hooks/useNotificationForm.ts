import { useMemo } from "react";
import { notificationSchema } from "@/Validation/notifications";
import type { Notification } from "@/Types/Notification";

interface UseNotificationFormOptions {
	data?: Notification | null;
}

export const useNotificationForm = ({ data = null }: UseNotificationFormOptions = {}) => {
	return useMemo(() => {
		const defaults =
			data?.type === "matrix"
				? {
						type: "matrix" as const,
						notificationName: data.notificationName || "",
						escalationMinutes: data.escalationMinutes || [],
						homeserverUrl: data.homeserverUrl || "",
						roomId: data.roomId || "",
						accessToken: data.accessToken || "",
					}
				: {
					type: data?.type || "email",
						notificationName: data?.notificationName || "",
						escalationMinutes: data?.escalationMinutes || [],
						address: data?.address || "",
					};

		return { schema: notificationSchema, defaults };
	}, [data]);
};
