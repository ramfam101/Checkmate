import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Box, IconButton, TextField, Stack, Typography } from "@mui/material";
import Autocomplete from "@mui/material/Autocomplete";
import { Trash2 } from "lucide-react";
import type { Notification } from "@/Types/Notification";

export type EscalationRule = { notificationId: string; delayMinutes: number };

interface Props {
	value?: EscalationRule[];
	onChange?: (rules: EscalationRule[]) => void;
	notifications?: Notification[] | null;
	disabled?: boolean;
}

/**
 * Single-rule escalation editor that behaves like notifications UI:
 * - Always-visible delay input
 * - Channel selector: when selected shows the channel as text with a trash button to remove
 * - Emits a single-element array (or empty array) via onChange
 */
export default function EscalationRulesEditor({
	value = [],
	onChange,
	notifications = [],
	disabled = false,
}: Props) {
	const { t } = useTranslation();

	const current =
		Array.isArray(value) && value.length > 0
			? value[0]
			: { notificationId: "", delayMinutes: 1 };

	const notificationOptions = useMemo(
		() =>
			(notifications ?? []).map((n) => ({ id: n.id, label: n.notificationName ?? n.id })),
		[notifications]
	);

	const setNotification = (id: string) => {
		onChange?.([{ notificationId: id, delayMinutes: Number(current.delayMinutes ?? 1) }]);
	};

	const clearNotification = () => {
		onChange?.([]);
	};

	const setDelay = (minutes: number) => {
		const next = { notificationId: current.notificationId ?? "", delayMinutes: minutes };
		// keep empty array if no channel selected
		onChange?.(current.notificationId ? [next] : []);
	};

	const selectedOption =
		notificationOptions.find((n) => n.id === current.notificationId) ?? null;

	return (
		<Box>
			<Stack
				direction="row"
				alignItems="center"
				justifyContent="space-between"
				mb={1}
			>
				<Box>
					<Typography variant="h6">
						{t("pages.createMonitor.form.escalation.title", "Escalation")}
					</Typography>
					<Typography
						component="span"
						color="text.secondary"
						sx={{ opacity: 0.9 }}
					>
						{t(
							"pages.createMonitor.form.escalation.description",
							"If an incident persists, automatically send an escalation alert."
						)}
					</Typography>
				</Box>
			</Stack>

			<Stack spacing={1}>
				<Typography
					component="span"
					color="text.secondary"
					sx={{ opacity: 0.9 }}
				>
					{t(
						"pages.createMonitor.form.escalation.option.delayMinutes",
						"Escalate after (minutes)"
					)}
				</Typography>

				<TextField
					sx={{ width: 160 }}
					value={String(current.delayMinutes ?? 1)}
					onChange={(e) => {
						const v = Number(e.target.value || 0);
						setDelay(Number.isNaN(v) ? 0 : v);
					}}
					type="number"
					inputProps={{ min: 1 }}
					size="small"
					aria-label={t(
						"pages.createMonitor.form.escalation.delayAria",
						"Escalate after minutes"
					)}
					disabled={disabled}
				/>

				<Typography
					component="span"
					color="text.secondary"
					sx={{ opacity: 0.9 }}
				>
					{t(
						"pages.createMonitor.form.escalation.option.escalationChannel",
						"Escalation notification channel"
					)}
				</Typography>

				{/* If a channel is selected, show it like the notifications list with a remove button */}
				{selectedOption ? (
					<Stack
						direction="row"
						alignItems="center"
						spacing={1}
					>
						<Typography flex={1}>{selectedOption.label}</Typography>
						<IconButton
							size="small"
							color="error"
							onClick={clearNotification}
							disabled={disabled}
							aria-label={t(
								"pages.createMonitor.form.escalation.remove",
								"Remove escalation channel"
							)}
						>
							<Trash2 size={14} />
						</IconButton>
					</Stack>
				) : (
					// Otherwise show selector
					<Autocomplete
						options={notificationOptions}
						getOptionLabel={(opt) => opt.label}
						value={null}
						onChange={(_, selected) => setNotification(selected?.id ?? "")}
						renderInput={(params) => (
							<TextField
								{...params}
								placeholder={t(
									"pages.createMonitor.form.escalation.option.selectChannel",
									"Select a channel"
								)}
								size="small"
							/>
						)}
						isOptionEqualToValue={(option, value) => option.id === value.id}
						disabled={disabled || notificationOptions.length === 0}
					/>
				)}
			</Stack>
		</Box>
	);
}
