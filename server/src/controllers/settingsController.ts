import { Request, Response, NextFunction } from "express";
import { updateAppSettingsBodyValidation } from "@/validation/settingsValidation.js";
import { sendTestEmailBodyValidation } from "@/validation/notificationValidation.js";
import { AppError } from "@/utils/AppError.js";
import { IEmailService, ISettingsService } from "@/service/index.js";
import { Settings } from "@/types/settings.js";

const SERVICE_NAME = "SettingsController";

export interface ISettingsController {
	serviceName: string;
	getAppSettings(req: Request, res: Response, next: NextFunction): Promise<Response | void>;
	updateAppSettings(req: Request, res: Response, next: NextFunction): Promise<Response | void>;
	sendTestEmail(req: Request, res: Response, next: NextFunction): Promise<Response | void>;
}

class SettingsController implements ISettingsController {
	static SERVICE_NAME = SERVICE_NAME;
	private settingsService: ISettingsService;
	private emailService: IEmailService;
	constructor(settingsService: ISettingsService, emailService: IEmailService) {
		this.settingsService = settingsService;
		this.emailService = emailService;
	}

	get serviceName() {
		return SettingsController.SERVICE_NAME;
	}

	buildAppSettings = (dbSettings: Settings) => {
		const sanitizedSettings: Record<string, unknown> = { ...dbSettings };
		delete sanitizedSettings.version;
		delete sanitizedSettings.jwtSecret;
		const returnSettings: Record<string, unknown | null> = {
			pagespeedKeySet: false,
			emailPasswordSet: false,
			settings: null,
		};

		if (typeof sanitizedSettings.pagespeedApiKey !== "undefined") {
			returnSettings.pagespeedKeySet = true;
			delete sanitizedSettings.pagespeedApiKey;
		}
		if (typeof sanitizedSettings.systemEmailPassword !== "undefined") {
			returnSettings.emailPasswordSet = true;
			delete sanitizedSettings.systemEmailPassword;
		}
		returnSettings.settings = sanitizedSettings;
		return returnSettings;
	};

	getAppSettings = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const dbSettings = await this.settingsService.getDBSettings();

			const returnSettings = this.buildAppSettings(dbSettings);
			return res.status(200).json({
				success: true,
				msg: "App settings fetched successfully",
				data: returnSettings,
			});
		} catch (error) {
			next(error);
		}
	};

	updateAppSettings = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const validatedBody = updateAppSettingsBodyValidation.parse(req.body);

			const updatedSettings = await this.settingsService.updateDbSettings(validatedBody);
			const returnSettings = this.buildAppSettings(updatedSettings);
			return res.status(200).json({
				success: true,
				msg: "App settings updated successfully",
				data: returnSettings,
			});
		} catch (error) {
			next(error);
		}
	};

	sendTestEmail = async (req: Request, res: Response, next: NextFunction) => {
		try {
			sendTestEmailBodyValidation.parse(req.body);

			const {
				to,
				systemEmailHost,
				systemEmailPort,
				systemEmailAddress,
				systemEmailPassword,
				systemEmailUser,
				systemEmailConnectionHost,
				systemEmailSecure,
				systemEmailPool,
				systemEmailIgnoreTLS,
				systemEmailRequireTLS,
				systemEmailRejectUnauthorized,
				systemEmailTLSServername,
			} = req.body;
			const savedSettings = await this.settingsService.getDBSettings();
			const transportConfig = {
				systemEmailHost: systemEmailHost ?? savedSettings.systemEmailHost,
				systemEmailPort: systemEmailPort ?? savedSettings.systemEmailPort,
				systemEmailUser: systemEmailUser ?? savedSettings.systemEmailUser,
				systemEmailAddress: systemEmailAddress ?? savedSettings.systemEmailAddress,
				systemEmailPassword: systemEmailPassword ?? savedSettings.systemEmailPassword,
				systemEmailConnectionHost:
					systemEmailConnectionHost ?? savedSettings.systemEmailConnectionHost,
				systemEmailSecure: systemEmailSecure ?? savedSettings.systemEmailSecure,
				systemEmailPool: systemEmailPool ?? savedSettings.systemEmailPool,
				systemEmailIgnoreTLS:
					systemEmailIgnoreTLS ?? savedSettings.systemEmailIgnoreTLS,
				systemEmailRequireTLS:
					systemEmailRequireTLS ?? savedSettings.systemEmailRequireTLS,
				systemEmailRejectUnauthorized:
					systemEmailRejectUnauthorized ?? savedSettings.systemEmailRejectUnauthorized,
				systemEmailTLSServername:
					systemEmailTLSServername ?? savedSettings.systemEmailTLSServername,
			};

			if (
				!transportConfig.systemEmailHost ||
				!transportConfig.systemEmailPort ||
				!transportConfig.systemEmailAddress ||
				!transportConfig.systemEmailPassword
			) {
				throw new AppError({
					message:
						"Email settings are incomplete. Save SMTP host, port, address, and password before sending a test email.",
					status: 400,
				});
			}

			const subject = "This is a test email from Checkmate";
			const context = { testName: "Monitoring System" };

			const html = await this.emailService.buildEmail("testEmailTemplate", context);
			if (!html) {
				throw new AppError({ message: "Failed to build email template.", status: 500 });
			}
			const messageId = await this.emailService.sendEmail(to, subject, html, {
				...transportConfig,
			});

			if (!messageId) {
				throw new AppError({ message: "Failed to send test email.", status: 500 });
			}

			return res.status(200).json({
				success: true,
				msg: "Test email sent successfully",
				data: { messageId },
			});
		} catch (error) {
			next(error);
		}
	};
}

export default SettingsController;
