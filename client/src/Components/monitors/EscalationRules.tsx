import React from "react";
import {
	Box,
	Button,
	Chip,
	Table,
	TableBody,
	TableCell,
	TableContainer,
	TableHead,
	TableRow,
	TextField,
	Autocomplete,
	Dialog,
	DialogTitle,
	DialogContent,
	DialogActions,
	Typography,
	Paper,
} from "@mui/material";
import type { EscalationRule } from "@/Types/Monitor";
import type { Notification } from "@/Types/Notification";
import { useTranslation } from "react-i18next";

interface EscalationRulesProps {
	escalationRules: EscalationRule[];
	availableNotifications: Notification[];
	onChange: (rules: EscalationRule[]) => void;
}

interface NewRule {
	delayMinutes: string;
	notificationIds: string[];
}

export const EscalationRules: React.FC<EscalationRulesProps> = ({
	escalationRules,
	availableNotifications,
	onChange,
}) => {
	const { t } = useTranslation();
	const [openDialog, setOpenDialog] = React.useState(false);
	const [newRule, setNewRule] = React.useState<NewRule>({
		delayMinutes: "",
		notificationIds: [],
	});
	const [errors, setErrors] = React.useState<{ [key: string]: string }>({});

	const validateRule = (): boolean => {
		const newErrors: { [key: string]: string } = {};

		if (!newRule.delayMinutes) {
			newErrors.delayMinutes = t("required");
		} else {
			const minutes = parseInt(newRule.delayMinutes, 10);
			if (isNaN(minutes) || minutes < 1 || minutes > 10080) {
				newErrors.delayMinutes = t("escalation.delayMinutesRange", { defaultValue: "1-10080 minutes" });
			}
		}

		if (newRule.notificationIds.length === 0) {
			newErrors.notifications = t("escalation.selectAtLeastOne", { defaultValue: "Select at least one notification" });
		}

		setErrors(newErrors);
		return Object.keys(newErrors).length === 0;
	};

	const handleAddRule = () => {
		if (validateRule()) {
			const rule: EscalationRule = {
				delayMinutes: parseInt(newRule.delayMinutes, 10),
				notificationIds: newRule.notificationIds,
			};

			// Sort rules by delay minutes
			const updatedRules = [...escalationRules, rule].sort(
				(a, b) => a.delayMinutes - b.delayMinutes
			);
			onChange(updatedRules);

			// Reset form
			setNewRule({ delayMinutes: "", notificationIds: [] });
			setErrors({});
			setOpenDialog(false);
		}
	};

	const handleRemoveRule = (index: number) => {
		const updatedRules = escalationRules.filter((_, i) => i !== index);
		onChange(updatedRules);
	};

	const getNotificationLabel = (id: string) => {
		const notification = availableNotifications.find((n) => n.id === id);
		return notification ? `${notification.notificationName}` : id;
	};

	const getSelectedNotifications = () => {
		return newRule.notificationIds
			.map((id) => availableNotifications.find((n) => n.id === id))
			.filter(Boolean) as Notification[];
	};

	return (
		<Box sx={{ mt: 3 }}>
			<Typography variant="h6" sx={{ mb: 2 }}>
				{t("escalation.title", { defaultValue: "Escalation Rules" })}
			</Typography>

			{escalationRules.length > 0 ? (
				<TableContainer component={Paper} sx={{ mb: 2 }}>
					<Table>
						<TableHead>
							<TableRow sx={{ backgroundColor: "#f5f5f5" }}>
								<TableCell>{t("escalation.delayMinutes", { defaultValue: "Delay (minutes)" })}</TableCell>
								<TableCell>{t("escalation.notifications", { defaultValue: "Notifications" })}</TableCell>
								<TableCell align="right">{t("action.delete", { defaultValue: "Delete" })}</TableCell>
							</TableRow>
						</TableHead>
						<TableBody>
							{escalationRules.map((rule, index) => (
								<TableRow key={index}>
									<TableCell>{rule.delayMinutes}</TableCell>
									<TableCell>
										<Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
											{rule.notificationIds.map((id) => (
												<Chip
													key={id}
													label={getNotificationLabel(id)}
													size="small"
													variant="outlined"
												/>
											))}
										</Box>
									</TableCell>
									<TableCell align="right">
										<Button
											size="small"
											color="error"

											onClick={() => handleRemoveRule(index)}
										>
											{t("action.delete", { defaultValue: "Delete" })}
										</Button>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</TableContainer>
			) : (
				<Typography variant="body2" sx={{ mb: 2, color: "text.secondary" }}>
					{t("escalation.noRules", { defaultValue: "No escalation rules configured" })}
				</Typography>
			)}

			<Button
				variant="outlined"
				onClick={() => setOpenDialog(true)}
			>
				+ {t("escalation.addRule", { defaultValue: "Add Escalation Rule" })}
			</Button>

			<Dialog open={openDialog} onClose={() => setOpenDialog(false)} maxWidth="sm" fullWidth>
				<DialogTitle>
					{t("escalation.addRule", { defaultValue: "Add Escalation Rule" })}
				</DialogTitle>
				<DialogContent sx={{ pt: 2 }}>
					<TextField
						fullWidth
						label={t("escalation.delayMinutes", { defaultValue: "Delay (minutes)" })}
						type="number"
						value={newRule.delayMinutes}
						onChange={(e) => {
							setNewRule({ ...newRule, delayMinutes: e.target.value });
							if (errors.delayMinutes) {
								setErrors({ ...errors, delayMinutes: "" });
							}
						}}
						error={Boolean(errors.delayMinutes)}
						helperText={errors.delayMinutes || t("escalation.delayMinutesHelp", { defaultValue: "Between 1 and 10080 minutes (7 days)" })}
						margin="normal"
						inputProps={{ min: 1, max: 10080 }}
					/>

					<Autocomplete
						multiple
						fullWidth
						options={availableNotifications}
						getOptionLabel={(option) => option.notificationName}
						value={getSelectedNotifications()}
						onChange={(_, newValue) => {
							setNewRule({
								...newRule,
								notificationIds: newValue.map((n) => n.id),
							});
							if (errors.notifications) {
								setErrors({ ...errors, notifications: "" });
							}
						}}
						renderInput={(params) => (
							<TextField
								{...params}
								label={t("escalation.notifications", { defaultValue: "Notifications" })}
								error={Boolean(errors.notifications)}
								helperText={errors.notifications}
								margin="normal"
							/>
						)}
						sx={{ mt: 2 }}
					/>
				</DialogContent>
				<DialogActions>
					<Button onClick={() => setOpenDialog(false)}>
						{t("action.cancel", { defaultValue: "Cancel" })}
					</Button>
					<Button onClick={handleAddRule} variant="contained">
						{t("action.add", { defaultValue: "Add" })}
					</Button>
				</DialogActions>
			</Dialog>
		</Box>
	);
};

export default EscalationRules;
