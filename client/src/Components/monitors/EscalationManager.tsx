import { useState, useEffect } from "react";
import { Stack, TextField, IconButton, Box, Typography, Select as MuiSelect, MenuItem, Divider } from "@mui/material";
import { Trash2, Plus, Edit2, Check, X } from "lucide-react";
import type { Monitor } from "@/Types/Monitor";
import type { Notification } from "@/Types/Notification";
import { Icon } from "@/Components/design-elements";
import { Button } from "@/Components/inputs";
import { post, deleteOp } from "@/Utils/ApiClient";

interface EscalationManagerProps {
	monitor: Monitor;
	allNotifications: Notification[];
	onUpdate: () => Promise<void>;
}

export const EscalationManager = ({
	monitor,
	allNotifications,
	onUpdate,
}: EscalationManagerProps) => {
	const [isLoading, setIsLoading] = useState(false);
	const [delayMinutes, setDelayMinutes] = useState("");
	const [selectedEscalationId, setSelectedEscalationId] = useState("");
	const [editingIndex, setEditingIndex] = useState<number | null>(null);
	const [editEntryId, setEditEntryId] = useState<string | null>(null);
	const [editDelayMinutes, setEditDelayMinutes] = useState("");
	const [editEscalationId, setEditEscalationId] = useState("");
	const [localEscalations, setLocalEscalations] = useState(monitor.notificationEscalations || []);

	// Update local escalations when monitor prop changes
	useEffect(() => {
		setLocalEscalations(monitor.notificationEscalations || []);
	}, [monitor.notificationEscalations]);

	// Get notification name by ID
	const getNotificationName = (id: string) => {
		return allNotifications.find((n) => n.id === id)?.notificationName || id;
	};

	const handleAddEscalation = async () => {
		const delay = parseInt(delayMinutes);
		const baseNotificationId = monitor.notifications?.[0];
		if (!selectedEscalationId || !delay || delay < 1 || !baseNotificationId) {
			return;
		}

		setIsLoading(true);

		try {
			await post("/monitors/escalation", {
				monitorId: monitor.id,
				notificationId: baseNotificationId,
				delayMinutes: delay,
				escalationChannelId: selectedEscalationId,
			});

			// Wait a moment then refetch
			await new Promise((resolve) => setTimeout(resolve, 300));
			await onUpdate();

			setDelayMinutes("");
			setSelectedEscalationId("");
		} catch (err) {
			console.error("Failed to add escalation:", err);
		} finally {
			setIsLoading(false);
		}
	};

	const handleStartEdit = (index: number, escalation: any) => {
		setEditingIndex(index);
		setEditEntryId(escalation.id ?? null);
		setEditDelayMinutes(escalation.delayMinutes.toString());
		setEditEscalationId(escalation.escalationChannelId);
	};

	const handleSaveEdit = async (notificationId: string) => {
		const delay = parseInt(editDelayMinutes);
		if (!editEscalationId || !delay || delay < 1 || !editEntryId) {
			return;
		}

		setIsLoading(true);

		try {
			await post("/monitors/escalation", {
				monitorId: monitor.id,
				notificationId: notificationId,
				delayMinutes: delay,
				escalationChannelId: editEscalationId,
				escalationId: editEntryId,
			});

			// Wait a moment then refetch
			await new Promise((resolve) => setTimeout(resolve, 300));
			await onUpdate();
			setEditingIndex(null);
			setEditDelayMinutes("");
			setEditEscalationId("");
			setEditEntryId(null);
		} catch (err) {
			console.error("Failed to save edit:", err);
		} finally {
			setIsLoading(false);
		}
	};

	const handleCancelEdit = () => {
		setEditingIndex(null);
		setEditDelayMinutes("");
		setEditEscalationId("");
	};

	const handleRemoveEscalation = async (escalationId: string) => {
		setIsLoading(true);

		try {
			await deleteOp("/monitors/escalation", {
				data: {
					monitorId: monitor.id,
					escalationId,
				},
			});

			// Wait a moment then refetch
			await new Promise((resolve) => setTimeout(resolve, 300));
			await onUpdate();
		} catch (err) {
			console.error("Failed to delete escalation:", err);
		} finally {
			setIsLoading(false);
		}
	};

	return (
		<Box sx={{ mb: 4 }}>
			<Typography variant="h6" sx={{ mb: 2, fontWeight: 600 }}>
				Notification Escalations
			</Typography>

			{/* Add escalation form */}
			<Box sx={{ mb: 3, backgroundColor: 'background.paper', borderRadius: 1.5, p: 2.5, border: '1px solid', borderColor: 'divider' }}>
				<Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
					{/* Left: description block */}
					<Box sx={{ flex: 1 }}>
						<Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
							Escalation rule
						</Typography>
						<Typography variant="body2" color="textSecondary" sx={{ mt: 0.5 }}>
							Escalate to another notification channel if the incident remains unacknowledged for the specified number of minutes.
						</Typography>
					</Box>

					{/* Right: controls block */}
					<Box sx={{ minWidth: 420, display: 'flex', gap: 12, alignItems: 'flex-end', justifyContent: 'flex-end' }}>
						<TextField
							type="number"
							label="Minutes"
							value={delayMinutes}
							onChange={(e) => setDelayMinutes(e.target.value)}
							inputProps={{ min: 1, max: 1440 }}
							disabled={isLoading}
							size="small"
							sx={{ width: 110 }}
						/>

						<MuiSelect
							value={selectedEscalationId}
							onChange={(e) => setSelectedEscalationId(e.target.value)}
							displayEmpty
							disabled={isLoading}
							size="small"
							sx={{ minWidth: 320 }}
						>
							<MenuItem value="">Select email to escalate to</MenuItem>
							{allNotifications.map((notif) => (
								<MenuItem key={notif.id} value={notif.id}>
									{notif.notificationName}
								</MenuItem>
							))}
						</MuiSelect>

						<Button
							startIcon={<Icon icon={Plus} size={18} />}
							onClick={handleAddEscalation}
							disabled={isLoading || !delayMinutes || !selectedEscalationId || !(monitor.notifications?.[0])}
							variant="contained"
							size="small"
						>
							Add
						</Button>
					</Box>
				</Box>
			</Box>

			{/* List of escalations */}
			{localEscalations.length > 0 && (
				<Box sx={{ backgroundColor: 'background.paper', borderRadius: 1.5, p: 2.5, border: '1px solid', borderColor: 'divider' }}>
					{localEscalations.map((escalation, index) => (
						<Box key={escalation.id ?? `${escalation.notificationId}-${index}`}>
							{editingIndex === index ? (
								// Edit mode
								<Stack direction="row" spacing={1.5} alignItems="flex-end" sx={{ py: 2 }}>
									<TextField
										type="number"
										label="Minutes"
										value={editDelayMinutes}
										onChange={(e) => setEditDelayMinutes(e.target.value)}
										inputProps={{ min: 1, max: 1440 }}
										disabled={isLoading}
										size="small"
										sx={{ width: 110 }}
									/>
									<MuiSelect
										value={editEscalationId}
										onChange={(e) => setEditEscalationId(e.target.value)}
										disabled={isLoading}
										size="small"
										sx={{ flex: 1, minWidth: 200 }}
									>
										{allNotifications.map((notif) => (
											<MenuItem key={notif.id} value={notif.id}>
												{notif.notificationName}
											</MenuItem>
										))}
									</MuiSelect>
									<IconButton
										size="small"
										onClick={() => handleSaveEdit(escalation.notificationId)}
										disabled={isLoading}
										color="success"
										sx={{ p: 0.75 }}
									>
										<Icon icon={Check} size={18} />
									</IconButton>
									<IconButton
										size="small"
										onClick={handleCancelEdit}
										disabled={isLoading}
										color="error"
										sx={{ p: 0.75 }}
									>
										<Icon icon={X} size={18} />
									</IconButton>
								</Stack>
							) : (
								// View mode
								<Stack
									direction="row"
									alignItems="center"
									justifyContent="space-between"
									sx={{
										py: 1.5,
										px: 1,
										borderRadius: 1,
										"&:hover": {
											backgroundColor: "#ffffff",
										},
										transition: "background-color 0.2s",
									}}
								>
									<Typography variant="body2" sx={{ color: 'text.primary' }}> 
										After <strong>{escalation.delayMinutes}</strong> minute{escalation.delayMinutes !== 1 ? "s" : ""}{" "}
										→ escalate to <strong>{getNotificationName(escalation.escalationChannelId)}</strong>
									</Typography>
									<Stack direction="row" spacing={0.5}>
										<IconButton
											size="small"
											onClick={() => handleStartEdit(index, escalation)}
											disabled={isLoading}
											sx={{ p: 0.75, color: "primary.main" }}
										>
											<Icon icon={Edit2} size={16} />
										</IconButton>
										<IconButton
											size="small"
											onClick={() => handleRemoveEscalation(escalation.id ?? escalation.notificationId)}
											disabled={isLoading}
											sx={{ p: 0.75, color: "error.main" }}
										>
											<Icon icon={Trash2} size={16} />
										</IconButton>
									</Stack>
								</Stack>
							)}
							{index < localEscalations.length - 1 && <Divider sx={{ my: 0.5 }} />}
						</Box>
					))}
				</Box>
			)}

			{localEscalations.length === 0 && (
				<Typography variant="body2" color="textSecondary" sx={{ fontStyle: "italic", py: 1 }}>
					No escalation rules configured
				</Typography>
			)}
		</Box>
	);
};
