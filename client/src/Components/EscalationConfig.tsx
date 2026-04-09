import React from "react";
import { t } from "i18next";

type EscalationRule = { delayMinutes: number; channelId: string };
type Props = {
	value?: EscalationRule[];
	onChange: (v: EscalationRule[]) => void;
	availableChannels: { id: string; name: string }[];
};

export default function EscalationConfig({
	value = [],
	onChange,
	availableChannels,
}: Props) {
	const addRule = () =>
		onChange([...value, { delayMinutes: 5, channelId: availableChannels[0]?.id ?? "" }]);
	const updateRule = (i: number, patch: Partial<EscalationRule>) => {
		const copy = [...value];
		copy[i] = { ...copy[i], ...patch };
		onChange(copy);
	};
	const removeRule = (i: number) => onChange(value.filter((_, idx) => idx !== i));

	return (
		<div>
			<label>{t("notifications.escalations.title")}</label>
			{value.map((r, i) => (
				<div
					key={i}
					style={{ display: "flex", gap: 8, marginTop: 8 }}
				>
					<input
						type="number"
						min={0}
						value={r.delayMinutes}
						onChange={(e) => updateRule(i, { delayMinutes: Number(e.target.value) })}
						aria-label={t("notifications.escalations.delay")}
					/>
					<select
						value={r.channelId}
						onChange={(e) => updateRule(i, { channelId: e.target.value })}
					>
						{availableChannels.map((c) => (
							<option
								key={c.id}
								value={c.id}
							>
								{c.name}
							</option>
						))}
					</select>
					<button
						type="button"
						onClick={() => removeRule(i)}
					>
						{t("common.remove")}
					</button>
				</div>
			))}
			<button
				type="button"
				onClick={addRule}
				style={{ marginTop: 8 }}
			>
				{t("notifications.escalations.add")}
			</button>
		</div>
	);
}
