import type { Team } from "@/types/index.js";
export interface ITeamsRepository {
	// create
	create(email: string): Promise<Team>;
	// fetch
	findById(id: string): Promise<Team | null>;
	// update
	// delete
	// other
	findAllTeamIds(): Promise<string[]>;
}
