import { useState } from "react";
import { useTheme } from "@mui/material";
import Stack from "@mui/material/Stack";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Divider from "@mui/material/Divider";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import { Trash2, Plus } from "lucide-react";
import { useFieldArray, type Control } from "react-hook-form";
import type { Notification } from "@/Types/Notification";
import type { MonitorEscalation } from "@/Types/Monitor";
import type { MonitorFormData } from "@/Validation/monitor";
import { LAYOUT } from "@/Utils/Theme/constants";

interface EscalationConfigProps {
	notifications: Notification[];
	control: Control<MonitorFormData>;
}

export const EscalationConfig = ({ notifications, control }: EscalationConfigProps) => {
	const theme = useTheme();
	const { fields, append,  remove } = useFieldArray({
		control,
		name: "escalations",
	});

	const [newDelay, setNewDelay] = useState<number>(15);
	const [newChannelId, setNewChannelId] = useState<string>("");

	const emailNotifications = notifications.filter((n) => n.type === "email");

	const handleAddEscalation = () => {
		if (!newChannelId) return;

		console.log("[DEBUG EscalationConfig] Adding escalation:", { delayMinutes: newDelay, channelId: newChannelId });
		append({
			delayMinutes: newDelay,
			channelId: newChannelId,
		} as MonitorEscalation);

		// Reset form
		setNewDelay(15);
		setNewChannelId("");
	};

	const delayOptions = [
		{ value: 5, label: "5 minutes" },
		{ value: 10, label: "10 minutes" },
		{ value: 15, label: "15 minutes" },
		{ value: 30, label: "30 minutes" },
		{ value: 60, label: "1 hour" },
		{ value: 120, label: "2 hours" },
		{ value: 240, label: "4 hours" },
		{ value: 480, label: "8 hours" },
		{ value: 1440, label: "24 hours" },
	];

	return (
		<Stack spacing={theme.spacing(LAYOUT.MD)}>
			{/* Help Text */}
			<Typography variant="body2" color="textSecondary">
				📧 Configure escalation rules: if an incident remains unacknowledged after the delay,
				automatically send notifications to your email channels.
			</Typography>

			{/* Add New Escalation Form */}
			<Card variant="outlined">
				<CardContent>
					<Stack spacing={theme.spacing(LAYOUT.SM)}>
						<Typography variant="subtitle2">Add Escalation Rule</Typography>

						<Stack
							direction={{ xs: "column", sm: "row" }}
							spacing={theme.spacing(LAYOUT.SM)}
						>
							<FormControl sx={{ minWidth: 150 }}>
								<InputLabel id="delay-label">Delay</InputLabel>
								<Select
									labelId="delay-label"
									id="delay-select"
									value={newDelay}
									onChange={(e) => setNewDelay(Number(e.target.value))}
									label="Delay"
									size="small"
								>
									{delayOptions.map((opt) => (
										<MenuItem key={opt.value} value={opt.value}>
											{opt.label}
										</MenuItem>
									))}
								</Select>
							</FormControl>

							<FormControl sx={{ flex: 1, minWidth: 200 }}>
								<InputLabel id="channel-label">Email Channel</InputLabel>
								<Select
									labelId="channel-label"
									id="channel-select"
									value={newChannelId}
									onChange={(e) => setNewChannelId(e.target.value)}
									label="Email Channel"
									size="small"
								>
									<MenuItem value="">Select email channel...</MenuItem>
									{emailNotifications.map((notif) => (
										<MenuItem key={notif.id} value={notif.id}>
											{notif.notificationName} ({notif.address})
										</MenuItem>
									))}
								</Select>
							</FormControl>

							<Button
								variant="contained"
								startIcon={<Plus size={18} />}
								onClick={handleAddEscalation}
								disabled={!newChannelId}
								sx={{ whiteSpace: "nowrap" }}
							>
								Add
							</Button>
						</Stack>

						{emailNotifications.length === 0 && (
							<Typography variant="caption" color="warning.main">
								⚠️ No email notification channels configured. Please create one first.
							</Typography>
						)}
					</Stack>
				</CardContent>
			</Card>

			{/* Escalation Rules List */}
			{fields.length > 0 ? (
				<Card variant="outlined">
					<CardContent>
						<Stack spacing={theme.spacing(LAYOUT.SM)}>
							<Typography variant="subtitle2">Active Rules ({fields.length})</Typography>

							{fields.map((field, index) => {
								const escalation = field as unknown as MonitorEscalation & { id: string };
								const channel = notifications.find((n) => n.id === escalation.channelId);
								const delayLabel =
									delayOptions.find((d) => d.value === escalation.delayMinutes)?.label ||
									`${escalation.delayMinutes} minutes`;

								return (
									<Stack key={field.id}>
										<Stack
											direction="row"
											alignItems="center"
											justifyContent="space-between"
											px={theme.spacing(LAYOUT.SM)}
											py={theme.spacing(LAYOUT.SM)}
										>
											<Stack flex={1}>
												<Typography variant="body2">
													<strong>After {delayLabel}:</strong> Send to{" "}
													{channel?.notificationName || "Unknown Channel"}
												</Typography>
												<Typography variant="caption" color="textSecondary">
													{channel?.address || "No address"}
												</Typography>
											</Stack>

											<IconButton
												size="small"
												onClick={() => remove(index)}
												aria-label="Remove escalation"
												color="error"
											>
												<Trash2 size={16} />
											</IconButton>
										</Stack>

										{index < fields.length - 1 && <Divider />}
									</Stack>
								);
							})}
						</Stack>
					</CardContent>
				</Card>
			) : (
				<Card variant="outlined" sx={{ p: 2, textAlign: "center" }}>
					<Typography variant="body2" color="textSecondary">
						No escalation rules yet. Add one above to get started.
					</Typography>
				</Card>
			)}
		</Stack>
	);
};

export default EscalationConfig;
