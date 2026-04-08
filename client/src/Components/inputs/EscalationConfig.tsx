import { useFieldArray, Controller } from "react-hook-form";
import type { Control, FieldValues, Path } from "react-hook-form";
import Stack from "@mui/material/Stack";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import { useTheme } from "@mui/material/styles";
import { Trash2, Plus } from "lucide-react";
import MenuItem from "@mui/material/MenuItem";
import type { Notification } from "@/Types/Notification";
import { TextInput } from "./TextInput";
import { SelectInput } from "./Select";

interface EscalationConfigProps<T extends FieldValues> {
	control: Control<T>;
	fieldName: Path<T>;
	notifications: Notification[];
	fieldLabel?: string;
	maxEscalations?: number;
}

export const EscalationConfig = <T extends FieldValues>({
	control,
	fieldName,
	notifications,
	fieldLabel = "Escalation Rules",
	maxEscalations = 5,
}: EscalationConfigProps<T>) => {
	const theme = useTheme();
	const { fields, append, remove } = useFieldArray({
		control,
		name: fieldName as any,
	});

	const handleAddEscalation = () => {
		if (fields.length < maxEscalations) {
			append({
				delayMinutes: 5,
				notificationId: notifications[0]?.id || "",
				isSent: false,
			} as any);
		}
	};

	return (
		<Stack spacing={theme.spacing(3)}>
			<Box>
				<Typography
					variant="body2"
					sx={{
						fontWeight: 600,
						marginBottom: theme.spacing(2),
					}}
				>
					{fieldLabel}
				</Typography>
			</Box>

			{fields.length === 0 ? (
				<Typography
					variant="caption"
					sx={{
						color: theme.palette.text.secondary,
						fontStyle: "italic",
					}}
				>
					No escalation rules configured. Add one to start receiving escalated alerts.
				</Typography>
			) : null}

			<Stack spacing={theme.spacing(2)}>
				{fields.map((field, index) => (
					<Box
						key={field.id}
						sx={{
							display: "grid",
							gridTemplateColumns: "1fr 1fr auto",
							gap: theme.spacing(2),
							alignItems: "flex-end",
							padding: theme.spacing(2),
							border: `1px solid ${theme.palette.divider}`,
							borderRadius: theme.shape.borderRadius,
							backgroundColor:
								theme.palette.mode === "dark"
									? "rgba(255,255,255,0.02)"
									: "rgba(0,0,0,0.01)",
						}}
					>
						{/* Delay Minutes Input */}
						<Controller
							name={`${fieldName}.${index}.delayMinutes` as Path<T>}
							control={control}
							render={({ field: { value, onChange } }) => (
								<TextInput
									fieldLabel="Delay (minutes)"
									type="number"
									value={value || ""}
									onChange={(e) => onChange(Number((e.target as HTMLInputElement).value))}
									inputProps={{ min: 1, max: 1440 }}
									fullWidth
									size="small"
								/>
							)}
						/>

						{/* Notification Channel Selector */}
						<Controller
							name={`${fieldName}.${index}.notificationId` as Path<T>}
							control={control}
							render={({ field: { value, onChange } }) => (
								<SelectInput
									value={value || ""}
									onChange={onChange}
									displayEmpty
									fullWidth
									size="small"
									placeholder="Select notification channel"
								>
									<MenuItem
										value=""
										disabled
									>
										<Typography sx={{ color: "text.disabled" }}>
											Select notification channel
										</Typography>
									</MenuItem>
									{notifications.map((notification) => (
										<MenuItem
											key={notification.id}
											value={notification.id}
										>
											<Stack
												direction="row"
												spacing={1}
												sx={{ width: "100%" }}
											>
												<Typography
													sx={{
														textTransform: "capitalize",
														fontWeight: 500,
													}}
												>
													{notification.type}
												</Typography>
												<Typography
													variant="caption"
													sx={{
														color: "text.secondary",
													}}
												>
													{notification.address}
												</Typography>
											</Stack>
										</MenuItem>
									))}
								</SelectInput>
							)}
						/>
						<IconButton
							onClick={() => remove(index)}
							size="small"
							sx={{
								color: theme.palette.error.main,
								"&:hover": {
									backgroundColor: "rgba(244, 67, 54, 0.1)",
								},
							}}
							title="Remove escalation rule"
						>
							<Trash2 size={18} />
						</IconButton>
					</Box>
				))}
			</Stack>

			{/* Add Button */}
			<Box sx={{ display: "flex", justifyContent: "flex-start" }}>
				<Button
					variant="outlined"
					startIcon={<Plus size={18} />}
					onClick={handleAddEscalation}
					disabled={fields.length >= maxEscalations}
					size="small"
					sx={{
						textTransform: "none",
						fontWeight: 500,
					}}
				>
					Add Escalation Rule
				</Button>
				{fields.length >= maxEscalations && (
					<Typography
						variant="caption"
						sx={{
							color: theme.palette.text.secondary,
							marginLeft: theme.spacing(2),
							display: "flex",
							alignItems: "center",
						}}
					>
						Maximum {maxEscalations} escalation rules reached
					</Typography>
				)}
			</Box>
		</Stack>
	);
};

EscalationConfig.displayName = "EscalationConfig";
