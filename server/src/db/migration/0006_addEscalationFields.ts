import { MonitorModel } from "../models/Monitor.js";

export const addEscalationFields = async () => {
    await MonitorModel.updateMany(
        {},
        {
            $set: {
                escalationDelay: 0,
                escalationNotifications: [],
            },
        }
    );
};