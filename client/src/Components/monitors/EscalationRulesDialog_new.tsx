import React, { useState } from "react";
import {
	Box,
	Button,
	TextField,
	Select,
	MenuItem,
	IconButton,
	Stack,
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
	onSave: (escalations: EscalationRule[]) => Promise<void>;
	loading?: boolean;
}

export const EscalationRulesDialog: React.FC<EscalationRulesDialogProps> = ({
	open,
	onClose,
	currentEscalations,
	availableNotifications,
	onSave,
	loading = false,
}) => {
	const { t } = useTranslation();
	const [escalations, setEscalations] = useState<EscalationRule[]>(currentEscalations);
	const [delayMinutes, setDelayMinutes] = useState<number>(3);
	const [escalationChannelId, setEscalationChannelId] = useState<string>("");

	if (!open) return null;

	const handleAddRule = () => {
		if (!escalationChannelId || availableNotifications.length === 0) {
			return;
		}
		
		const newRule: EscalationRule = {
			notificationId: availableNotifications[0]?.id || "",
			delayMinutes,
			escalationChannelId,
		};
		
		setEscalations([...escalations, newRule]);
		setDelayMinutes(3);
		setEscalationChannelId("");
	};

	const handleDeleteRule = (index: number) => {
		setEscalations(escalations.filter((_, i) => i !== index));
	};

	const handleSave = async () => {
		try {
			await onSave(escalations);
			onClose();
		} catch (error) {
			console.error("Failed to save escalations:", error);
		}
	};

	const getNotificationName = (id: string): string => {
		return availableNotifications.find((n) => n.id === id)?.notificationName || id;
	};

	return (
		<Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
			{/* Current Escalation Rules */}
			{escalations.length > 0 && (
				<Box>
					{escalations.map((rule, index) => (
						<Box
							key={index}
							sx={{
								display: "flex",
								alignItems: "center",
								gap: 2,
								mb: 2,
								p: 2,
								border: "1px solid #ddd",
								borderRadius: 1,
							}}
						>
							<Box sx={{ flex: 1 }}>
								<div style={{ fontSize: "14px", marginBottom: "8px" }}>
									<strong>{t("pages.monitor.escalations.columns.notification", "Source:")}</strong> {getNotificationName(rule.notificationId)}
								</div>
								<div style={{ fontSize: "14px", marginBottom: "8px" }}>
									<strong>{t("pages.monitor.escalations.columns.delay", "Delay:")} </strong> {rule.delayMinutes} {t("common.minutes", "minutes")}
								</div>
								<div style={{ fontSize: "14px" }}>
									<strong>{t("pages.monitor.escalations.columns.escalationChannel", "Escalate to:")} </strong> {getNotificationName(rule.escalationChannelId)}
								</div>
							</Box>
							<IconButton
								size="small"
								color="error"
								onClick={() => handleDeleteRule(index)}
							>
								<Trash2 size={18} />
							</IconButton>
						</Box>
					))}
				</Box>
			)}

			{/* Add New Rule Form */}
			<Box sx={{ p: 2, border: "1px solid #ddd", borderRadius: 1, backgroundColor: "#fafafa" }}>
				<Stack spacing={2}>
					<div>
						<label style={{ display: "block", fontSize: "14px", fontWeight: 500, marginBottom: "8px" }}>
							{t("pages.monitor.escalations.columns.delay", "Escalate after (minutes)")}
						</label>
						<TextField
							type="number"
							size="small"
							fullWidth
							inputProps={{ min: 1, max: 1440 }}
							value={delayMinutes}
							onChange={(e) => setDelayMinutes(parseInt(e.target.value) || 3)}
						/>
					</div>

					<div>
						<label style={{ display: "block", fontSize: "14px", fontWeight: 500, marginBottom: "8px" }}>
							{t("pages.monitor.escalations.columns.escalationChannel", "Escalation notification channels")}
						</label>
						<Select
							fullWidth
							displayEmpty
							size="small"
							value={escalationChannelId}
							onChange={(e) => setEscalationChannelId(e.target.value)}
						>
							<MenuItem value="">
								{t("common.typeToSearch", "Type to search")}
							</MenuItem>
							{availableNotifications.map((notification) => (
								<MenuItem key={notification.id} value={notification.id}>
									{notification.notificationName}
								</MenuItem>
							))}
						</Select>
					</div>

					<Button
						variant="contained"
						onClick={handleAddRule}
						disabled={!escalationChannelId}
					>
						{t("pages.monitor.escalations.addRule", "Add Escalation Rule")}
					</Button>
				</Stack>
			</Box>

			{/* Action Buttons */}
			<Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
				<Button variant="outlined" onClick={onClose}>
					{t("common.cancel", "Cancel")}
				</Button>
				<Button
					variant="contained"
					onClick={handleSave}
					disabled={loading}
				>
					{loading ? t("common.saving", "Saving...") : t("common.save", "Save")}
				</Button>
			</Box>
		</Box>
	);
};

export default EscalationRulesDialog;
