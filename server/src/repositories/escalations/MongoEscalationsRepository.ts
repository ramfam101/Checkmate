import { EscalationLogModel, type EscalationLogDocument } from "@/db/models/EscalationLog.js";
import type { IEscalationsRepository } from "./IEscalationsRepository.js";

export class MongoEscalationsRepository implements IEscalationsRepository {
  async findByIncidentAndChannel(incidentId: string, channelId: string): Promise<EscalationLogDocument | null> {
    return EscalationLogModel.findOne({ incidentId, channelId }) ?? null;
  }

  async create(data: {
    incidentId: string;
    monitorId: string;
    teamId: string;
    channelId: string;
    triggerTime: Date;
    sent: boolean;
  }): Promise<EscalationLogDocument> {
    const log = new EscalationLogModel(data);
    return log.save();
  }
}

export default MongoEscalationsRepository;