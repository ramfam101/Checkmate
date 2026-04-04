import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { Stack, Button as MuiButton, TextField as MuiTextField, Paper, CircularProgress, Typography, Autocomplete } from "@mui/material";
import { BasePage, ConfigBox } from "@/Components/design-elements";
import { useTheme } from "@mui/material";
import { SPACING, LAYOUT } from "@/Utils/Theme/constants";
import * as ApiClient from "@/Utils/ApiClient";
import { useGet } from "@/Hooks/UseApi";
import type { EscalationPolicy } from "@/Types/EscalationPolicy";
import type { Notification } from "@/Types/Notification";

export const EscalationPoliciesCreate = () => {
	const theme = useTheme();
	const navigate = useNavigate();
	const { policyId } = useParams<{ policyId: string }>();
	const isEditMode = !!policyId;

	const { data: notifications } = useGet<Notification[]>("/notifications/team");

	const [formData, setFormData] = useState({
		name: "",
		description: "",
		enabled: true,
		delayMinutes: 5,
		notificationIds: [] as string[],
	});

	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState("");

	// Fetch existing policy if editing
	useEffect(() => {
		if (isEditMode && policyId) {
			const fetchPolicy = async () => {
				try {
					setIsLoading(true);
					const response = await ApiClient.get<EscalationPolicy>(`/escalation-policies/${policyId}`);
					const data = response?.data || response;
					if (data) {
						setFormData({
							name: (data as any).name,
							description: (data as any).description || "",
							enabled: (data as any).enabled,
							delayMinutes: (data as any).delayMinutes,
							notificationIds: (data as any).rules?.[0]?.notificationIds || [],
						});
					}
				} catch (err) {
					setError("Failed to load policy");
					console.error(err);
				} finally {
					setIsLoading(false);
				}
			};
			fetchPolicy();
		}
	}, [isEditMode, policyId]);

	const handleSubmit = async () => {
		try {
			setIsLoading(true);
			setError("");

			if (!formData.name.trim()) {
				setError("Policy name is required");
				setIsLoading(false);
				return;
			}

			if (formData.delayMinutes < 1 || formData.delayMinutes > 10080) {
				setError("Delay must be between 1 and 10080 minutes");
				setIsLoading(false);
				return;
			}

			if (formData.notificationIds.length === 0) {
				setError("At least one notification channel is required");
				setIsLoading(false);
				return;
			}

			const payload = {
				name: formData.name,
				description: formData.description,
				enabled: formData.enabled,
				rules: [
					{
						delayMinutes: formData.delayMinutes,
						notificationIds: formData.notificationIds,
					},
				],
			};

			console.log("Submitting payload:", payload);

			if (isEditMode && policyId) {
				const result = await ApiClient.patch(`/escalation-policies/${policyId}`, payload);
				console.log("Update result:", result);
			} else {
				const result = await ApiClient.post("/escalation-policies", payload);
				console.log("Create result:", result);
			}

			// Wait a moment before navigating
			setTimeout(() => {
				navigate("/escalation-policies");
			}, 500);
		} catch (err) {
			console.error("Submit error:", err);
			setError((err as any)?.response?.data?.msg || (err as any)?.message || "Failed to save policy");
			setIsLoading(false);
		}
	};

	return (
		<BasePage>
			<Stack spacing={theme.spacing(LAYOUT.LG)} sx={{ maxWidth: "600px", mx: "auto", pb: theme.spacing(LAYOUT.XL) }}>
				<Typography variant="h4">{isEditMode ? "Edit Escalation Policy" : "Create Escalation Policy"}</Typography>
				<Typography variant="body2" color="textSecondary">
					{isEditMode ? "Update your escalation policy" : "Create a new escalation policy"}
				</Typography>

				{error && (
					<Paper sx={{ p: theme.spacing(SPACING.MD), backgroundColor: "#ffebee", color: "#c62828" }}>
						{error}
					</Paper>
				)}

				<ConfigBox
					title="Basic Information"
					subtitle="Enter the policy name and description"
					rightContent={
						<Stack spacing={theme.spacing(SPACING.MD)}>
							<MuiTextField
								label="Policy Name"
								value={formData.name}
								onChange={(e) => setFormData({ ...formData, name: e.target.value })}
								placeholder="e.g., Critical Incident Escalation"
								fullWidth
								disabled={isLoading}
							/>
							<MuiTextField
								label="Description"
								value={formData.description}
								onChange={(e) => setFormData({ ...formData, description: e.target.value })}
								placeholder="e.g., Escalate after 5 minutes to management team"
								fullWidth
								multiline
								rows={3}
								disabled={isLoading}
							/>
						</Stack>
					}
				/>

				<ConfigBox
					title="Escalation Timing"
					subtitle="When should escalation be triggered?"
					rightContent={
						<Stack spacing={theme.spacing(SPACING.MD)}>
							<MuiTextField
								label="Delay (minutes)"
								type="number"
								value={formData.delayMinutes}
								onChange={(e) => setFormData({ ...formData, delayMinutes: Math.max(1, parseInt(e.target.value) || 1) })}
								inputProps={{ min: 1, max: 10080 }}
								fullWidth
								disabled={isLoading}
								helperText="How many minutes before escalation (1-10080)"
							/>
						</Stack>
					}
				/>

				<ConfigBox
					title="Notification Channels"
					subtitle="Select notification channels for escalation"
					rightContent={
						<Stack spacing={theme.spacing(SPACING.MD)}>
							<Autocomplete
								multiple
								options={notifications || []}
								getOptionLabel={(option) => option.notificationName}
								value={(notifications || []).filter((n) => formData.notificationIds.includes(n.id))}
								onChange={(_: unknown, newValue: Notification[]) => {
									setFormData({ ...formData, notificationIds: newValue.map((n) => n.id) });
								}}
								isOptionEqualToValue={(option, value) => option.id === value.id}
								disabled={isLoading}
								renderInput={(params) => (
									<MuiTextField {...params} label="Select notification channels" placeholder="Add channels..." />
								)}
							/>
							{formData.notificationIds.length === 0 && (
								<Typography variant="caption" color="error">
									At least one notification channel is required
								</Typography>
							)}
						</Stack>
					}
				/>

				<ConfigBox
					title="Status"
					subtitle="Enable or disable this policy"
					rightContent={
						<MuiButton
							variant="contained"
							color={formData.enabled ? "success" : "error"}
							onClick={() => setFormData({ ...formData, enabled: !formData.enabled })}
							disabled={isLoading}
						>
							{formData.enabled ? "Enabled" : "Disabled"}
						</MuiButton>
					}
				/>

				<Stack direction="row" spacing={theme.spacing(SPACING.MD)} justifyContent="flex-end">
					<MuiButton
						variant="outlined"
						onClick={() => navigate("/escalation-policies")}
						disabled={isLoading}
					>
						Cancel
					</MuiButton>
					<MuiButton
						variant="contained"
						onClick={handleSubmit}
						disabled={isLoading}
						startIcon={isLoading ? <CircularProgress size={20} /> : undefined}
					>
						{isLoading ? "Saving..." : isEditMode ? "Update Policy" : "Create Policy"}
					</MuiButton>
				</Stack>
			</Stack>
		</BasePage>
	);
};

export default EscalationPoliciesCreate;
