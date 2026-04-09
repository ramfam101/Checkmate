import { useState } from "react";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import MenuItem from "@mui/material/MenuItem";
import IconButton from "@mui/material/IconButton";
import { useTheme } from "@mui/material/styles";
import { Trash2 } from "lucide-react";
import { ConfigBox } from "@/Components/design-elements";
import { TextField, Select } from "@/Components/inputs";
import { useGet } from "@/Hooks/UseApi";
import type { Notification } from "@/Types/Notification";
import type { EscalationRule } from "@/Types/Escalation";

interface EscalationRulesSectionProps {
	rules: EscalationRule[];
	onRulesChange: (rules: EscalationRule[]) => void;
	isLoading?: boolean;
}

export const EscalationRulesSection = ({
	rules,
	onRulesChange,
	isLoading = false,
}: EscalationRulesSectionProps) => {
	const theme = useTheme();
	const [delayMinutes, setDelayMinutes] = useState<number | string>("");
	const [selectedChannel, setSelectedChannel] = useState<string>("");

	const { data: notificationChannels } = useGet<Notification[]>("/notifications/team");
	const channels = notificationChannels ?? [];

	const handleChannelSelect = (channelId: string) => {
		setSelectedChannel(channelId);
		if (delayMinutes && channelId) {
			const newRule: EscalationRule = {
				delayMinutes: Number(delayMinutes),
				channels: [channelId],
			};
			onRulesChange([...rules, newRule]);
			setDelayMinutes("");
			setSelectedChannel("");
		}
	};

	const handleRemoveRule = (index: number) => {
		onRulesChange(rules.filter((_, i) => i !== index));
	};

	const sortedRules = [...rules].sort((a, b) => a.delayMinutes - b.delayMinutes);

	return (
		<ConfigBox
			title="Escalation Rules"
			subtitle="If the monitor stays down for the specified time, notify additional channels."
			rightContent={
				<Stack spacing={theme.spacing(6)} width="100%">
					{/* Input Fields */}
					<Stack spacing={theme.spacing(6)}>
						<TextField
							fieldLabel="Escalate after (minutes)"
							type="number"
							value={delayMinutes}
							onChange={(e) => setDelayMinutes(e.target.value)}
							inputProps={{ min: 1, max: 10080 }}
							fullWidth
							disabled={channels.length === 0 || isLoading}
						/>
						<Select
							fieldLabel="Escalation notification channels"
							value={selectedChannel}
							onChange={(e) => handleChannelSelect(e.target.value as string)}
							disabled={channels.length === 0 || isLoading}
							placeholder="Type to search"
							fullWidth
						>
							{channels.map((channel) => (
								<MenuItem key={channel.id} value={channel.id}>
									{channel.notificationName}
								</MenuItem>
							))}
						</Select>
					</Stack>

					{/* Rules List */}
					{sortedRules.length > 0 && (
						<Stack spacing={theme.spacing(2)}>
							{sortedRules.map((rule, index) => {
								const ruleChannels = channels.filter((c) =>
									rule.channels.includes(c.id)
								);

								return (
									<Stack
										key={index}
										direction="row"
										justifyContent="space-between"
										alignItems="center"
									>
										<Typography variant="body2">
											{ruleChannels.map((c) => c.notificationName).join(", ")}
										</Typography>
										<IconButton
											size="small"
											onClick={() =>
												handleRemoveRule(rules.indexOf(rule))
											}
											disabled={isLoading}
										>
											<Trash2 size={16} />
										</IconButton>
									</Stack>
								);
							})}
						</Stack>
					)}

					{channels.length === 0 && (
						<Typography variant="caption" color="error">
							Create notification channels before adding escalation rules
						</Typography>
					)}
				</Stack>
			}
		/>
	);
};
