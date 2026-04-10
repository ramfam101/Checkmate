import { useEffect } from "react";
import { Controller, useFieldArray, type Control } from "react-hook-form";
import { useTranslation } from "react-i18next";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import { Trash2 } from "lucide-react";
import { Autocomplete, TextField } from "@/Components/inputs";
import type { Notification } from "@/Types/Notification";

interface EscalatedNotificationsProps {
	control: Control<any>;
	notifications: Notification[];
}

export const EscalatedNotifications = ({
	control,
	notifications,
}: EscalatedNotificationsProps) => {
	const { t } = useTranslation();
	const { fields, remove } = useFieldArray({
		control,
		name: "escalatedNotifications",
	});

	const notificationOptions = notifications.map((n) => ({
		...n,
		name: n.notificationName,
	}));

	// Ensure only one escalation step is allowed
	useEffect(() => {
		if (fields.length > 1) {
			for (let i = fields.length - 1; i > 0; i--) {
				remove(i);
			}
		}
	}, [fields.length, remove]);

	return (
		<Stack spacing={2}>
			<Typography variant="body2" color="text.secondary">
				{t("pages.createMonitor.form.escalatedNotifications.description")}
			</Typography>

			{fields.slice(0, 1).map((field, index) => (
				<Stack
					key={field.id}
					spacing={2}
					sx={{ p: 2, border: 1, borderColor: "divider", borderRadius: 1 }}
				>
					<Stack
						direction="row"
						spacing={2}
						flexWrap="wrap"
						alignItems="flex-start"
					>
						<Controller
							name={`escalatedNotifications.${index}.delayMinutes`}
							control={control}
							render={({ field: delayField, fieldState }) => (
								<TextField
									{...delayField}
									type="number"
									fieldLabel={t(
										"pages.createMonitor.form.escalatedNotifications.delay.label"
									)}
									placeholder="5"
									error={!!fieldState.error}
									helperText={fieldState.error?.message}
									sx={{ minWidth: 140, width: 180 }}
									onChange={(e) => {
										const value = e.target.value ? Number(e.target.value) : 0;
										delayField.onChange(value);
									}}
								/>
							)}
						/>

						<Controller
							name={`escalatedNotifications.${index}.notifications`}
							control={control}
							render={({ field: notifField }) => {
								const selectedNotifications = notificationOptions.filter((n) =>
									(notifField.value ?? []).includes(n.id)
								);
								return (
									<Stack spacing={1} width="100%">
										<Autocomplete
											multiple
											options={notificationOptions}
											value={selectedNotifications}
											getOptionLabel={(option) => option.name}
											onChange={(_: unknown, newValue: typeof notificationOptions) => {
												notifField.onChange(newValue.map((n) => n.id));
											}}
											isOptionEqualToValue={(option, value) => option.id === value.id}
											sx={{ width: "100%" }}
											fieldLabel={t(
												"pages.createMonitor.form.escalatedNotifications.notifications.label"
											)}
										/>
										{selectedNotifications.length > 0 && (
											<Stack width="100%">
												{selectedNotifications.map((notification) => (
													<Stack
														key={notification.id}
														direction="row"
														alignItems="center"
														spacing={2}
													>
														<Typography flexGrow={1}>
															{notification.notificationName}
														</Typography>
														<IconButton
															size="small"
															onClick={() => {
																notifField.onChange(
																	(notifField.value ?? []).filter(
																		(id: string) => id !== notification.id
																	)
																);
															}}
															aria-label="Remove escalation notification"
														>
															<Trash2 size={16} />
														</IconButton>
													</Stack>
												))}
											</Stack>
										)}
									</Stack>
								);
							}}
						/>
					</Stack>

					{fields.length > 1 && (
						<IconButton
							size="small"
							onClick={() => remove(index)}
							aria-label="Remove escalation step"
						>
							<Trash2 size={16} />
						</IconButton>
					)}
				</Stack>
			))}
		</Stack>
	);
};