import React from "react";
import { Box } from "@mui/material";
import { useTranslation } from "react-i18next";
import EscalationStatus from "./EscalationStatus";
import type { Monitor } from "@/Types/Monitor";
import type { Notification } from "@/Types/Notification";

interface EscalationSettingsProps {
	monitor: Monitor;
	notifications: Notification[];
	onSaveSuccess?: () => void;
}

export const EscalationSettings: React.FC<EscalationSettingsProps> = ({
	monitor,
	notifications,
	onSaveSuccess,
}) => {
	const { t } = useTranslation();

	return (
		<Box sx={{ width: "100%" }}>
			<EscalationStatus
				monitor={monitor}
				notifications={notifications}
				onSaveSuccess={onSaveSuccess}
			/>
		</Box>
	);
};

export default EscalationSettings;
