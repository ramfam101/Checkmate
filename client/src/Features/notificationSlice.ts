import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { Notification, NotificationEscalationConfig } from "@/Types/Notification";

interface NotificationState {
	notifications: Notification[];
	selectedNotification: Notification | null;
	escalationNotifications: Notification[];
	loading: boolean;
	error: string | null;
}

const initialState: NotificationState = {
	notifications: [],
	selectedNotification: null,
	escalationNotifications: [],
	loading: false,
	error: null,
};

const notificationSlice = createSlice({
	name: "notification",
	initialState,
	reducers: {
		setNotifications: (state, action: PayloadAction<Notification[]>) => {
			state.notifications = action.payload;
		},
		setSelectedNotification: (state, action: PayloadAction<Notification | null>) => {
			state.selectedNotification = action.payload;
		},
		updateNotificationEscalation: (
			state,
			action: PayloadAction<{
				notificationId: string;
				escalationConfig: NotificationEscalationConfig;
			}>
		) => {
			const notification = state.notifications.find((n) => n.id === action.payload.notificationId);
			if (notification) {
				notification.escalationConfig = action.payload.escalationConfig;
			}
		},
		setEscalationNotifications: (state, action: PayloadAction<Notification[]>) => {
			state.escalationNotifications = action.payload;
		},
		setLoading: (state, action: PayloadAction<boolean>) => {
			state.loading = action.payload;
		},
		setError: (state, action: PayloadAction<string | null>) => {
			state.error = action.payload;
		},
		addNotification: (state, action: PayloadAction<Notification>) => {
			state.notifications.push(action.payload);
		},
		removeNotification: (state, action: PayloadAction<string>) => {
			state.notifications = state.notifications.filter((n) => n.id !== action.payload);
		},
		updateNotification: (state, action: PayloadAction<Notification>) => {
			const index = state.notifications.findIndex((n) => n.id === action.payload.id);
			if (index !== -1) {
				state.notifications[index] = action.payload;
			}
		},
	},
});

export const {
	setNotifications,
	setSelectedNotification,
	updateNotificationEscalation,
	setEscalationNotifications,
	setLoading,
	setError,
	addNotification,
	removeNotification,
	updateNotification,
} = notificationSlice.actions;

export default notificationSlice.reducer;