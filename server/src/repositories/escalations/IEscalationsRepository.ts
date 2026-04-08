import type { EscalationLogDocument } from "@/db/models/EscalationLog.js";

export interface IEscalationsRepository {
  findByIncidentAndChannel(incidentId: string, channelId: string): Promise<EscalationLogDocument | null>;
  create(data: {
    incidentId: string;
    monitorId: string;
    teamId: string;
    channelId: string;
    triggerTime: Date;
    sent: boolean;
  }): Promise<EscalationLogDocument>;
}