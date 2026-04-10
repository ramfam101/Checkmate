import React, { useState, useEffect } from "react";
import { Box, Button, CircularProgress } from "@mui/material";
import { useTranslation } from "react-i18next";
import { EscalationRules } from "./EscalationRules";
import { useEscalations } from "@/Hooks/useEscalations";
import { useToast } from "@/Hooks/UseToast";
import type { Monitor } from "@/Types/Monitor";
import type { Notification } from "@/Types/Notification";

interface EscalationSettingsProps {
	monitor: Monitor;
	notifications: Notification[];
	onSaveSuccess?: () => void;
}

interface EscalationRule {
	notificationId: string;
	delayMinutes: number;
	escalationChannelId: string;
}

export const EscalationStatus: React.FC<EscalationSettingsProps> = ({
	monitor,
	notifications,
	onSaveSuccess,
}) => {
	const { t } = useTranslation();
	const { toastError, toastSuccess } = useToast();
	const { saveEscalations, isLoading } = useEscalations();
	const [escalations, setEscalations] = useState<EscalationRule[]>(
		monitor.escalations || []
	);
	const [isDirty, setIsDirty] = useState(false);

	useEffect(() => {
		console.log("EscalationStatus received monitor:", monitor);
		console.log("Monitor ID:", monitor?.id);
		console.log("Monitor keys:", Object.keys(monitor || {}));
	}, [monitor]);

	const handleRulesChange = (newRules: EscalationRule[]) => {
		setEscalations(newRules);
		setIsDirty(true);
	};

	const handleSave = async () => {
		try {
			if (!monitor?.id) {
				console.error("Monitor object:", monitor);
				console.error("Monitor ID:", monitor?.id);
				toastError("Monitor ID is missing");
				return;
			}
			console.log("Saving escalations with monitorId:", monitor.id);
			console.log("Escalations data:", escalations);
			await saveEscalations(monitor.id, escalations);
			toastSuccess(
				t("pages.monitor.escalations.savedSuccessfully", "Escalation rules saved successfully")
			);
			setIsDirty(false);
			onSaveSuccess?.();
		} catch (err) {
			console.error("Save error:", err);
			const errorMsg =
				err instanceof Error ? err.message : "Failed to save escalation rules";
			toastError(errorMsg);
		}
	};

	return (
		<Box>
			<EscalationRules
				escalations={escalations}
				availableNotifications={notifications}
				onChange={handleRulesChange}
			/>

			{isDirty && (
				<Box sx={{ mt: 2, display: "flex", gap: 1 }}>
					<Button
						variant="contained"
						onClick={handleSave}
						disabled={isLoading}
						startIcon={isLoading ? <CircularProgress size={18} /> : undefined}
					>
						{isLoading ? t("common.saving", "Saving...") : t("common.save", "Save")}
					</Button>
					<Button
						variant="outlined"
						onClick={() => {
							setEscalations(monitor.escalations || []);
							setIsDirty(false);
						}}
						disabled={isLoading}
					>
						{t("common.cancel", "Cancel")}
					</Button>
				</Box>
			)}
		</Box>
	);
};

export default EscalationStatus;
