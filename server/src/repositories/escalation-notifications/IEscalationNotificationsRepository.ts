import type { EscalationNotification } from "@/types/index.js";

export interface IEscalationNotificationsRepository {
	// create
	create(escalationData: Partial<EscalationNotification>): Promise<EscalationNotification>;
	// fetch
	findById(id: string): Promise<EscalationNotification>;
	findByMonitorId(monitorId: string): Promise<EscalationNotification[]>;
	findActiveByMonitorId(monitorId: string): Promise<EscalationNotification[]>;
	findAllActive(): Promise<EscalationNotification[]>;
	// update
	updateById(id: string, updateData: Partial<EscalationNotification>): Promise<EscalationNotification>;
	// delete
	deleteById(id: string): Promise<EscalationNotification>;
	deleteByMonitorId(monitorId: string): Promise<number>;
}