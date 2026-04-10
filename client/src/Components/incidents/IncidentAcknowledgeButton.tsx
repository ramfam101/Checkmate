import React, { useState } from "react";
import { Button, CircularProgress, Dialog, DialogTitle, DialogContent, DialogActions } from "@mui/material";
import { CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useEscalations } from "@/Hooks/useEscalations";
import { useToast } from "@/Hooks/UseToast";
import type { Incident } from "@/Types/Incident";

interface IncidentAcknowledgeButtonProps {
	incident: Incident;
	onAcknowledgeSuccess?: (acknowledgedIncident: Incident) => void;
	variant?: "contained" | "outlined" | "text";
	size?: "small" | "medium" | "large";
	fullWidth?: boolean;
}

/**
 * Component that provides the acknowledge functionality for incidents
 * Shows a confirmation dialog before acknowledging
 */
export const IncidentAcknowledgeButton: React.FC<IncidentAcknowledgeButtonProps> = ({
	incident,
	onAcknowledgeSuccess,
	variant = "contained",
	size = "medium",
	fullWidth = false,
}) => {
	const { t } = useTranslation();
	const { toastError, toastSuccess } = useToast();
	const [dialogOpen, setDialogOpen] = useState(false);
	const { acknowledge, isLoading } = useEscalations();

	if (incident.acknowledged) {
		return (
			<Button
				variant={variant}
				size={size}
				fullWidth={fullWidth}
				disabled
				startIcon={<CheckCircle2 size={16} />}
			>
				{t("pages.incidents.acknowledged", "Acknowledged")}
			</Button>
		);
	}

	const handleOpenDialog = () => {
		setDialogOpen(true);
	};

	const handleCloseDialog = () => {
		setDialogOpen(false);
	};

	const handleConfirmAcknowledge = async () => {
		try {
			await acknowledge(incident.id);
			toastSuccess(
				t("pages.incidents.acknowledgedSuccessfully", "Incident acknowledged successfully")
			);
			const acknowledgedIncident = {
				...incident,
				acknowledged: true,
				acknowledgedAt: new Date().toISOString(),
			};
			onAcknowledgeSuccess?.(acknowledgedIncident);
			setDialogOpen(false);
		} catch (err) {
			const errorMsg =
				err instanceof Error ? err.message : "Failed to acknowledge incident";
			toastError(errorMsg);
		}
	};

	return (
		<>
			<Button
				variant={variant}
				size={size}
				fullWidth={fullWidth}
				onClick={handleOpenDialog}
				disabled={isLoading}
				startIcon={isLoading ? <CircularProgress size={20} /> : <CheckCircle2 size={16} />}
			>
				{t("pages.incidents.acknowledge", "Acknowledge")}
			</Button>

			<Dialog open={dialogOpen} onClose={handleCloseDialog}>
				<DialogTitle>
					{t("pages.incidents.acknowledgeDialog.title", "Acknowledge Incident")}
				</DialogTitle>
				<DialogContent>
					{t(
						"pages.incidents.acknowledgeDialog.message",
						"Are you sure you want to acknowledge this incident? This will stop any further escalations from being triggered."
					)}
				</DialogContent>
				<DialogActions>
					<Button onClick={handleCloseDialog}>
						{t("common.cancel", "Cancel")}
					</Button>
					<Button
						onClick={handleConfirmAcknowledge}
						variant="contained"
						disabled={isLoading}
					>
						{t("common.acknowledge", "Acknowledge")}
					</Button>
				</DialogActions>
			</Dialog>
		</>
	);
};

export default IncidentAcknowledgeButton;
