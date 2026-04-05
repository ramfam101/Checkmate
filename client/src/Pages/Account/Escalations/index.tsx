import React, { useEffect, useState } from "react";

type Escalation = { delay: number; channel: string };

const Escalations: React.FC = () => {
	const [isEditing, setIsEditing] = useState(false);
	const [escalations, setEscalations] = useState<Escalation[]>([]);
	const [tempEscalations, setTempEscalations] = useState<Escalation[]>([]);

	useEffect(() => {
		// load data
		fetch("/api/monitor")
			.then((res) => res.json())
			.then((json) => {
				const data = json?.data?.escalations ?? [];
				setEscalations(data);
			})
			.catch((err) => console.error("Failed to load escalations", err));
	}, []);

	const onEdit = () => {
		setTempEscalations(escalations.map((e) => ({ ...e })));
		setIsEditing(true);
	};

	const onAdd = () => {
		setTempEscalations([...tempEscalations, { delay: 0, channel: "" }]);
	};

	const onSave = async () => {
		try {
			const res = await fetch("/api/monitor", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ escalations: tempEscalations }),
			});
			const json = await res.json();
			const data = json?.data?.escalations ?? tempEscalations;
			setEscalations(data);
			setIsEditing(false);
		} catch (err) {
			console.error("Failed to save escalations", err);
		}
	};

	const onCancel = () => {
		setTempEscalations([]);
		setIsEditing(false);
	};

	const updateTemp = (index: number, key: keyof Escalation, value: string | number) => {
		const copy = tempEscalations.map((e) => ({ ...e }));
		// @ts-ignore
		copy[index][key] = key === "delay" ? Number(value) : String(value);
		setTempEscalations(copy);
	};

	const hasEmptyNew = tempEscalations.some(
		(e) => e.channel === "" && Number(e.delay) === 0
	);

	return (
		<div style={{ display: "flex", gap: 20 }}>
			<div style={{ width: 400, background: "#f6f6f6", padding: 12, borderRadius: 6 }}>
				<h3>Escalations JSON</h3>
				<pre style={{ maxHeight: "70vh", overflow: "auto" }}>
					{JSON.stringify(escalations, null, 2)}
				</pre>
			</div>
			<div style={{ flex: 1 }}>
				<h2>Escalations</h2>
				{!isEditing ? (
					<div>
						{escalations.length === 0 ? (
							<p>No escalations configured</p>
						) : (
							<ul>
								{escalations.map((e, i) => (
									<li key={i}>
										Delay: {e.delay} — Channel: {e.channel}
									</li>
								))}
							</ul>
						)}
						<button onClick={onEdit}>Edit</button>
					</div>
				) : (
					<div>
						<h3>Editing escalations</h3>
						{tempEscalations.map((e, i) => (
							<div
								key={i}
								style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}
							>
								<label>
									Delay:
									<input
										type="number"
										value={e.delay}
										onChange={(ev) => updateTemp(i, "delay", Number(ev.target.value))}
									/>
								</label>
								<label>
									Channel:
									<input
										type="text"
										value={e.channel}
										onChange={(ev) => updateTemp(i, "channel", ev.target.value)}
									/>
								</label>
							</div>
						))}
						<div style={{ marginTop: 8 }}>
							<button
								onClick={onAdd}
								disabled={hasEmptyNew}
							>
								Add escalation
							</button>
						</div>
						<div style={{ marginTop: 12 }}>
							<button onClick={onSave}>Save</button>
							<button
								onClick={onCancel}
								style={{ marginLeft: 8 }}
							>
								Cancel
							</button>
						</div>
					</div>
				)}
			</div>
		</div>
	);
};

export default Escalations;
