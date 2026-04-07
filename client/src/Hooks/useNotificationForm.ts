import { useMemo } from "react";
import { notificationSchema } from "@/Validation/notifications";
import type { NotificationFormData } from "@/Validation/notifications";
import type { Notification } from "@/Types/Notification";

interface UseNotificationFormOptions {
	data?: Notification | null;
}

function buildDefaults(data: Notification | null): NotificationFormData {
	const commonDefaults = {
		notificationName: data?.notificationName || "",
		escalationMinutes: data?.escalationMinutes,
	};

	if (data?.type === "matrix") {
		return {
			type: "matrix",
			...commonDefaults,
			homeserverUrl: data.homeserverUrl || "",
			roomId: data.roomId || "",
			accessToken: data.accessToken || "",
		};
	}
	if (data?.type === "telegram") {
		return {
			type: "telegram",
			...commonDefaults,
			address: data.address || "",
			accessToken: data.accessToken || "",
		};
	}
	if (data?.type === "slack") {
		return {
			type: "slack",
			...commonDefaults,
			address: data.address || "",
		};
	}
	if (data?.type === "discord") {
		return {
			type: "discord",
			...commonDefaults,
			address: data.address || "",
		};
	}
	if (data?.type === "webhook") {
		return {
			type: "webhook",
			...commonDefaults,
			address: data.address || "",
		};
	}
	if (data?.type === "pager_duty") {
		return {
			type: "pager_duty",
			...commonDefaults,
			address: data.address || "",
		};
	}
	if (data?.type === "teams") {
		return {
			type: "teams",
			...commonDefaults,
			address: data.address || "",
		};
	}
	// Default: email (covers both data === null and data.type === "email")
	return {
		type: "email",
		...commonDefaults,
		address: data?.address || "",
	};
}

export const useNotificationForm = ({ data = null }: UseNotificationFormOptions = {}) => {
	return useMemo(() => {
		const defaults = buildDefaults(data);
		return { schema: notificationSchema, defaults };
	}, [data]);
};