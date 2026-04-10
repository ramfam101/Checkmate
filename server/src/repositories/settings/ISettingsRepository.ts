import type { AppSettingsPatch, Settings, SettingsUpdate } from "@/types/index.js";
export interface ISettingsRepository {
	// create
	create(settings: Partial<Settings>): Promise<Settings>;
	// fetch
	findSingleton(): Promise<Settings | null>;
	// update
	update(settings: AppSettingsPatch): Promise<Settings>;
	// delete
	deleteLegacy: () => Promise<boolean>;
}
