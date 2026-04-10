import { useFormContext, useFieldArray } from "react-hook-form";
import {
	Box,
	Typography,
	IconButton,
	TextField,
	Autocomplete,
	Divider,
} from "@mui/material";
import { Plus, Trash2 } from "lucide-react";

interface EscalationStep {
	delayMinutes: number;
	channelIds: string[];
	channelId?: string; // For backward compatibility
}

interface EscalationRulesProps {
	notificationOptions: Array<{ id: string; name: string; type: string }>;
}

export const EscalationRules = ({ notificationOptions }: EscalationRulesProps) => {
	const { control, watch, setValue } = useFormContext();
	const { fields, append, remove } = useFieldArray({
		control,
		name: "escalationSteps",
	});

	const watchedSteps: EscalationStep[] = watch("escalationSteps") || [];

	// Add escalation email option to notification options
	const escalationOptions = [
		...(notificationOptions || [])
	];

	const addStep = () => {
		append({ delayMinutes: 30, channelIds: [] });
	};

	const removeStep = (index: number) => {
		remove(index);
	};

	const updateDelay = (index: number, value: number) => {
		const currentSteps = [...watchedSteps];
		currentSteps[index] = { ...currentSteps[index], delayMinutes: value };
		setValue("escalationSteps", currentSteps, { shouldDirty: true });
	};

	const updateChannels = (index: number, channelIds: string[]) => {
		const currentSteps = [...watchedSteps];
		currentSteps[index] = { ...currentSteps[index], channelIds };
		setValue("escalationSteps", currentSteps, { shouldDirty: true });
	};

	return (
		<Box>
			<Typography variant="h6" gutterBottom>
				Escalation Rules
			</Typography>
			<Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
				Configure escalation steps that will trigger additional notifications if an incident remains unacknowledged.
			</Typography>

			{fields.map((field, index) => {
				const step: EscalationStep = watchedSteps[index] || { delayMinutes: 30, channelIds: [] };
				return (
				<Box key={field.id} sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
					<Box sx={{ flex: '0 0 200px' }}>
						<TextField
							fullWidth
							label="Delay (minutes)"
							type="number"
							value={step.delayMinutes || 30}
							onChange={(e) => updateDelay(index, parseInt(e.target.value) || 30)}
							inputProps={{ min: 1 }}
						/>
					</Box>
					<Box sx={{ flex: 1 }}>
						<Autocomplete
							multiple
							options={escalationOptions}
							getOptionLabel={(option) => `${option.name} (${option.type})`}
							value={escalationOptions.filter(opt => step.channelIds.includes(opt.id) || step.channelId === opt.id) || []}
							onChange={(_, newValue) => updateChannels(index, newValue.map(v => v.id))}
							renderInput={(params) => (
								<TextField {...params} label="Escalation Channels" fullWidth />
							)}
							isOptionEqualToValue={(option, value) => option.id === value.id}
						/>
						{(step.channelIds.length > 0 || step.channelId) && (
							<Box sx={{ mt: 1, p: 1, bgcolor: 'grey.50', borderRadius: 1 }}>
								<Typography variant="body2" sx={{ mb: 1, fontWeight: 'bold' }}>
									Selected Channels:
								</Typography>
								{escalationOptions
									.filter(opt => step.channelIds.includes(opt.id) || step.channelId === opt.id)
									.map((channel, channelIndex, channels) => (
										<Box key={channel.id}>
											<Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
												<Typography variant="body2" sx={{ flexGrow: 1 }}>
													{channel.name} ({channel.type})
												</Typography>
												<IconButton
													size="small"
													onClick={() => {
														const currentIds = step.channelIds || (step.channelId ? [step.channelId] : []);
														updateChannels(index, currentIds.filter((id: string) => id !== channel.id));
													}}
												>
													<Trash2 size={14} />
												</IconButton>
											</Box>
											{channelIndex < channels.length - 1 && <Divider />}
										</Box>
									))}
							</Box>
						)}
					</Box>
					<Box sx={{ flex: '0 0 50px', display: 'flex', justifyContent: 'center' }}>
						<IconButton onClick={() => removeStep(index)} color="error">
							<Trash2 />
						</IconButton>
					</Box>
				</Box>
				);
			})}

			<Box sx={{ mt: 2 }}>
				<IconButton onClick={addStep} color="primary">
					<Plus />
					<Typography variant="body2" sx={{ ml: 1 }}>
						Add Escalation Step
					</Typography>
				</IconButton>
			</Box>
		</Box>
	);
};