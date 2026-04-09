import { Request, Response, NextFunction } from "express";
import { updateAppSettingsBodyValidation } from "@/validation/settingsValidation.js";
import { sendTestEmailBodyValidation } from "@/validation/notificationValidation.js";
import { AppError } from "@/utils/AppError.js";
import { IEmailService, ISettingsService } from "@/service/index.js";
import { Settings } from "@/types/settings.js";
import { ILogger } from "@/utils/logger.js";

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
	private logger: ILogger;
	constructor(settingsService: ISettingsService, emailService: IEmailService, logger: ILogger) {
		this.settingsService = settingsService;
		this.emailService = emailService;
			this.logger = logger;
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

			// Validate required SMTP fields
			if (!systemEmailHost || !systemEmailPort || !systemEmailPassword || !systemEmailAddress) {
				this.logger.error({
					message: "Test email failed: Missing required SMTP configuration",
					service: "SettingsController",
					method: "sendTestEmail",
					details: {
						hasHost: !!systemEmailHost,
						hasPort: !!systemEmailPort,
						hasPassword: !!systemEmailPassword,
						hasAddress: !!systemEmailAddress,
						recipient: to,
					},
				});
				throw new AppError({
					message: "Missing required email configuration: Host, Port, Address, and Password are required.",
					status: 400,
					service: "SettingsController",
					method: "sendTestEmail",
				});
			}

			const subject = "This is a test email from Checkmate";
			const context = { testName: "Monitoring System" };

			this.logger.debug({
				message: "Building test email template",
				service: "SettingsController",
				method: "sendTestEmail",
			});

			const html = await this.emailService.buildEmail("testEmailTemplate", context);
			if (!html) {
				this.logger.error({
					message: "Failed to build email template",
					service: "SettingsController",
					method: "sendTestEmail",
				});
				throw new AppError({
					message: "Failed to build email template.",
					status: 500,
					service: "SettingsController",
					method: "sendTestEmail",
				});
			}

			this.logger.debug({
				message: "Sending test email",
				service: "SettingsController",
				method: "sendTestEmail",
				details: {
					recipient: to,
					host: systemEmailHost,
					port: systemEmailPort,
				},
			});

			const messageId = await this.emailService.sendEmail(to, subject, html, {
				systemEmailHost,
				systemEmailPort,
				systemEmailUser,
				systemEmailAddress,
				systemEmailPassword,
				systemEmailConnectionHost,
				systemEmailSecure,
				systemEmailPool,
				systemEmailIgnoreTLS,
				systemEmailRequireTLS,
				systemEmailRejectUnauthorized,
				systemEmailTLSServername,
			});

			if (!messageId) {
				this.logger.error({
					message: "Test email failed to send",
					service: "SettingsController",
					method: "sendTestEmail",
					details: { recipient: to, host: systemEmailHost },
				});
				throw new AppError({
					message: "Failed to send test email. Check server logs for detailed error.",
					status: 500,
					service: "SettingsController",
					method: "sendTestEmail",
					details: {
						recipient: to,
						host: systemEmailHost,
						port: systemEmailPort,
					},
				});
			}

			this.logger.info({
				message: "Test email sent successfully",
				service: "SettingsController",
				method: "sendTestEmail",
				details: { messageId, recipient: to },
			});

			return res.status(200).json({
				success: true,
				msg: "Test email sent successfully",
				data: { messageId },
			});
		} catch (error: unknown) {
			this.logger.error({
				message: `Error in sendTestEmail: ${error instanceof Error ? error.message : "Unknown error"}`,
				service: "SettingsController",
				method: "sendTestEmail",
				stack: error instanceof Error ? error.stack : undefined,
			});
			if (error instanceof AppError) {
				next(error);
			} else if (error instanceof Error) {
				next(
					new AppError({
						message: error.message || "Failed to send test email",
						status: 500,
						service: "SettingsController",
						method: "sendTestEmail",
					})
				);
			} else {
				next(
					new AppError({
						message: "Unknown error occurred while sending test email",
						status: 500,
						service: "SettingsController",
						method: "sendTestEmail",
					})
				);
			}
		}
	};
}

export default SettingsController;
