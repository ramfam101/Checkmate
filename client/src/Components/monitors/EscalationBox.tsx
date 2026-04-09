import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import { ConfigBox } from "@/Components/design-elements";
import { useTranslation } from "react-i18next";
import type { Monitor } from "@/Types/Monitor";

interface EscalationBoxProps {
	monitor?: Monitor;
}

export const EscalationBox = ({ monitor }: EscalationBoxProps) => {
	const { t } = useTranslation();

	if (!monitor) {
		return null;
	}

	const delay = monitor.escalatedNotificationDelay ?? 0;
	const channels = monitor.escalationNotificationChannels || [];

	return (
		<ConfigBox
			title={t("pages.createMonitor.form.escalationRules.title")}
			subtitle={t("pages.createMonitor.form.escalationRules.description")}
			rightContent={
				<Stack spacing={2}>
					<Typography>
						{t("pages.createMonitor.form.escalationRules.option.delay.label")}: {delay} minutes
					</Typography>
					<Typography>
						{t("pages.createMonitor.form.escalationRules.option.channels.label")}
					</Typography>
					{channels.length > 0 ? (
						<Stack direction="row" flexWrap="wrap" gap={1}>
							{channels.map((channel) => (
								<Chip
									key={channel}
									label={channel}
									size="small"
								/>
							))}
						</Stack>
					) : (
						<Typography>{t("pages.common.none", "None")}</Typography>
					)}
				</Stack>
			}
		/>
	);
};
