import Autocomplete from "@mui/material/Autocomplete";
import type { AutocompleteProps } from "@mui/material/Autocomplete";
import { TextField, Checkbox } from "@/Components/inputs";
import Chip from "@mui/material/Chip";
import ListItem from "@mui/material/ListItem";
import Stack from "@mui/material/Stack";
import { useTheme } from "@mui/material/styles";
import { FieldLabel } from "./FieldLabel";
import { ChevronDown } from "lucide-react";

type AutoCompleteInputProps = Omit<
	AutocompleteProps<any, boolean, boolean, boolean>,
	"renderInput"
> & {
	renderInput?: AutocompleteProps<any, boolean, boolean, boolean>["renderInput"];
	fieldLabel?: string;
	required?: boolean;
};

export const AutoCompleteInput = ({
	fieldLabel,
	required,
	renderInput,
	...props
}: AutoCompleteInputProps) => {
	const theme = useTheme();
	const multiple = props.multiple;

	const defaultRenderInput = (params: any) => (
		<TextField
			{...params}
			inputProps={{
				...params.inputProps,
				autoComplete: "off",
			}}
			placeholder="Type to search"
		/>
	);

	const renderInputWithAutoCompleteOff = (params: any) => {
		const enhancedParams = {
			...params,
			inputProps: {
				...params.inputProps,
				autoComplete: "off",
			},
		};

		return (renderInput || defaultRenderInput)(enhancedParams);
	};

	const autocomplete = (
		<Autocomplete
			{...props}
			disableCloseOnSelect={!!multiple}
			popupIcon={
				<ChevronDown
					size={18}
					strokeWidth={1.5}
					style={{ marginRight: theme.spacing(3) }}
				/>
			}
			renderInput={renderInputWithAutoCompleteOff}
			getOptionKey={(option) => option.id}
			renderTags={(value, getTagProps) =>
				multiple &&
				value.map((option, index) => (
					<Chip
						label={option.name}
						{...getTagProps({ index })}
					/>
				))
			}
			renderOption={(props, option, { selected }) => {
				const { key, ...optionProps } = props;
				return (
					<ListItem
						key={key}
						{...optionProps}
					>
						<Stack
							direction={"row"}
							alignItems={"center"}
							gap={theme.spacing(2)}
						>
							{multiple && <Checkbox checked={selected} />}
							{option.name}
						</Stack>
					</ListItem>
				);
			}}
			sx={{
				"& .MuiAutocomplete-inputRoot": {
					flexWrap: "wrap",
					alignItems: multiple ? "flex-start" : "center",
					minHeight: multiple ? 56 : undefined,
				},
				"& .MuiAutocomplete-input": {
					padding: multiple ? `${theme.spacing(1.25)} ${theme.spacing(5)} ${theme.spacing(0.5)}` : `0 ${theme.spacing(5)}`,
				},
				"& .MuiInputBase-root .MuiAutocomplete-endAdornment": {
					right: theme.spacing(3),
				},
			}}
		/>
	);

	if (fieldLabel) {
		return (
			<Stack spacing={theme.spacing(2)}>
				<FieldLabel required={required}>{fieldLabel}</FieldLabel>
				{autocomplete}
			</Stack>
		);
	}

	return autocomplete;
};
