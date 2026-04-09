import {
	Accordion,
	AccordionSummary,
	AccordionDetails,
	Box,
	TextField,
	Autocomplete,
	Stack,
	Typography,
	IconButton,
	Button,
	Chip,
} from "@mui/material";
import { ChevronDown, Trash2, Plus } from "lucide-react";
import type { Notification } from "@/Types/Notification";
import type { EscalationRule } from "@/Types/Monitor";

interface EscalationRulesPanelProps {
	escalationRules: EscalationRule[];
	availableNotifications: Notification[];
	onUpdate: (rules: EscalationRule[]) => void;
}

export const EscalationRulesPanel = ({
	escalationRules,
	availableNotifications,
	onUpdate,
}: EscalationRulesPanelProps) => {

	const getNotificationName = (notificationId: string) => {
		return availableNotifications.find((n) => n.id === notificationId)?.notificationName || notificationId;
	};

	const updateRule = (index: number, updates: Partial<EscalationRule>) => {
		const updated = [...escalationRules];
		updated[index] = {
			...updated[index],
			...updates,
		};
		onUpdate(updated);
	};

	const addRule = () => {
		if (escalationRules.length > 0) return; // Prevent adding multiple rules
		const newRule: EscalationRule = {
			minutesBeforeEscalation: 5,
			escalationNotifications: [],
		};
		onUpdate([...escalationRules, newRule]);
	};

	const removeRule = (index: number) => {
		const updated = escalationRules.filter((_, i) => i !== index);
		onUpdate(updated);
	};

	// Get all available notifications for escalation
	const availableEscalationNotifications = availableNotifications;

	return (
		<Box sx={{ mt: 3 }}>
			{escalationRules.length > 0 ? (
				<>
					{escalationRules.map((rule, index) => {
						const selectedChannelNames = rule.escalationNotifications
							.map(getNotificationName)
							.join(", ");

						return (
							<Accordion key={`rule-${index}`} defaultExpanded={true}>
								<AccordionSummary
									expandIcon={<ChevronDown size={20} />}
									sx={{
										backgroundColor: rule.escalationNotifications.length === 0 
											? "error.lighter" 
											: "action.hover",
										transition: "background-color 0.2s",
										borderLeft: rule.escalationNotifications.length === 0 ? "4px solid" : "none",
										borderLeftColor: "error.main",
									}}
								>
									<Box sx={{ display: "flex", alignItems: "center", gap: 2, width: "100%", pr: 1 }}>
										{rule.escalationNotifications.length === 0 ? (
											<Typography sx={{ fontWeight: 500, color: "error.main" }}>
												⚠ Select escalation channels
											</Typography>
										) : (
											<Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
												<Typography sx={{ fontWeight: 500 }}>
													After {rule.minutesBeforeEscalation}m:
												</Typography>
												<Typography variant="body2" color="text.secondary">
													{selectedChannelNames}
												</Typography>
											</Box>
										)}
									</Box>
									<IconButton
										size="small"
										onClick={(e) => {
											e.stopPropagation();
											removeRule(index);
										}}
										sx={{ ml: 1 }}
									>
										<Trash2 size={18} />
									</IconButton>
								</AccordionSummary>

								<AccordionDetails>
									<Stack spacing={3}>
										<TextField
											type="number"
											label="Escalate after (minutes)"
											placeholder="e.g., 5"
											value={rule.minutesBeforeEscalation}
											onChange={(e) =>
												updateRule(index, { 
													minutesBeforeEscalation: Math.max(1, Math.min(10080, parseInt(e.target.value) || 1)) 
												})
											}
											inputProps={{ min: 1, max: 10080 }}
											size="small"
											fullWidth
											helperText="After this many minutes, send escalation notifications if monitor is still down"
										/>

										<Autocomplete
											multiple
											options={availableEscalationNotifications}
											getOptionLabel={(option) => option.notificationName}
											value={
												availableEscalationNotifications.filter((n) => 
													rule.escalationNotifications.includes(n.id)
												) || []
											}
											onChange={(_, value) => {
												updateRule(index, { 
													escalationNotifications: value.map(v => v.id)
												});
											}}
											renderInput={(params) => (
												<TextField
													{...params}
													label="Escalation notification channels"
													placeholder="Select one or more channels"
													size="small"
													error={rule.escalationNotifications.length === 0}
													helperText={rule.escalationNotifications.length === 0 ? "At least one channel is required" : ""}
												/>
											)}
											renderTags={(value, getTagProps) =>
												value.map((option, index) => (
													<Chip
														variant="outlined"
														label={option.notificationName}
														{...getTagProps({ index })}
														key={option.id}
													/>
												))
											}
										/>
									</Stack>
								</AccordionDetails>
							</Accordion>
						);
					})}
				</>
			) : (
				<Button
					variant="outlined"
					startIcon={<Plus size={18} />}
					onClick={addRule}
					fullWidth
					sx={{ mt: 2 }}
				>
					Add escalation rule
				</Button>
			)}
		</Box>
	);
};

