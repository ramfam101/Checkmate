import { useGet } from "@/Hooks/UseApi";
import type { EscalationPolicy } from "@/Types/EscalationPolicy";
import { BasePageWithStates } from "@/Components/design-elements";
import { HeaderCreate } from "@/Components/common";
import { useIsAdmin } from "@/Hooks/useIsAdmin";
import { EscalationPoliciesTable } from "./EscalationPoliciesTable";
import { useEscalationPolicies } from "@/Hooks/useEscalationPolicies";

interface EscalationPoliciesResponse {
	policies: EscalationPolicy[];
	count: number;
}

const EscalationPoliciesPage = () => {
	const isAdmin = useIsAdmin();
	const { deletePolicy } = useEscalationPolicies();

	const { data, isLoading, isValidating, error, refetch } =
		useGet<EscalationPoliciesResponse>(`/escalation-policies`);

	const policies = data?.policies ?? [];
	const policyCount = data?.count ?? 0;

	const handleDelete = async (policyId: string) => {
		await deletePolicy(policyId);
	};

	return (
		<BasePageWithStates
			page="Escalation Policies"
			totalCount={policyCount}
			bullets={[
				"Define escalation rules that trigger notifications at specific time intervals",
				"Automatically notify teams as incidents persist",
				"Customize escalation rules per policy",
			]}
			loading={isLoading}
			error={!!error}
			actionButtonText="Create Policy"
			actionLink="/escalation-policies/create"
		>
			<HeaderCreate
				path="/escalation-policies/create"
				isLoading={isLoading || isValidating}
				isAdmin={isAdmin}
			/>
			<EscalationPoliciesTable
				policies={policies}
				isLoading={isLoading || isValidating}
				onDelete={handleDelete}
				onRefresh={refetch}
			/>
		</BasePageWithStates>
	);
};

export default EscalationPoliciesPage;
