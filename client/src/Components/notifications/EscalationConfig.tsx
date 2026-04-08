import React, { useState, useEffect } from "react";
import {
	Box,
	Card,
	CardContent,
	FormControlLabel,
	Checkbox,
	TextField,
	Select,
	MenuItem,
	FormControl,
	FormHelperText,
	Grid,
	Typography,
	Alert,
} from "@mui/material";
import { Notification, NotificationEscalationConfig } from "@/Types/Notification";

interface EscalationConfigProps {
	notification: Notification | null;
	availableNotifications: Notification[];
	onEscalationChange: (escalationConfig: NotificationEscalationConfig) => void;
}

export const EscalationConfig: React.FC<EscalationConfigProps> = ({
	notification,
	availableNotifications,
	onEscalationChange,
}) => {
	const [enabled, setEnabled] = useState(
		notification?.escalationConfig?.enabled || false
	);
	const [delayMinutes, setDelayMinutes] = useState(
		notification?.escalationConfig?.delayMinutes || 15
	);
	const [escalationChannelId, setEscalationChannelId] = useState(
		notification?.escalationConfig?.escalationChannelId || ""
	);

	useEffect(() => {
		onEscalationChange({
			enabled,
			delayMinutes,
			escalationChannelId: escalationChannelId || undefined,
		});
	}, [enabled, delayMinutes, escalationChannelId, onEscalationChange]);

	const otherNotifications = availableNotifications.filter(
		(n) => n.id !== notification?.id
	);
	const hasValidEscalationChannel = enabled && escalationChannelId;

	return (
		<Card
			variant="outlined"
			sx={{ mt: 3, bgcolor: "background.paper" }}
		>
			<CardContent>
				<Box sx={{ mb: 2 }}>
					<Typography
						variant="h6"
						sx={{ mb: 1 }}
					>
						Notification Escalation
					</Typography>
					<FormControlLabel
						control={
							<Checkbox
								checked={enabled}
								onChange={(e) => setEnabled(e.target.checked)}
							/>
						}
						label="Enable Escalation"
					/>
					<FormHelperText>
						Automatically escalate to a secondary notification channel if an incident
						remains unacknowledged
					</FormHelperText>
				</Box>

				{enabled && (
					<>
						{!hasValidEscalationChannel && (
							<Alert
								severity="warning"
								sx={{ mb: 2 }}
							>
								Please configure an escalation channel
							</Alert>
						)}

						<Grid
							container
							spacing={2}
						>
							<Grid
								item
								xs={12}
								sm={6}
							>
								<TextField
									type="number"
									label="Escalation Delay (minutes)"
									value={delayMinutes}
									onChange={(e) =>
										setDelayMinutes(Math.max(1, parseInt(e.target.value) || 15))
									}
									inputProps={{ min: 1, max: 1440 }}
									fullWidth
									helperText="Time to wait before escalating (1-1440 minutes)"
								/>
							</Grid>
							<Grid
								item
								xs={12}
								sm={6}
							>
								<FormControl
									fullWidth
									error={enabled && !escalationChannelId}
								>
									<Select
										value={escalationChannelId}
										onChange={(e) => setEscalationChannelId(e.target.value)}
										displayEmpty
									>
										<MenuItem value="">
											<em>Select escalation channel...</em>
										</MenuItem>
										{otherNotifications.map((notif) => (
											<MenuItem
												key={notif.id}
												value={notif.id}
											>
												{notif.notificationName} ({notif.type})
											</MenuItem>
										))}
									</Select>
									<FormHelperText>
										{enabled && !escalationChannelId
											? "Escalation channel is required when escalation is enabled"
											: "The notification to send when escalation is triggered"}
									</FormHelperText>
								</FormControl>
							</Grid>

							{otherNotifications.length === 0 && (
								<Grid
									item
									xs={12}
								>
									<Alert severity="info">
										Create additional notifications to enable escalation functionality
									</Alert>
								</Grid>
							)}

							<Grid
								item
								xs={12}
							>
								<Box sx={{ p: 2, bgcolor: "background.default", borderRadius: 1 }}>
									<Typography
										variant="caption"
										color="textSecondary"
									>
										Example: If no one acknowledges this incident within {delayMinutes}{" "}
										minutes, an escalation notification will be sent to{" "}
										{escalationChannelId
											? otherNotifications.find((n) => n.id === escalationChannelId)
													?.notificationName
											: "the selected channel"}
										.
									</Typography>
								</Box>
							</Grid>
						</Grid>
					</>
				)}
			</CardContent>
		</Card>
	);
};
