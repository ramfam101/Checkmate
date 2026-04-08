import type { EscalationDocument } from "@/db/models/Escalation.js";

export interface IEscalationsRepository {
	// create
	create(escalationData: Omit<EscalationDocument, "_id" | "createdAt" | "updatedAt" | "sentAt">): Promise<EscalationDocument>;
	// fetch
	findById(id: string): Promise<EscalationDocument | null>;
	findByIncidentId(incidentId: string, teamId: string): Promise<EscalationDocument[]>;
	findByIncidentAndNotification(incidentId: string, notificationId: string, teamId: string): Promise<EscalationDocument[]>;
	findPendingEscalations(currentTime: Date): Promise<EscalationDocument[]>;
	// update
	markAsSent(id: string, teamId: string): Promise<EscalationDocument>;
	// delete
	deleteByIncidentId(incidentId: string, teamId: string): Promise<void>;
}