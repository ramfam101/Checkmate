import { useTranslation } from "react-i18next";
import { useTheme } from "@mui/material";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import { Trash2 } from "lucide-react";
import Divider from "@mui/material/Divider";
import { ConfigBox } from "@/Components/design-elements";
import { TextField, Autocomplete, Button } from "@/Components/inputs";
import { SPACING, LAYOUT } from "@/Utils/Theme/constants";
import type { Notification } from "@/Types/Notification";

interface EscalationRulesCardProps {
	escapeAfterMinutes?: number;
	escalationNotificationIds?: string[];
	onEscapeAfterMinutesChange: (value: number | undefined) => void;
	onEscalationNotificationIdsChange: (ids: string[]) => void;
	allNotifications: Notification[];
	onClear?: () => void;
	isConfigured: boolean;
}

export const EscalationRulesCard = ({
	escapeAfterMinutes,
	escalationNotificationIds,
	onEscapeAfterMinutesChange,
	onEscalationNotificationIdsChange,
	allNotifications,
	onClear,
	isConfigured,
}: EscalationRulesCardProps) => {
	const { t } = useTranslation();
	const theme = useTheme();

	const notificationOptions = (allNotifications ?? []).map((n) => ({
		...n,
		name: n.notificationName,
	}));

	const selectedNotifications = notificationOptions.filter((n) =>
		(escalationNotificationIds ?? []).includes(n.id)
	);

	return (
		<ConfigBox
			title={t("pages.createMonitor.form.escalation.title")}
			subtitle={t("pages.createMonitor.form.escalation.description")}
			rightContent={
				<Stack spacing={theme.spacing(LAYOUT.MD)}>
					<TextField
						type="number"
						fieldLabel={t("pages.createMonitor.form.escalation.escapeAfterMinutes.label")}
						placeholder={t(
							"pages.createMonitor.form.escalation.escapeAfterMinutes.placeholder"
						)}
						value={escapeAfterMinutes ?? ""}
						onChange={(e) => {
							const value = e.target.value ? parseInt(e.target.value, 10) : undefined;
							onEscapeAfterMinutesChange(value);
						}}
						fullWidth
						inputProps={{ min: 1, step: 1 }}
					/>

					<Autocomplete
						multiple
						options={notificationOptions}
						value={selectedNotifications}
						getOptionLabel={(option) => option.name}
						onChange={(_: unknown, newValue: typeof notificationOptions) => {
							onEscalationNotificationIdsChange(newValue.map((n) => n.id));
						}}
						isOptionEqualToValue={(option, value) => option.id === value.id}
						label={t(
							"pages.createMonitor.form.escalation.escalationNotificationChannels.label"
						)}
						placeholder={t(
							"pages.createMonitor.form.escalation.escalationNotificationChannels.placeholder"
						)}
					/>

					{selectedNotifications.length > 0 && (
						<Stack
							flex={1}
							width="100%"
						>
							{selectedNotifications.map((notification, index) => (
								<Stack
									direction="row"
									alignItems="center"
									key={notification.id}
									width="100%"
								>
									<Typography flexGrow={1}>{notification.notificationName}</Typography>
									<IconButton
										size="small"
										onClick={() => {
											onEscalationNotificationIdsChange(
												(escalationNotificationIds ?? []).filter(
													(id: string) => id !== notification.id
												)
											);
										}}
										aria-label="Remove escalation notification"
									>
										<Trash2 size={16} />
									</IconButton>
									{index < selectedNotifications.length - 1 && <Divider />}
								</Stack>
							))}
						</Stack>
					)}

					{isConfigured && onClear && (
						<Button
							variant="outlined"
							onClick={onClear}
							fullWidth
						>
							{t("pages.createMonitor.form.escalation.clearRules")}
						</Button>
					)}
				</Stack>
			}
		/>
	);
};
