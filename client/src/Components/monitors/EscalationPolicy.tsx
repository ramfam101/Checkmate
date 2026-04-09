import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Divider from "@mui/material/Divider";
import { useTheme } from "@mui/material";
import { Trash2, Plus } from "lucide-react";
import { useFieldArray, type Control } from "react-hook-form";
import { Controller } from "react-hook-form";
import { Autocomplete, TextField, Button } from "@/Components/inputs";
import { LAYOUT } from "@/Utils/Theme/constants";
import type { Notification } from "@/Types/Notification";
import type { MonitorFormData } from "@/Validation/monitor";

interface EscalationPolicyProps {
	control: Control<MonitorFormData>;
	notifications: Notification[];
}

const EscalationPolicy = ({ control, notifications }: EscalationPolicyProps) => {
	const theme = useTheme();

	const { fields, append, remove } = useFieldArray({
		control,
		name: "escalationPolicy",
	});

	const notificationOptions = notifications.map((n) => ({
		...n,
		name: n.notificationName,
	}));

	const handleAddTier = () => {
		append({ delay: 30, notifications: [] });
	};

	return (
		<Stack spacing={theme.spacing(LAYOUT.MD)}>
			{fields.length === 0 && (
				<Typography
					variant="body2"
					color="text.secondary"
				>
					No escalation tiers configured. Add a tier to send follow-up alerts when an
					incident persists.
				</Typography>
			)}

			{fields.map((field, index) => (
				<Stack
					key={field.id}
					spacing={theme.spacing(LAYOUT.SM)}
					sx={{
						p: theme.spacing(LAYOUT.MD),
						border: `1px solid ${theme.palette.divider}`,
						borderRadius: theme.shape.borderRadius,
					}}
				>
					<Stack
						direction="row"
						alignItems="center"
						justifyContent="space-between"
					>
						<Typography
							variant="body2"
							fontWeight={600}
						>
							Escalation Tier {index + 1}
						</Typography>
						<IconButton
							size="small"
							onClick={() => remove(index)}
							aria-label={`Remove escalation tier ${index + 1}`}
						>
							<Trash2 size={16} />
						</IconButton>
					</Stack>

					<Divider />

					<Controller
						name={`escalationPolicy.${index}.delay`}
						control={control}
						render={({ field: delayField, fieldState }) => (
							<TextField
								{...delayField}
								value={delayField.value === 0 ? "" : delayField.value}
								onChange={(e) => {
									const val = e.target.value;
									delayField.onChange(val === "" ? 0 : Number(val));
								}}
								type="number"
								fieldLabel="Escalate after (minutes)"
								placeholder="e.g. 30"
								fullWidth
								error={!!fieldState.error}
								helperText={
									fieldState.error?.message ??
									"Minutes after incident start before this alert fires"
								}
							/>
						)}
					/>

					<Controller
						name={`escalationPolicy.${index}.notifications`}
						control={control}
						render={({ field: notifField }) => {
							const selected = notificationOptions.filter((n) =>
								(notifField.value ?? []).includes(n.id)
							);
							return (
								<Stack spacing={theme.spacing(LAYOUT.SM)}>
									<Autocomplete
										multiple
										options={notificationOptions}
										value={selected}
										getOptionLabel={(option) => option.name}
										onChange={(_: unknown, newValue: typeof notificationOptions) => {
											notifField.onChange(newValue.map((n) => n.id));
										}}
										isOptionEqualToValue={(option, value) => option.id === value.id}
										fieldLabel="Notification channels"
									/>
									{selected.length > 0 && (
										<Stack
											flex={1}
											width="100%"
										>
											{selected.map((notification, nIdx) => (
												<Stack
													key={notification.id}
													direction="row"
													alignItems="center"
													width="100%"
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
														aria-label="Remove notification"
													>
														<Trash2 size={16} />
													</IconButton>
													{nIdx < selected.length - 1 && <Divider />}
												</Stack>
											))}
										</Stack>
									)}
								</Stack>
							);
						}}
					/>
				</Stack>
			))}

			<Button
				variant="outlined"
				color="primary"
				onClick={handleAddTier}
				startIcon={<Plus size={16} />}
				sx={{ alignSelf: "flex-start" }}
			>
				Add escalation tier
			</Button>
		</Stack>
	);
};

export default EscalationPolicy;
