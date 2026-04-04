import { useCallback } from "react";
import * as ApiClient from "@/Utils/ApiClient";
import type { EscalationPolicy, CreateEscalationPolicyRequest, UpdateEscalationPolicyRequest } from "@/Types/EscalationPolicy";

interface EscalationPoliciesResponse {
	policies: EscalationPolicy[];
	count: number;
}

export const useEscalationPolicies = () => {
	const getPolicies = useCallback(async () => {
		return ApiClient.get<EscalationPoliciesResponse>("/escalation-policies");
	}, []);

	const getPolicyById = useCallback(async (policyId: string) => {
		return ApiClient.get<EscalationPolicy>(`/escalation-policies/${policyId}`);
	}, []);

	const createPolicy = useCallback(async (data: CreateEscalationPolicyRequest) => {
		return ApiClient.post<EscalationPolicy>("/escalation-policies", data);
	}, []);

	const updatePolicy = useCallback(async (policyId: string, data: UpdateEscalationPolicyRequest) => {
		return ApiClient.patch<EscalationPolicy>(`/escalation-policies/${policyId}`, data);
	}, []);

	const deletePolicy = useCallback(async (policyId: string) => {
		return ApiClient.deleteOp<void>(`/escalation-policies/${policyId}`);
	}, []);

	return {
		getPolicies,
		getPolicyById,
		createPolicy,
		updatePolicy,
		deletePolicy,
	};
};
