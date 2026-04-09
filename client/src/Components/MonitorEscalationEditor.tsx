import React from "react";
import { Controller, useWatch } from "react-hook-form";
import type { Control as ControlType } from "react-hook-form";
import { TextField } from "@/Components/inputs";
import { Select } from "@/Components/inputs";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { MonitorFormData } from "@/Validation/monitor";
import { useGet } from "@/Hooks/UseApi";
import type { Notification } from "@/Types/Notification";

interface MonitorEscalationEditorProps {
	control: ControlType<MonitorFormData>;
}

const MonitorEscalationEditor: React.FC<MonitorEscalationEditorProps> = ({ control }) => {
	const { t } = useTranslation();

	// Get all notifications for recipient selection
	const { data: notifications } = useGet<Notification[]>("/notifications/team");

	// Watch the escalation notification ID value
	const selectedNotificationId = useWatch({
		control,
		name: "escalation.notificationId",
	});

	const selectedNotification = notifications?.find(n => n.id === selectedNotificationId);

	return (
		<Stack spacing={2} sx={{ pt: 2 }}>
            <TextField
                fieldLabel={t("pages.createMonitor.form.escalation.minutesAfterStart")}
                fullWidth
                type="number"
                sx={{
                    "& input[type=number]::-webkit-outer-spin-button": { display: "none" },
                    "& input[type=number]::-webkit-inner-spin-button": { display: "none" },
                    "& input[type=number]": { MozAppearance: "textfield" },
                }}
                {...control.register("escalation.minutesAfterStart", { valueAsNumber: true })}
            />
			<Controller
				name="escalation.notificationId"
				control={control}
				render={({ field, fieldState }) => (
					<Stack spacing={2}>
						<Select
							value={field.value || ""}
							onChange={(value) => field.onChange(value)}
							fieldLabel={t("pages.createMonitor.form.escalation.notification")}
							error={!!fieldState.error}
							fullWidth
							placeholder="Type to search"
						>
							{notifications?.map((notification) => (
								<MenuItem key={notification.id} value={notification.id}>
									{notification.notificationName}
								</MenuItem>
							))}
						</Select>

						{selectedNotification && (
							<Stack flex={1} width="100%">
								<Stack
									direction="row"
									alignItems="center"
									width="100%"
									spacing={1}
								>
									<Typography flexGrow={1}>
										{selectedNotification.notificationName}
									</Typography>
									<IconButton
										size="small"
										onClick={() => field.onChange("")}
										aria-label="Remove notification"
									>
										<Trash2 size={16} />
									</IconButton>
								</Stack>
							</Stack>
						)}
					</Stack>
				)}
			/>
		</Stack>
	);
};

export default MonitorEscalationEditor;