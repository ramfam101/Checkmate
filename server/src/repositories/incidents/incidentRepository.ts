import IncidentModel from "../../db/models/Incident.js";

export default {
	async findById(id: string) {
		return IncidentModel.findById(id).lean();
	},
	// add other helpers as needed
};
