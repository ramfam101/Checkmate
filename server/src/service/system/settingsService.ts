import { ISettingsRepository } from "@/repositories/index.js";
import { Settings, SettingsUpdate } from "@/types/index.js";
import { AppError } from "@/utils/AppError.js";
import { ValidatedEnv } from "@/validation/envValidation.js";
import type { StringValue } from "ms";
import type { EmailTransportConfig } from "@/types/email.js";
const SERVICE_NAME = "SettingsService";

export type EnvConfig = {
	jwtSecret: string;
	jwtTTL: StringValue;
	nodeEnv: string;
	logLevel: string;
	clientHost: string;
	dbConnectionString: string;
} & Partial<EmailTransportConfig>;

export interface ISettingsService {
	readonly serviceName: string;
	loadSettings(): EnvConfig;
	getSettings(): EnvConfig;
	getDBSettings(): Promise<Settings>;
	updateDbSettings(newSettings: SettingsUpdate): Promise<Settings>;
}

export class SettingsService implements ISettingsService {
	static SERVICE_NAME = SERVICE_NAME;
	private settings: EnvConfig;
	private settingsRepository: ISettingsRepository;

	constructor(settingsRepository: ISettingsRepository, env: ValidatedEnv) {
		this.settingsRepository = settingsRepository;
		this.settings = {
			jwtSecret: env.JWT_SECRET,
			jwtTTL: env.TOKEN_TTL as StringValue,
			nodeEnv: env.NODE_ENV,
			logLevel: env.LOG_LEVEL,
			clientHost: env.CLIENT_HOST,
			dbConnectionString: env.DB_CONNECTION_STRING,
			systemEmailHost: env.SYSTEM_EMAIL_HOST,
			systemEmailPort: env.SYSTEM_EMAIL_PORT,
			systemEmailAddress: env.SYSTEM_EMAIL_ADDRESS,
			systemEmailPassword: env.SYSTEM_EMAIL_PASSWORD,
			systemEmailUser: env.SYSTEM_EMAIL_USER,
			systemEmailConnectionHost: env.SYSTEM_EMAIL_CONNECTION_HOST,
			systemEmailTLSServername: env.SYSTEM_EMAIL_TLS_SERVERNAME,
			systemEmailSecure: env.SYSTEM_EMAIL_SECURE,
			systemEmailPool: env.SYSTEM_EMAIL_POOL,
			systemEmailIgnoreTLS: env.SYSTEM_EMAIL_IGNORE_TLS,
			systemEmailRequireTLS: env.SYSTEM_EMAIL_REQUIRE_TLS,
			systemEmailRejectUnauthorized: env.SYSTEM_EMAIL_REJECT_UNAUTHORIZED,
		};
	}

	get serviceName() {
		return SettingsService.SERVICE_NAME;
	}

	loadSettings() {
		return this.settings;
	}

	getSettings() {
		if (!this.settings) {
			throw new Error("Settings have not been loaded");
		}
		return this.settings;
	}

	updateDbSettings = async (newSettings: SettingsUpdate) => {
		return await this.settingsRepository.update(newSettings);
	};

	getDBSettings = async () => {
		// Remove any old settings
		await this.settingsRepository.deleteLegacy();

		let settings = await this.settingsRepository.findSingleton();
		if (settings === null) {
			await this.settingsRepository.create({});
			settings = await this.settingsRepository.findSingleton();
		}

		if (!settings) {
			throw new AppError({ message: "Settings not found", status: 500 });
		}

		return settings;
	};
}
