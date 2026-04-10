const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'client', 'src', 'Components', 'monitors', 'EscalationRulesDialog.tsx');

const content = `import React, { useEffect, useState } from "react";
import {
	Dialog,
	DialogTitle,
	DialogContent,
	DialogActions,
	Button,
	Table,
	TableBody,
	TableCell,
	TableContainer,
	TableHead,
	TableRow,
	Paper,
	Select,
	MenuItem,
	TextField,
	Box,
	IconButton,
	Alert,
} from "@mui/material";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Notification } from "@/Types/Notification";

interface EscalationRule {
	notificationId: string;
	delayMinutes: number;
	escalationChannelId: string;
}

interface EscalationRulesDialogProps {
	open: boolean;
	onClose: () => void;
	currentEscalations: EscalationRule[];
	availableNotifications: Notification[];
	defaultSourceNotificationId?: string;
	onSave: (escalations: EscalationRule[]) => Promise<void>;
	loading?: boolean;
}

export const EscalationRulesDialog: React.FC<EscalationRulesDialogProps> = ({
	open,
	onClose,
	currentEscalations,
	availableNotifications,
	defaultSourceNotificationId = "",
	onSave,
	loading = false,
}) => {
	const { t } = useTranslation();
	const [escalations, setEscalations] = useState<EscalationRule[]>(currentEscalations);
	const [showAddForm, setShowAddForm] = useState(false);
	const [newRule, setNewRule] = useState<Partial<EscalationRule>>({
		delayMinutes: 15,
		notificationId: defaultSourceNotificationId,
		escalationChannelId: "",
	});
	const [errors, setErrors] = useState<Record<string, string>>({});

	useEffect(() => {
		if (!open) {
			resetNewRule();
			setShowAddForm(false);
		}
	}, [open]);

	useEffect(() => {
		if (!newRule.notificationId && defaultSourceNotificationId) {
			setNewRule((prev) => ({
				...prev,
				notificationId: defaultSourceNotificationId,
			}));
		}
	}, [defaultSourceNotificationId, newRule.notificationId]);

	const getNotificationName = (id: string): string => {
		return availableNotifications.find((n) => n.id === id)?.notificationName || id;
	};

	const escalationChannelOptions = availableNotifications;

	const validateRule = (rule: Partial<EscalationRule>): Record<string, string> => {
		const ruleErrors: Record<string, string> = {};

		if (!rule.notificationId) {
			ruleErrors.notificationId = "Source notification is required";
		}
		if (!rule.escalationChannelId) {
			ruleErrors.escalationChannelId = "Escalation channel is required";
		}
		if (!rule.delayMinutes || rule.delayMinutes < 1 || rule.delayMinutes > 1440) {
			ruleErrors.delayMinutes = "Delay must be between 1 and 1440 minutes";
		}

		const isDuplicate = escalations.some(
			(e) => 
				e.notificationId === rule.notificationId && 
				e.escalationChannelId === rule.escalationChannelId
		);
		if (isDuplicate) {
			ruleErrors.duplicate = "This escalation rule already exists";
		}

		return ruleErrors;
	};

	const resetNewRule = () => {
		setNewRule({ delayMinutes: 15, notificationId: defaultSourceNotificationId, escalationChannelId: "" });
		setErrors({});
	};

	const handleAddRule = () => {
		const ruleErrors = validateRule(newRule);
		if (Object.keys(ruleErrors).length > 0) {
			setErrors(ruleErrors);
			return;
		}
		setEscalations([...escalations, newRule as EscalationRule]);
		resetNewRule();
		setShowAddForm(false);
	};

	const handleDeleteRule = (index: number) => {
		setEscalations(escalations.filter((_, i) => i !== index));
	};

	const handleUpdateRule = (index: number, updates: Partial<EscalationRule>) => {
		const updated = [...escalations];
		updated[index] = { ...updated[index], ...updates };
		setEscalations(updated);
	};

	const handleSave = async () => {
		try {
			await onSave(escalations);
			onClose();
		} catch (error) {
			console.error("Failed to save escalations:", error);
		}
	};

	return (
		<Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
			<DialogTitle>
				{t("pages.monitor.escalations.title", "Notification Escalations")}
			</DialogTitle>
			<DialogContent sx={{ pt: 2 }}>
				<Box sx={{ mb: 2 }}>
					<Alert severity="info">
						{t(
							"pages.monitor.escalations.description",
							"Configure escalation rules to send alerts to additional channels if incidents remain unacknowledged"
						)}
					</Alert>
				</Box>

				{escalations.length === 0 && !showAddForm ? (
					<Alert severity="warning">
						{t("pages.monitor.escalations.noRules", "No escalation rules configured")}
					</Alert>
				) : (
					<TableContainer component={Paper} sx={{ mb: 2 }}>
						<Table size="small">
							<TableHead>
								<TableRow sx={{ backgroundColor: "#f5f5f5" }}>
									<TableCell>
										{t("pages.monitor.escalations.columns.notification", "Source Notification")}
									</TableCell>
									<TableCell align="center">
										{t("pages.monitor.escalations.columns.delay", "Delay (minutes)")}
									</TableCell>
									<TableCell>
										{t("pages.monitor.escalations.columns.escalationChannel", "Escalation Channel")}
									</TableCell>
									<TableCell align="center">
										{t("pages.monitor.escalations.columns.actions", "Actions")}
									</TableCell>
								</TableRow>
							</TableHead>
							<TableBody>
								{escalations.map((rule, index) => (
									<TableRow key={index}>
										<TableCell>{getNotificationName(rule.notificationId)}</TableCell>
										<TableCell align="center">
											<TextField
												type="number"
												size="small"
												inputProps={{ min: 1, max: 1440 }}
												value={rule.delayMinutes}
												onChange={(e) =>
													handleUpdateRule(index, {
														delayMinutes: parseInt(e.target.value),
													})
												}
												sx={{ width: 80 }}
											/>
										</TableCell>
										<TableCell>
											<Select
												size="small"
												value={rule.escalationChannelId}
												onChange={(e) =>
													handleUpdateRule(index, {
														escalationChannelId: e.target.value,
													})
												}
												sx={{ minWidth: 120 }}
											>
												{availableNotifications
													.filter((n) => n.id !== rule.notificationId)
													.map((notification) => (
														<MenuItem key={notification.id} value={notification.id}>
															{notification.notificationName}
														</MenuItem>
													))}
											</Select>
										</TableCell>
										<TableCell align="center">
											<IconButton
												size="small"
												color="error"
												onClick={() => handleDeleteRule(index)}
											>
												<Trash2 size={16} />
											</IconButton>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</TableContainer>
				)}

				{showAddForm && (
					<Box sx={{ p: 2, border: "1px solid #ddd", borderRadius: 1, mb: 2 }}>
						{errors.duplicate && (
							<Alert severity="error" sx={{ mb: 2 }}>
								{errors.duplicate}
							</Alert>
						)}

						{!defaultSourceNotificationId ? (
							<Alert severity="warning" sx={{ mb: 2 }}>
								{t(
									"pages.monitor.escalations.noSourceNotification",
									"Add a notification channel to this monitor before configuring escalations."
								)}
							</Alert>
						) : null}

						<TextField
							fullWidth
							type="number"
							label={t("pages.monitor.escalations.columns.delay", "Delay (minutes)")}
							size="small"
							inputProps={{ min: 1, max: 1440 }}
							value={newRule.delayMinutes}
							onChange={(e) => setNewRule({ ...newRule, delayMinutes: parseInt(e.target.value) })}
							error={!!errors.delayMinutes}
							helperText={errors.delayMinutes}
							sx={{ mb: 2 }}
						/>

						<Select
							fullWidth
							size="small"
							displayEmpty
							value={newRule.escalationChannelId || ""}
							onChange={(e) => setNewRule({ ...newRule, escalationChannelId: e.target.value })}
							error={!!errors.escalationChannelId}
							sx={{ mb: 2 }}
						>
							<MenuItem value="">
								{t("pages.monitor.escalations.columns.escalationChannel", "Select Escalation Channel")}
							</MenuItem>
							{escalationChannelOptions.map((notification) => (
								<MenuItem key={notification.id} value={notification.id}>
									{notification.notificationName}
								</MenuItem>
							))}
						</Select>

						{escalationChannelOptions.length === 0 ? (
							<Alert severity="info" sx={{ mb: 2 }}>
								{t(
									"pages.monitor.escalations.noEscalationChannels",
									"Add another notification channel before saving an escalation rule."
								)}
							</Alert>
						) : null}

						<Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
							<Button
								variant="outlined"
								onClick={() => {
									resetNewRule();
									setShowAddForm(false);
								}}
							>
								{t("common.cancel", "Cancel")}
							</Button>
							<Button variant="contained" onClick={handleAddRule}>
								{t("pages.monitor.escalations.addRule", "Add Escalation Rule")}
							</Button>
						</Box>
					</Box>
				)}

				{!showAddForm && (
					<Box sx={{ mb: 2 }}>
						<Button
							variant="outlined"
							fullWidth
							onClick={() => {
								resetNewRule();
								setShowAddForm(true);
							}}
						>
							{t("pages.monitor.escalations.addRule", "Add Escalation Rule")}
						</Button>
					</Box>
				)}
			</DialogContent>

			<DialogActions>
				<Button onClick={onClose}>{t("common.cancel", "Cancel")}</Button>
				<Button onClick={handleSave} variant="contained" disabled={loading}>
					{loading ? t("common.saving", "Saving...") : t("common.save", "Save")}
				</Button>
			</DialogActions>
		</Dialog>
	);
};

export default EscalationRulesDialog;
`;

fs.writeFileSync(filePath, content, 'utf-8');
console.log('✓ File fixed successfully!');
