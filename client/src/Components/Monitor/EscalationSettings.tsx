import { useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTheme } from "@mui/material";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import IconButton from "@mui/material/IconButton";
import Divider from "@mui/material/Divider";
import { usePatch } from "@/Hooks/UseApi";
import {
	SwitchComponent as Switch,
	TextField,
	Autocomplete,
	SliderWithLabel,
	Button,
} from "@/Components/inputs";
import { SPACING, LAYOUT } from "@/Utils/Theme/constants";
import type { Notification } from "@/Types/Notification";
import type { Monitor } from "@/Types/Monitor";
import { escalationSettingsSchema, type EscalationFormData } from "@/Validation/monitor";

interface EscalationSettingsProps {
	monitor: Monitor;
	notifications: Notification[];
	onSuccess?: () => void;
}

export const EscalationSettings = ({ monitor, notifications, onSuccess }: EscalationSettingsProps) => {
	const { t } = useTranslation();
	const theme = useTheme();

	const [isSubmitting, setIsSubmitting] = useState(false);

	const { control, handleSubmit, watch, setValue } = useForm<EscalationFormData>({
		resolver: zodResolver(escalationSettingsSchema),
		defaultValues: {
			escalationEnabled: monitor?.escalationEnabled ?? false,
			escalationDelayMinutes: monitor?.escalationDelayMinutes ?? 30,
			escalationNotifications: monitor?.escalationNotifications ?? [],
			escalationMessage: monitor?.escalationMessage ?? "ESCALATION: Issue has persisted for {{minutes}} minutes without resolution.",
		},
	});

	const watchedEscalationEnabled = watch("escalationEnabled");

	const updateEscalation = usePatch<EscalationFormData, Monitor>();

	const onSubmit = async (data: EscalationFormData) => {
		setIsSubmitting(true);
		try {
			await updateEscalation.patch(`/monitors/${monitor.id}/escalation`, data);
			onSuccess?.();
		} catch (error) {
			console.error("Failed to update escalation settings:", error);
		} finally {
			setIsSubmitting(false);
		}
	};

	// Map notifications to have 'name' property for Autocomplete
	const notificationOptions = notifications.map((n: Notification) => ({
		...n,
		name: n.notificationName,
	}));
	const selectedNotifications = notificationOptions.filter((n: Notification & { name: string }) =>
		watch("escalationNotifications").includes(n.id)
	);

	return (
		<Stack component="form" onSubmit={handleSubmit(onSubmit)} spacing={theme.spacing(LAYOUT.MD)}>
			{/* Enable/Disable Escalation */}
			<Controller
				name="escalationEnabled"
				control={control}
				render={({ field }) => (
					<Stack
						direction="row"
						alignItems="center"
						spacing={theme.spacing(SPACING.LG)}
					>
						<Switch
							checked={field.value}
							onChange={(e) => {
								field.onChange(e.target.checked);
								if (!e.target.checked) {
									// Reset escalation settings when disabled
									setValue("escalationNotifications", []);
								}
							}}
						/>
						<Typography>
							{t("pages.createMonitor.form.escalation.option.enabled.label")}
						</Typography>
					</Stack>
				)}
			/>

			{/* Escalation Delay */}
			{watchedEscalationEnabled && (
				<Controller
					name="escalationDelayMinutes"
					control={control}
					render={({ field }) => (
						<SliderWithLabel
							{...field}
							fieldLabel={t("pages.createMonitor.form.escalation.option.delay.label")}
							min={5}
							max={1440}
							step={5}
							valueLabelDisplay="auto"
							valueLabelFormat={(value) => `${value} min`}
						/>
					)}
				/>
			)}

			{/* Escalation Notifications */}
			{watchedEscalationEnabled && (
				<Controller
					name="escalationNotifications"
					control={control}
					render={({ field }) => (
						<Stack spacing={theme.spacing(LAYOUT.MD)}>
							<Autocomplete
								multiple
								options={notificationOptions}
								value={selectedNotifications}
								getOptionLabel={(option) => option.name}
								onChange={(_: unknown, newValue: typeof notificationOptions) => {
									field.onChange(newValue.map((n: Notification & { name: string }) => n.id));
								}}
								isOptionEqualToValue={(option, value) => option.id === value.id}
								fieldLabel={t("pages.createMonitor.form.escalation.option.notifications.label")}
							/>
							{selectedNotifications.length > 0 && (
								<Stack flex={1} width="100%">
									{selectedNotifications.map((notification: Notification & { name: string }, index: number) => (
										<Stack
											direction="row"
											alignItems="center"
											key={notification.id}
											width="100%"
										>
											<Typography flexGrow={1}>
												{notification.notificationName}
											</Typography>
											<IconButton
												size="small"
												onClick={() => {
													field.onChange(
														field.value.filter(
															(id: string) => id !== notification.id
														)
													);
												}}
												aria-label="Remove notification"
											>
												<Trash2 size={16} />
											</IconButton>
											{index < selectedNotifications.length - 1 && <Divider />}
										</Stack>
									))}
								</Stack>
							)}
						</Stack>
					)}
				/>
			)}

			{/* Custom Escalation Message */}
			{watchedEscalationEnabled && (
				<Controller
					name="escalationMessage"
					control={control}
					render={({ field, fieldState }) => (
						<TextField
							{...field}
							multiline
							rows={3}
							fieldLabel={t("pages.createMonitor.form.escalation.option.message.label")}
							placeholder={t("pages.createMonitor.form.escalation.option.message.placeholder")}
							helperText={t("pages.createMonitor.form.escalation.option.message.helper")}
							error={!!fieldState.error}
						/>
					)}
				/>
			)}

			{/* Submit Button */}
			{watchedEscalationEnabled && (
				<Button
					type="submit"
					variant="contained"
					disabled={isSubmitting}
					sx={{ alignSelf: "flex-start" }}
				>
					{isSubmitting
						? t("common.saving")
						: t("pages.createMonitor.form.escalation.saveButton")
					}
				</Button>
			)}
		</Stack>
	);
};