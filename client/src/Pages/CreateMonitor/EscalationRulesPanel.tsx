import Stack from "@mui/material/Stack";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import FormHelperText from "@mui/material/FormHelperText";
import MenuItem from "@mui/material/MenuItem";
import Switch from "@mui/material/Switch";

import { TextField, Select } from "@/Components/inputs";

type EscalationChannel = {
	_id: string;
	name: string;
};

type EscalationErrors = {
	delayMinutes?: string;
	channelId?: string;
};

type EscalationRulesPanelProps = {
	enabled: boolean;
	delayMinutes: string;
	channelId: string;
	channels: EscalationChannel[];
	errors: EscalationErrors;
	onToggle: (enabled: boolean) => void;
	onDelayMinutesChange: (value: string) => void;
	onChannelChange: (value: string) => void;
};

export const EscalationRulesPanel = ({
	enabled,
	delayMinutes,
	channelId,
	channels,
	errors,
	onToggle,
	onDelayMinutesChange,
	onChannelChange,
}: EscalationRulesPanelProps) => {
	return (
		<Stack spacing={2}>
			<FormControlLabel
				control={
					<Switch
						checked={enabled}
						onChange={(event) => onToggle(event.target.checked)}
					/>
				}
				label="Enable escalation"
			/>

			{enabled && (
				<>
					<TextField
						type="number"
						fieldLabel="Delay (minutes)"
						value={delayMinutes}
						onChange={(event) => onDelayMinutesChange(event.target.value)}
						inputProps={{ min: 1, step: 1 }}
						error={Boolean(errors.delayMinutes)}
						helperText={errors.delayMinutes || ""}
					/>

					<FormControl error={Boolean(errors.channelId)}>
						<Select
							value={channelId}
							onChange={(event) => onChannelChange(event.target.value as string)}
							fieldLabel="Escalation channel"
						>
							<MenuItem value="">Select a channel</MenuItem>
							{channels.map((channel) => (
								<MenuItem key={channel._id} value={channel._id}>
									{channel.name}
								</MenuItem>
							))}
						</Select>
						{errors.channelId && <FormHelperText>{errors.channelId}</FormHelperText>}
					</FormControl>
				</>
			)}
		</Stack>
	);
};
