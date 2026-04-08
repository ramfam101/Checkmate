import { useMemo, useState } from "react";
import { useTheme } from "@mui/material";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import { Controller, useFieldArray } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { ConfigBox } from "@/Components/design-elements";
import { TextField, Autocomplete, Button } from "@/Components/inputs";
import { LAYOUT } from "@/Utils/Theme/constants";
import { Trash2, Plus, Edit3, Save, X } from "lucide-react";
import type { Notification } from "@/Types/Notification";

interface EscalationNode {
	id: string;
	delayMinutes: number;
	notificationIds: string[];
	notifications: Notification[];
}

interface EscalatedNotificationsBoxProps {
	control: any;
	notifications: Notification[] | undefined;
	watch: any;
}

export const EscalatedNotificationsBox = ({
	control,
	notifications,
	watch,
}: EscalatedNotificationsBoxProps) => {
	const theme = useTheme();
	const { t } = useTranslation();
	const [isEditing, setIsEditing] = useState(false);
	const [editData, setEditData] = useState<EscalationNode[]>([]);

	const { fields, append, remove, update } = useFieldArray({
		control,
		name: "escalatedNotifications",
	});

	const notificationOptions = useMemo(
		() =>
			(notifications ?? []).map((n) => ({
				...n,
				name: n.notificationName,
			})),
		[notifications]
	);

	const watchedEscalations = watch("escalatedNotifications");

	const handleAddEscalation = () => {
		const newEscalation = {
			notificationIds: [],
			delayMinutes: 5,
		};
		append(newEscalation);
	};

	const handleEdit = () => {
		// Create editable copy of current data
		const currentData = (watchedEscalations || []).map((item: any, index: number) => ({
			id: `escalation-${index}`,
			delayMinutes: item.delayMinutes || 5,
			notificationIds: item.notificationIds || [],
			notifications: notificationOptions.filter((n) =>
				(item.notificationIds || []).includes(n.id)
			),
		}));
		setEditData(currentData);
		setIsEditing(true);
	};

	const handleSave = () => {
		// Clear existing fields
		const currentLength = fields.length;
		for (let i = currentLength - 1; i >= 0; i--) {
			remove(i);
		}

		// Add all edited fields
		editData.forEach((node) => {
			append({
				delayMinutes: node.delayMinutes,
				notificationIds: node.notificationIds,
			});
		});

		setIsEditing(false);
	};

	const handleCancel = () => {
		// Reset edit data to current form data
		const currentData = (watchedEscalations || []).map((item: any, index: number) => ({
			id: `escalation-${index}`,
			delayMinutes: item.delayMinutes || 5,
			notificationIds: item.notificationIds || [],
			notifications: notificationOptions.filter((n) =>
				(item.notificationIds || []).includes(n.id)
			),
		}));
		setEditData(currentData);
		setIsEditing(false);
	};

	const handleAddNode = () => {
		const newNode: EscalationNode = {
			id: `escalation-${editData.length}`,
			delayMinutes: 5,
			notificationIds: [],
			notifications: [],
		};
		setEditData([...editData, newNode]);
	};

	const handleRemoveNode = (index: number) => {
		setEditData(editData.filter((_, i) => i !== index));
	};

	const handleUpdateNode = (index: number, updates: Partial<EscalationNode>) => {
		const newData = [...editData];
		newData[index] = { ...newData[index], ...updates };
		setEditData(newData);
	};

	const renderNodeVisualization = () => {
		const data = isEditing
			? editData
			: (watchedEscalations || []).map((item: any, index: number) => ({
					id: `escalation-${index}`,
					delayMinutes: item.delayMinutes || 5,
					notificationIds: item.notificationIds || [],
					notifications: notificationOptions.filter((n) =>
						(item.notificationIds || []).includes(n.id)
					),
				}));

		return (
			<Box
				sx={{
					minHeight: 300,
					p: 2,
					border: `1px solid ${theme.palette.divider}`,
					borderRadius: 1,
				}}
			>
				{data.length === 0 ? (
					<Typography
						color="text.secondary"
						align="center"
						sx={{ py: 4 }}
					>
						{t("pages.createMonitor.form.escalatedNotifications.empty")}
					</Typography>
				) : (
					<Stack spacing={2}>
						{data.map((node, index) => (
							<Paper
								key={node.id}
								elevation={1}
								sx={{
									p: 2,
									backgroundColor: theme.palette.background.paper,
									border: `2px solid ${theme.palette.primary.main}`,
									position: "relative",
								}}
							>
								{isEditing && (
									<IconButton
										size="small"
										onClick={() => handleRemoveNode(index)}
										sx={{ position: "absolute", top: 4, right: 4 }}
										aria-label="Remove escalation"
									>
										<Trash2 size={16} />
									</IconButton>
								)}
								<Typography
									variant="h6"
									gutterBottom
								>
									{t("pages.createMonitor.form.escalatedNotifications.escalationLevel", {
										number: index + 1,
									})}
								</Typography>
								<Typography
									variant="body2"
									color="text.secondary"
								>
									{t("pages.createMonitor.form.escalatedNotifications.delayMinutes")}:{" "}
									{node.delayMinutes} minutes
								</Typography>
								<Typography
									variant="body2"
									color="text.secondary"
								>
									{t("pages.createMonitor.form.escalatedNotifications.notifications")}:{" "}
									{node.notifications.length}
								</Typography>
								{index < data.length - 1 && (
									<Box sx={{ mt: 1, display: "flex", justifyContent: "center" }}>
										<Typography
											variant="caption"
											color="text.secondary"
										>
											↓
										</Typography>
									</Box>
								)}
							</Paper>
						))}
					</Stack>
				)}
			</Box>
		);
	};

	const renderJsonView = () => {
		const data = isEditing
			? editData
			: (watchedEscalations || []).map((item: any, index: number) => ({
					delayMinutes: item.delayMinutes || 5,
					notificationIds: item.notificationIds || [],
				}));

		return (
			<Paper
				sx={{
					p: 2,
					backgroundColor: theme.palette.grey[50],
					fontFamily: "monospace",
					fontSize: "0.875rem",
					minHeight: 300,
					overflow: "auto",
				}}
			>
				<pre>{JSON.stringify(data, null, 2)}</pre>
			</Paper>
		);
	};

	const renderEditForm = () => (
		<Stack spacing={theme.spacing(LAYOUT.MD)}>
			{editData.map((node, index) => (
				<Paper
					key={node.id}
					sx={{ p: 2, border: `1px solid ${theme.palette.divider}` }}
				>
					<Typography
						variant="subtitle2"
						gutterBottom
					>
						{t("pages.createMonitor.form.escalatedNotifications.escalationLevel", {
							number: index + 1,
						})}
					</Typography>
					<Stack spacing={2}>
						<TextField
							type="number"
							fieldLabel={t(
								"pages.createMonitor.form.escalatedNotifications.delayMinutes"
							)}
							value={node.delayMinutes}
							onChange={(e) =>
								handleUpdateNode(index, { delayMinutes: parseInt(e.target.value) || 5 })
							}
							inputProps={{ min: 1, max: 10080 }}
							fullWidth
						/>
						<Autocomplete
							multiple
							options={notificationOptions}
							value={node.notifications}
							getOptionLabel={(option) => option.name}
							onChange={(_, newValue) => {
								const notificationIds = newValue.map((n) => n.id);
								const notifications = newValue;
								handleUpdateNode(index, { notificationIds, notifications });
							}}
							isOptionEqualToValue={(option, value) => option.id === value.id}
							fieldLabel={t(
								"pages.createMonitor.form.escalatedNotifications.selectNotifications"
							)}
						/>
					</Stack>
				</Paper>
			))}
			<Button
				variant="outlined"
				onClick={handleAddNode}
				startIcon={<Plus size={16} />}
				fullWidth
			>
				{t("pages.createMonitor.form.escalatedNotifications.addButton")}
			</Button>
		</Stack>
	);

	if (!notifications || notifications.length === 0) {
		return null;
	}

	return (
		<ConfigBox
			title={t("pages.createMonitor.form.escalatedNotifications.title")}
			subtitle={t("pages.createMonitor.form.escalatedNotifications.description")}
			rightContent={
				<Stack
					spacing={theme.spacing(LAYOUT.MD)}
					width="100%"
				>
					{/* Action Buttons */}
					<Stack
						direction="row"
						spacing={1}
						justifyContent="flex-end"
					>
						{!isEditing ? (
							<Button
								variant="outlined"
								onClick={handleEdit}
								startIcon={<Edit3 size={16} />}
								size="small"
							>
								{t("common.edit", "Edit")}
							</Button>
						) : (
							<>
								<Button
									variant="contained"
									onClick={handleSave}
									startIcon={<Save size={16} />}
									size="small"
									color="primary"
								>
									{t("common.save", "Save")}
								</Button>
								<Button
									variant="outlined"
									onClick={handleCancel}
									startIcon={<X size={16} />}
									size="small"
									color="secondary"
								>
									{t("common.cancel", "Cancel")}
								</Button>
							</>
						)}
					</Stack>

					{/* Main Content */}
					{isEditing ? (
						<Stack
							direction={{ xs: "column", md: "row" }}
							spacing={2}
						>
							{/* JSON View */}
							<Box sx={{ flex: 1 }}>
								<Typography
									variant="h6"
									gutterBottom
								>
									JSON View
								</Typography>
								{renderJsonView()}
							</Box>

							{/* Edit Form */}
							<Box sx={{ flex: 1 }}>
								<Typography
									variant="h6"
									gutterBottom
								>
									Edit Escalations
								</Typography>
								{renderEditForm()}
							</Box>
						</Stack>
					) : (
						<Stack
							direction={{ xs: "column", md: "row" }}
							spacing={2}
						>
							{/* JSON View */}
							<Box sx={{ flex: 1 }}>
								<Typography
									variant="h6"
									gutterBottom
								>
									JSON View
								</Typography>
								{renderJsonView()}
							</Box>

							{/* Node Visualization */}
							<Box sx={{ flex: 1 }}>
								<Typography
									variant="h6"
									gutterBottom
								>
									Node Visualization
								</Typography>
								{renderNodeVisualization()}
							</Box>
						</Stack>
					)}
				</Stack>
			}
		/>
	);
};
