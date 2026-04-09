import { useTranslation } from "react-i18next";
import { useTheme } from "@mui/material";
import Stack from "@mui/material/Stack";
import { ConfigBox } from "@/Components/design-elements";
import { TextField, Button } from "@/Components/inputs";
import { LAYOUT } from "@/Utils/Theme/constants";

interface EscalationRulesCardProps {
	escapeAfterMinutes?: number;
	onEscapeAfterMinutesChange: (value: number | undefined) => void;
	onClear?: () => void;
	isConfigured: boolean;
}

export const EscalationRulesCard = ({
	escapeAfterMinutes,
	onEscapeAfterMinutesChange,
	onClear,
	isConfigured,
}: EscalationRulesCardProps) => {
	const { t } = useTranslation();
	const theme = useTheme();

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
