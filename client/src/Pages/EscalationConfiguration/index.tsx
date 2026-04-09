import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslation } from "react-i18next";
import { useTheme } from "@mui/material/styles";

import { BasePage } from "@/Components/design-elements";
import { Button, TextField, Select, Dialog } from "@/Components/inputs";
import { useGet, usePost, usePatch, useDelete } from "@/Hooks/UseApi";
import type { EscalationNotification, NotificationChannel } from "@/Types/Notification";
import { Trash2, Plus, ArrowLeft } from "lucide-react";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardActions from "@mui/material/CardActions";
import IconButton from "@mui/material/IconButton";
import Box from "@mui/material/Box";
import Alert from "@mui/material/Alert";
import { SPACING } from "@/Utils/Theme/constants";

const escalationFormSchema = z.object({
	escalations: z.array(
		z.object({
			id: z.string().optional(),
			escalationLevel: z.number().min(1, "Escalation level must be at least 1"),
			delaySeconds: z.number().min(0, "Delay must be non-negative"),
			notificationChannel: z.enum(["email", "slack", "discord", "webhook", "pager_duty", "matrix", "teams"]),
			isActive: z.boolean().default(true),
		})
	),
});

type EscalationFormData = z.infer<typeof escalationFormSchema>;

const EscalationConfigurationPage = () => {
	const { t } = useTranslation();
	const theme = useTheme();
	const { monitorId } = useParams<{ monitorId: string }>();
	const navigate = useNavigate();

	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [escalationToDelete, setEscalationToDelete] = useState<string | null>(null);

	const {
		data: escalations,
		isLoading: isLoadingEscalations,
		error: escalationsError,
		refetch: refetchEscalations,
	} = useGet<EscalationNotification[]>(`/escalation-notifications/monitor/${monitorId}`);

	const { control, handleSubmit, reset, formState: { errors, isDirty } } = useForm<EscalationFormData>({
		resolver: zodResolver(escalationFormSchema),
		defaultValues: {
			escalations: [],
		},
	});

	const { fields, append, remove } = useFieldArray({
		control,
		name: "escalations",
	});

	const createEscalation = usePost<EscalationNotification>("/escalation-notifications");
	const updateEscalation = usePatch<EscalationNotification>("/escalation-notifications");
	const deleteEscalation = useDelete(`/escalation-notifications`);

	// Load existing escalations when data is available
	useEffect(() => {
		if (escalations) {
			reset({
				escalations: escalations.map(esc => ({
					id: esc.id,
					escalationLevel: esc.escalationLevel,
					delaySeconds: esc.delaySeconds,
					notificationChannel: esc.notificationChannel,
					isActive: esc.isActive,
				})),
			});
		}
	}, [escalations, reset]);

	const handleAddEscalation = () => {
		append({
			escalationLevel: Math.max(...fields.map(f => f.escalationLevel || 0), 0) + 1,
			delaySeconds: 300, // 5 minutes default
			notificationChannel: "email" as NotificationChannel,
			isActive: true,
		});
	};

	const handleDeleteEscalation = (index: number, escalationId?: string) => {
		if (escalationId) {
			setEscalationToDelete(escalationId);
			setDeleteDialogOpen(true);
		} else {
			remove(index);
		}
	};

	const confirmDelete = async () => {
		if (escalationToDelete) {
			try {
				await deleteEscalation.mutateAsync(escalationToDelete);
				refetchEscalations();
				setDeleteDialogOpen(false);
				setEscalationToDelete(null);
			} catch (error) {
				console.error("Failed to delete escalation:", error);
			}
		}
	};

	const onSubmit = async (data: EscalationFormData) => {
		try {
			const promises = data.escalations.map(async (escalation) => {
				const payload = {
					monitorId,
					escalationLevel: escalation.escalationLevel,
					delaySeconds: escalation.delaySeconds,
					notificationChannel: escalation.notificationChannel,
					isActive: escalation.isActive,
				};

				if (escalation.id) {
					// Update existing
					return updateEscalation.mutateAsync(`${escalation.id}`, payload);
				} else {
					// Create new
					return createEscalation.mutateAsync(payload);
				}
			});

			await Promise.all(promises);
			refetchEscalations();
		} catch (error) {
			console.error("Failed to save escalations:", error);
		}
	};

	const notificationChannelOptions = [
		{ value: "email", label: "Email" },
		{ value: "slack", label: "Slack" },
		{ value: "discord", label: "Discord" },
		{ value: "webhook", label: "Webhook" },
		{ value: "pager_duty", label: "PagerDuty" },
		{ value: "matrix", label: "Matrix" },
		{ value: "teams", label: "Teams" },
	];

	if (isLoadingEscalations) {
		return (
			<BasePage title={t("escalationConfiguration.title")}>
				<Typography>Loading...</Typography>
			</BasePage>
		);
	}

	if (escalationsError) {
		return (
			<BasePage title={t("escalationConfiguration.title")}>
				<Alert severity="error">
					Failed to load escalation notifications. Please try again.
				</Alert>
			</BasePage>
		);
	}

	return (
		<BasePage title={t("escalationConfiguration.title")}>
			<Stack spacing={SPACING.md}>
				<Box display="flex" alignItems="center" gap={2}>
					<IconButton onClick={() => navigate(-1)}>
						<ArrowLeft />
					</IconButton>
					<Typography variant="h6">
						{t("escalationConfiguration.configureEscalations")}
					</Typography>
				</Box>

				<Card>
					<CardContent>
						<Typography variant="body1" gutterBottom>
							{t("escalationConfiguration.description")}
						</Typography>

						<Stack spacing={SPACING.md} sx={{ mt: 3 }}>
							{fields.map((field, index) => (
								<Card key={field.id} variant="outlined">
									<CardContent>
										<Stack direction="row" spacing={2} alignItems="flex-start">
											<TextField
												label={t("escalationConfiguration.escalationLevel")}
												type="number"
												control={control}
												name={`escalations.${index}.escalationLevel`}
												error={!!errors.escalations?.[index]?.escalationLevel}
												helperText={errors.escalations?.[index]?.escalationLevel?.message}
												sx={{ minWidth: 120 }}
											/>

											<TextField
												label={t("escalationConfiguration.delaySeconds")}
												type="number"
												control={control}
												name={`escalations.${index}.delaySeconds`}
												error={!!errors.escalations?.[index]?.delaySeconds}
												helperText={errors.escalations?.[index]?.delaySeconds?.message}
												sx={{ minWidth: 150 }}
											/>

											<Select
												label={t("escalationConfiguration.notificationChannel")}
												control={control}
												name={`escalations.${index}.notificationChannel`}
												options={notificationChannelOptions}
												error={!!errors.escalations?.[index]?.notificationChannel}
												sx={{ minWidth: 150 }}
											/>

											<Box sx={{ pt: 2 }}>
												<IconButton
													onClick={() => handleDeleteEscalation(index, field.escalationLevel ? undefined : field.id)}
													color="error"
												>
													<Trash2 />
												</IconButton>
											</Box>
										</Stack>
									</CardContent>
								</Card>
							))}

							<Button
								variant="outlined"
								startIcon={<Plus />}
								onClick={handleAddEscalation}
								sx={{ alignSelf: "flex-start" }}
							>
								{t("escalationConfiguration.addEscalation")}
							</Button>
						</Stack>
					</CardContent>

					<CardActions>
						<Button
							variant="contained"
							onClick={handleSubmit(onSubmit)}
							disabled={!isDirty && fields.length === 0}
						>
							{t("common.save")}
						</Button>
					</CardActions>
				</Card>
			</Stack>

			<Dialog
				open={deleteDialogOpen}
				onClose={() => setDeleteDialogOpen(false)}
				title={t("escalationConfiguration.confirmDelete")}
				content={t("escalationConfiguration.confirmDeleteMessage")}
				actions={
					<>
						<Button onClick={() => setDeleteDialogOpen(false)}>
							{t("common.cancel")}
						</Button>
						<Button onClick={confirmDelete} color="error">
							{t("common.delete")}
						</Button>
					</>
				}
			/>
		</BasePage>
	);
};

export default EscalationConfigurationPage;