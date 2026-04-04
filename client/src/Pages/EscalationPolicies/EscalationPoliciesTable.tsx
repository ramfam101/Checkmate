import { Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper, IconButton, Chip, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button } from "@mui/material";
import { useNavigate } from "react-router";
import type { EscalationPolicy } from "@/Types/EscalationPolicy";
import { useState } from "react";

interface EscalationPoliciesTableProps {
	policies: EscalationPolicy[];
	isLoading: boolean;
	onDelete: (policyId: string) => Promise<void>;
	onRefresh: () => void;
}

export const EscalationPoliciesTable = ({ policies, isLoading, onDelete, onRefresh }: EscalationPoliciesTableProps) => {
	const navigate = useNavigate();
	const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
	const [selectedPolicyId, setSelectedPolicyId] = useState<string | null>(null);
	const [isDeleting, setIsDeleting] = useState(false);

	const handleDeleteClick = (policyId: string) => {
		setSelectedPolicyId(policyId);
		setDeleteConfirmOpen(true);
	};

	const handleConfirmDelete = async () => {
		if (!selectedPolicyId) return;
		try {
			setIsDeleting(true);
			await onDelete(selectedPolicyId);
			onRefresh();
			setDeleteConfirmOpen(false);
		} finally {
			setIsDeleting(false);
		}
	};

	if (policies.length === 0) {
		return (
			<Paper sx={{ p: 3, textAlign: "center", color: "#666" }}>
				No escalation policies created yet. Create one to get started!
			</Paper>
		);
	}

	return (
		<>
			<TableContainer component={Paper}>
				<Table>
					<TableHead>
						<TableRow sx={{ backgroundColor: "#f5f5f5" }}>
							<TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
							<TableCell sx={{ fontWeight: 600 }}>Description</TableCell>
							<TableCell sx={{ fontWeight: 600 }} align="center">
								Rules
							</TableCell>
							<TableCell sx={{ fontWeight: 600 }} align="center">
								Status
							</TableCell>
							<TableCell sx={{ fontWeight: 600 }} align="right">
								Actions
							</TableCell>
						</TableRow>
					</TableHead>
					<TableBody>
						{policies.map((policy) => (
							<TableRow key={policy.id} hover>
								<TableCell sx={{ fontWeight: 500 }}>{policy.name}</TableCell>
								<TableCell>{policy.description || "-"}</TableCell>
								<TableCell align="center">
									<Chip label={`${policy.rules.length}`} size="small" variant="outlined" />
								</TableCell>
								<TableCell align="center">
									<Chip label={policy.enabled ? "Enabled" : "Disabled"} size="small" color={policy.enabled ? "success" : "default"} variant="filled" />
								</TableCell>
								<TableCell align="right">
									<IconButton size="small" onClick={() => navigate(`/escalation-policies/configure/${policy.id}`)} disabled={isLoading || isDeleting} title="Edit">
										✏️
									</IconButton>
									<IconButton size="small" color="error" onClick={() => handleDeleteClick(policy.id)} disabled={isLoading || isDeleting} title="Delete">
										🗑️
									</IconButton>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</TableContainer>

			<Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)}>
				<DialogTitle>Delete Escalation Policy</DialogTitle>
				<DialogContent>
					<DialogContentText>Are you sure you want to delete this escalation policy? This action cannot be undone.</DialogContentText>
				</DialogContent>
				<DialogActions>
					<Button onClick={() => setDeleteConfirmOpen(false)} disabled={isDeleting}>
						Cancel
					</Button>
					<Button onClick={handleConfirmDelete} color="error" disabled={isDeleting} variant="contained">
						Delete
					</Button>
				</DialogActions>
			</Dialog>
		</>
	);
};
