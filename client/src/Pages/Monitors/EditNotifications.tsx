import React, { useState, useEffect } from "react";
import EscalationConfig from "../../Components/EscalationConfig";
import NotificationAPI from "../../Utils/NotificationAPI.ts";
import ChannelAPI from "../../Utils/ChannelAPI.ts";

export default function EditNotifications({ monitorId }: { monitorId: string }) {
	const [notification, setNotification] = useState<any>(null);
	const [channels, setChannels] = useState<{ id: string; name: string }[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let mounted = true;
		Promise.all([NotificationAPI.getForMonitor(monitorId), ChannelAPI.list()])
			.then(([notifRes, ch]) => {
				if (!mounted) return;
				const notif = Array.isArray(notifRes)
					? (notifRes[0] ?? null)
					: (notifRes ?? null);
				setNotification(notif);
				setChannels(ch ?? []);
			})
			.finally(() => mounted && setLoading(false));
		return () => {
			mounted = false;
		};
	}, [monitorId]);

	if (loading) return <div>Loading...</div>;

	const handleSave = async () => {
		if (!notification) return;
		if (notification._id) {
			await NotificationAPI.update(notification._id, notification);
		} else {
			// ensure monitorId and teamId/required fields are present as your API expects
			await NotificationAPI.create({ ...notification, monitorId });
		}
		// refresh
		const notifRes = await NotificationAPI.getForMonitor(monitorId);
		const notif = Array.isArray(notifRes) ? (notifRes[0] ?? null) : (notifRes ?? null);
		setNotification(notif);
	};

	return (
		<div>
			<h3>Notification Configuration</h3>
			{!notification ? (
				<div>
					<p>No notification configured for this monitor.</p>
					<button
						onClick={() =>
							setNotification({
								notificationName: "",
								type: "slack",
								address: "",
								escalations: [],
							})
						}
					>
						Create notification
					</button>
				</div>
			) : (
				<form
					onSubmit={async (e) => {
						e.preventDefault();
						await handleSave();
					}}
				>
					<div style={{ marginBottom: 8 }}>
						<label>Name</label>
						<br />
						<input
							value={notification.notificationName ?? ""}
							onChange={(e) =>
								setNotification({ ...notification, notificationName: e.target.value })
							}
						/>
					</div>

					<div style={{ marginBottom: 8 }}>
						<label>Type</label>
						<br />
						<select
							value={notification.type ?? "slack"}
							onChange={(e) => setNotification({ ...notification, type: e.target.value })}
						>
							<option value="slack">Slack</option>
							<option value="webhook">Webhook</option>
							<option value="email">Email</option>
							<option value="discord">Discord</option>
							<option value="pager_duty">PagerDuty</option>
							<option value="matrix">Matrix</option>
							<option value="teams">Teams</option>
							<option value="telegram">Telegram</option>
						</select>
					</div>

					<div style={{ marginBottom: 8 }}>
						<label>Address / Webhook / Channel ID</label>
						<br />
						<input
							value={notification.address ?? ""}
							onChange={(e) =>
								setNotification({ ...notification, address: e.target.value })
							}
						/>
					</div>

					{/* Escalation rules */}
					<EscalationConfig
						value={notification.escalations || []}
						onChange={(v) => setNotification({ ...notification, escalations: v })}
						availableChannels={channels}
					/>

					<div style={{ marginTop: 12 }}>
						<button type="submit">Save</button>
					</div>
				</form>
			)}
		</div>
	);
}
