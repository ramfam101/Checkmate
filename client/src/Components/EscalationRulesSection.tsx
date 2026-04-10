import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
	Stack,
	Button,
	Typography,
	IconButton,
	Divider,
	useTheme,
	Box,
} from "@mui/material";
import { Trash2 } from "lucide-react";
import type { EscalationRule } from "@/Types/Monitor";
import type { Notification } from "@/Types/Notification";
import { EscalationRuleModal } from "./EscalationRuleModal";
import { LAYOUT } from "@/Utils/Theme/constants";
import { ConfigBox } from "@/Components/design-elements/SplitBox";

interface EscalationRulesSectionProps {
	rules: EscalationRule[];
	notifications: Notification[];
	onRulesChange: (rules: EscalationRule[]) => void;
}

export const EscalationRulesSection = ({
	rules,
	notifications,
	onRulesChange,
}: EscalationRulesSectionProps) => {
	const theme = useTheme();
	const { t } = useTranslation();

	const [modalOpen, setModalOpen] = useState(false);
	const [editingRule, setEditingRule] = useState<EscalationRule | undefined>();

	const handleAddRule = () => {
		setEditingRule(undefined);
		setModalOpen(true);
	};

	const handleEditRule = (rule: EscalationRule, index: number) => {
		setEditingRule(rule);
		setModalOpen(true);
	};

	const handleSaveRule = (newRule: EscalationRule) => {
		if (editingRule !== undefined) {
			// Editing existing rule
			const updatedRules = [...rules];
			updatedRules[rules.indexOf(editingRule)] = newRule;
			onRulesChange(updatedRules);
		} else {
			// Adding new rule
			onRulesChange([...rules, newRule]);
		}
	};

	const handleDeleteRule = (index: number) => {
		const updatedRules = rules.filter((_, i) => i !== index);
		onRulesChange(updatedRules);
	};

	const getNotificationNames = (notificationIds: string[]): string => {
		return notificationIds
			.map((id) => {
				const notif = notifications.find((n) => n.id === id);
				return notif?.notificationName || id;
			})
			.join(", ");
	};

	return (
		<>
			<ConfigBox
				title={t("pages.common.monitors.escalationRules.title")}
				subtitle={t("pages.common.monitors.escalationRules.description")}
				rightContent={
					<Stack spacing={theme.spacing(LAYOUT.MD)} width="100%">
						{/* Add Rule Button */}
						<Button
							variant="outlined"
							onClick={handleAddRule}
							fullWidth
						>
							{t("pages.common.monitors.escalationRules.addButton")}
						</Button>

						{/* Rules List or Empty State */}
						{rules.length === 0 ? (
							<Typography variant="body2" color="textSecondary" sx={{ textAlign: "center", py: 2 }}>
								{t("pages.common.monitors.escalationRules.noRules")}
							</Typography>
						) : (
							<Stack spacing={0}>
								{rules.map((rule, index) => (
									<Box key={`rule-${index}`}>
										<Stack
											direction="row"
											alignItems="center"
											justifyContent="space-between"
											sx={{ py: theme.spacing(1.5), px: theme.spacing(1) }}
										>
											<Stack flex={1}>
												<Typography variant="body2" fontWeight={600}>
													{t("pages.common.monitors.escalationRules.table.time")} {rule.afterMinutes} {rule.afterMinutes === 1 ? "minute" : "minutes"}
												</Typography>
												<Typography variant="caption" color="textSecondary">
													{getNotificationNames(rule.notificationIds)}
												</Typography>
											</Stack>

											<IconButton
												size="small"
												onClick={() => handleDeleteRule(index)}
												sx={{
													color: "error.main",
													"&:hover": {
														backgroundColor: "error.lighter",
													},
												}}
											>
												<Trash2 size={16} />
											</IconButton>
										</Stack>
										{index < rules.length - 1 && <Divider />}
									</Box>
								))}
							</Stack>
						)}
					</Stack>
				}
			/>

			{/* Modal for creating/editing rules */}
			<EscalationRuleModal
				open={modalOpen}
				rule={editingRule}
				notifications={notifications}
				onSave={handleSaveRule}
				onClose={() => {
					setModalOpen(false);
					setEditingRule(undefined);
				}}
			/>
		</>
	);
};
