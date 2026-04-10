import { usePost, usePut } from "@/Hooks/UseApi";
import type { Monitor } from "@/Types/Monitor";

interface EscalationRule {
	notificationId: string;
	delayMinutes: number;
	escalationChannelId: string;
}

interface SaveEscalationsResponse {
	monitor: Monitor;
}

interface UseEscalationsReturn {
	saveEscalations: (monitorId: string, escalations: EscalationRule[]) => Promise<void>;
	acknowledge: (incidentId: string) => Promise<void>;
	isLoading: boolean;
	error: string | null;
}

/**
 * Custom hook for managing notification escalations
 * Handles API calls for updating escalation rules and acknowledging incidents
 */
export const useEscalations = (): UseEscalationsReturn => {
	const { post, loading: postLoading, error: postError } = usePost();
	const { put, loading: putLoading, error: putError } = usePut();

	const isLoading = postLoading || putLoading;
	const error = postError || putError;

	const saveEscalations = async (
		monitorId: string,
		escalations: EscalationRule[]
	): Promise<void> => {
		const payload = {
			monitorId,
			escalations,
		};
		console.log("useEscalations - Sending POST /monitors/escalations with payload:", payload);
		const response = await post(`/monitors/escalations`, payload);
		console.log("useEscalations - Response:", response);

		if (!response?.success) {
			throw new Error(response?.msg || "Failed to update escalation rules");
		}
	};

	const acknowledge = async (incidentId: string): Promise<void> => {
		const response = await put(`/incidents/${incidentId}/acknowledge`, {});

		if (!response?.success) {
			throw new Error(response?.msg || "Failed to acknowledge incident");
		}
	};

	return {
		saveEscalations,
		acknowledge,
		isLoading,
		error,
	};
};

export default useEscalations;
