import React, { useState, useEffect } from "react";
import { Box, TextField, Select, MenuItem, IconButton } from "@mui/material";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Notification } from "@/Types/Notification";

interface EscalationRule {
	notificationId: string;
	delayMinutes: number;
	escalationChannelId: string;
}

interface EscalationRulesProps {
	escalations: EscalationRule[];
	availableNotifications: Notification[];
	onChange: (escalations: EscalationRule[]) => void;
}

export const EscalationRules: React.FC<EscalationRulesProps> = ({
	escalations,
	availableNotifications,
	onChange,
}) => {
	const { t } = useTranslation();

	const getNotificationName = (id: string): string => {
		return availableNotifications.find((n) => n.id === id)?.notificationName || id;
	};

	const handleAddRule = () => {
		if (availableNotifications.length === 0) return;

		const newRule: EscalationRule = {
			notificationId: availableNotifications[0].id,
			delayMinutes: 3,
			escalationChannelId: "",
		};

		onChange([...escalations, newRule]);
	};

	const handleUpdateRule = (index: number, field: keyof EscalationRule, value: any) => {
		const updated = [...escalations];
		updated[index] = {
			...updated[index],
			[field]: field === "delayMinutes" ? parseInt(value) : value,
		};
		onChange(updated);
	};

	const handleDeleteRule = (index: number) => {
		onChange(escalations.filter((_, i) => i !== index));
	};

	return (
		<Box>
			{escalations.map((rule, index) => (
				<Box
					key={index}
					sx={{
						display: "flex",
						gap: 1,
						alignItems: "center",
						mb: 2,
					}}
				>
					{/* Delay Input */}
					<TextField
						type="number"
						size="small"
						inputProps={{ min: 1, max: 1440 }}
						value={rule.delayMinutes}
						onChange={(e) => handleUpdateRule(index, "delayMinutes", e.target.value)}
						sx={{ width: 120 }}
					/>

					{/* Escalation Channel Selector */}
					<Select
						size="small"
						displayEmpty
						value={rule.escalationChannelId}
						onChange={(e) => handleUpdateRule(index, "escalationChannelId", e.target.value)}
						sx={{ flex: 1, minWidth: 200 }}
					>
						<MenuItem value="">
							{t("common.typeToSearch", "Type to search")}
						</MenuItem>
						{availableNotifications.map((notification) => (
							<MenuItem key={notification.id} value={notification.id}>
								{notification.notificationName}
							</MenuItem>
						))}
					</Select>

					{/* Delete Button */}
					<IconButton
						size="small"
						color="error"
						onClick={() => handleDeleteRule(index)}
					>
						<Trash2 size={18} />
					</IconButton>
				</Box>
			))}

			{/* Add New Rule Button */}
			{escalations.length === 0 && (
				<Box sx={{ mt: 2 }}>
					<TextField
						type="number"
						size="small"
						placeholder="3"
						defaultValue={3}
						inputProps={{ min: 1, max: 1440 }}
						sx={{ width: 120, mr: 1 }}
						onChange={(e) => {
							// This is for the initial add
						}}
					/>
					<Select
						size="small"
						displayEmpty
						defaultValue=""
						sx={{ flex: 1, minWidth: 200, mr: 1, display: "inline-flex" }}
						onChange={(e) => {
							if (e.target.value) {
								const newRule: EscalationRule = {
									notificationId: availableNotifications[0]?.id || "",
									delayMinutes: 3,
									escalationChannelId: e.target.value,
								};
								onChange([newRule]);
							}
						}}
					>
						<MenuItem value="">
							{t("common.typeToSearch", "Type to search")}
						</MenuItem>
						{availableNotifications.map((notification) => (
							<MenuItem key={notification.id} value={notification.id}>
								{notification.notificationName}
							</MenuItem>
						))}
					</Select>
				</Box>
			)}
		</Box>
	);
};

export default EscalationRules;
