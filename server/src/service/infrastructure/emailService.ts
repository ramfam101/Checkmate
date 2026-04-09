import { fileURLToPath } from "url";
import { EmailTransportConfig } from "@/types/index.js";
import { ISettingsService } from "@/service/system/settingsService.js";
import { ILogger } from "@/utils/logger.js";
import fs from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";
import mjml2html from "mjml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVICE_NAME = "EmailService";
type MjmlFn = typeof mjml2html;
type FileSystem = typeof fs;
type PathModule = typeof path;
type Mailer = typeof nodemailer;
type TemplateCompiler = (template: string) => (context: Record<string, unknown>) => string;

export interface IEmailService {
	init(): void;
	buildEmail(template: string, context: Record<string, unknown>): Promise<string | undefined>;
	sendEmail(to: string, subject: string, html: string, transportConfig?: EmailTransportConfig): Promise<string | false | undefined>;
}

export class EmailService implements IEmailService {
	static SERVICE_NAME = SERVICE_NAME;

	private settingsService: ISettingsService;
	private fs: FileSystem;
	private path: PathModule;
	private compile: TemplateCompiler;
	private mjml2html: MjmlFn;
	private nodemailer: Mailer;
	private logger: ILogger;
	private transporter: ReturnType<typeof import("nodemailer").createTransport> | null = null;
	private templateLookup: Record<string, ((context: Record<string, unknown>) => string) | undefined>;
	private loadTemplate: (templateName: string) => ((context: Record<string, unknown>) => string) | undefined;
	private resolveTemplatePath: (templateName: string) => string | undefined;

	constructor(
		settingsService: ISettingsService,
		fs: FileSystem,
		path: PathModule,
		compile: TemplateCompiler,
		mjml2html: MjmlFn,
		nodemailer: Mailer,
		logger: ILogger
	) {
		this.settingsService = settingsService;
		this.fs = fs;
		this.path = path;
		this.compile = compile;
		this.mjml2html = mjml2html;
		this.nodemailer = nodemailer;
		this.logger = logger;
		this.templateLookup = {};
		this.loadTemplate = () => undefined;
		this.resolveTemplatePath = () => undefined;
		this.init();
	}

	get serviceName() {
		return EmailService.SERVICE_NAME;
	}

	init = () => {
		this.resolveTemplatePath = (templateName) => {
			const candidates = [
				this.path.join(__dirname, `../../templates/${templateName}.mjml`),
				this.path.join(process.cwd(), `dist/templates/${templateName}.mjml`),
				this.path.join(process.cwd(), `src/templates/${templateName}.mjml`),
				this.path.join(process.cwd(), `templates/${templateName}.mjml`),
			];

			for (const candidate of candidates) {
				if (this.fs.existsSync(candidate)) {
					return candidate;
				}
			}

			this.logger.error({
				message: `Template ${templateName} not found in expected locations`,
				service: SERVICE_NAME,
				method: "resolveTemplatePath",
				details: { candidates },
			});

			return undefined;
		};

		this.loadTemplate = (templateName) => {
			try {
				const templatePath = this.resolveTemplatePath(templateName);
				if (!templatePath) {
					return undefined;
				}
				const templateContent = this.fs.readFileSync(templatePath, "utf8");
				return this.compile(templateContent);
			} catch (error: unknown) {
				this.logger.error({
					message: error instanceof Error ? error.message : "Unknown error",
					service: SERVICE_NAME,
					method: "loadTemplate",
					stack: error instanceof Error ? error.stack : undefined,
				});
			}
		};

		this.templateLookup = {
			welcomeEmailTemplate: this.loadTemplate("welcomeEmail"),
			employeeActivationTemplate: this.loadTemplate("employeeActivation"),
			noIncidentsThisWeekTemplate: this.loadTemplate("noIncidentsThisWeek"),
			passwordResetTemplate: this.loadTemplate("passwordReset"),
			testEmailTemplate: this.loadTemplate("testEmailTemplate"),
			unifiedNotificationTemplate: this.loadTemplate("unifiedNotification"),
		};
	};

	buildEmail = async (template: string, context: Record<string, unknown>) => {
		try {
			const mjml = this.templateLookup[template]?.(context);
			if (!mjml) {
				throw new Error(`Template ${template} not found`);
			}
			const renderResult = await this.mjml2html(mjml);

			if (renderResult.errors?.length) {
				this.logger.warn({
					message: `MJML render warnings for template ${template}`,
					service: SERVICE_NAME,
					method: "buildEmail",
					details: {
						errors: renderResult.errors,
					},
				});
			}

			if (!renderResult.html || !renderResult.html.trim()) {
				this.logger.error({
					message: `MJML render produced empty HTML for template ${template}`,
					service: SERVICE_NAME,
					method: "buildEmail",
					details: {
						hasErrors: Boolean(renderResult.errors?.length),
						errors: renderResult.errors,
					},
				});
				return undefined;
			}

			return renderResult.html;
		} catch (error: unknown) {
			this.logger.error({
				message: error instanceof Error ? error.message : "Unknown error",
				service: SERVICE_NAME,
				method: "buildEmail",
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	};

	sendEmail = async (to: string, subject: string, html: string, transportConfig?: EmailTransportConfig) => {
		let config: EmailTransportConfig;
		if (typeof transportConfig !== "undefined") {
			config = transportConfig;
		} else {
			config = await this.settingsService.getDBSettings();
		}
		const {
			systemEmailHost,
			systemEmailPort,
			systemEmailSecure,
			systemEmailPool,
			systemEmailUser,
			systemEmailAddress,
			systemEmailPassword,
			systemEmailConnectionHost,
			systemEmailTLSServername,
			systemEmailIgnoreTLS,
			systemEmailRequireTLS,
			systemEmailRejectUnauthorized,
		} = config;

		// Validate required configuration
		if (!systemEmailHost || !systemEmailPort || !systemEmailPassword || !systemEmailAddress) {
			this.logger.error({
				message: "Email configuration is incomplete. Missing required fields for SMTP.",
				service: SERVICE_NAME,
				method: "sendEmail",
				details: {
					hasHost: !!systemEmailHost,
					hasPort: !!systemEmailPort,
					hasPassword: !!systemEmailPassword,
					hasAddress: !!systemEmailAddress,
				},
			});
			return false;
		}

		const sanitizedUser = systemEmailUser?.trim() || systemEmailAddress?.trim();
		const sanitizedConnectionHost = systemEmailConnectionHost?.trim() || undefined;
		const sanitizedTLSServername = systemEmailTLSServername?.trim() || undefined;
		const normalizedHost = systemEmailHost?.trim().toLowerCase();
		const normalizedPort = Number(systemEmailPort);
		const isGmailSmtp = normalizedHost === "smtp.gmail.com";
		const gmailOnSubmissionPort = isGmailSmtp && normalizedPort === 587;

		const effectiveRequireTLS = gmailOnSubmissionPort ? true : Boolean(systemEmailRequireTLS);
		const effectiveIgnoreTLS = gmailOnSubmissionPort ? false : Boolean(systemEmailIgnoreTLS);
		const effectiveSecure = Boolean(systemEmailSecure);

		// Avoid forcing EHLO name to localhost for public SMTP services like Gmail.
		const effectiveConnectionHost =
			sanitizedConnectionHost && sanitizedConnectionHost.toLowerCase() !== "localhost"
				? sanitizedConnectionHost
				: undefined;

		const emailConfig = {
			host: systemEmailHost,
			port: normalizedPort,
			secure: effectiveSecure,
			auth: {
				user: sanitizedUser,
				pass: systemEmailPassword,
			},
			connectionTimeout: 10000,
			pool: Boolean(systemEmailPool),
			ignoreTLS: effectiveIgnoreTLS,
			requireTLS: effectiveRequireTLS,
			tls: {
				rejectUnauthorized:
					typeof systemEmailRejectUnauthorized === "boolean" ? systemEmailRejectUnauthorized : true,
				...(sanitizedTLSServername ? { servername: sanitizedTLSServername } : {}),
			},
			...(effectiveConnectionHost ? { name: effectiveConnectionHost } : {}),
		};

		this.logger.debug({
			message: "Creating email transporter with configuration",
			service: SERVICE_NAME,
			method: "sendEmail",
			details: {
				host: systemEmailHost,
				port: systemEmailPort,
				secure: effectiveSecure,
				requireTLS: effectiveRequireTLS,
				ignoreTLS: effectiveIgnoreTLS,
				isGmailSmtp,
				user: systemEmailUser || systemEmailAddress,
				pool: systemEmailPool,
			},
		});

		this.transporter = this.nodemailer.createTransport(emailConfig);

		try {
			await this.transporter.verify();
			this.logger.debug({
				message: "Email transporter verified successfully",
				service: SERVICE_NAME,
				method: "sendEmail",
			});
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error";
			const typedError = error as {
				code?: string;
				response?: string;
				command?: string;
			};
			this.logger.error({
				message: `Email transporter verification failed: ${errorMessage}`,
				service: SERVICE_NAME,
				method: "sendEmail",
				details: {
					host: systemEmailHost,
					port: systemEmailPort,
					user: sanitizedUser,
					code: typedError.code,
					response: typedError.response,
					command: typedError.command,
				},
				stack: error instanceof Error ? error.stack : undefined,
			});
			return false;
		}

		try {
			this.logger.debug({
				message: "Sending email",
				service: SERVICE_NAME,
				method: "sendEmail",
				details: {
					to,
					from: systemEmailAddress,
					subject,
				},
			});

			const info = await this.transporter.sendMail({
				to: to,
				from: systemEmailAddress,
				subject: subject,
				html: html,
			});

			this.logger.info({
				message: "Email sent successfully",
				service: SERVICE_NAME,
				method: "sendEmail",
				details: {
					messageId: info?.messageId,
					to,
					from: systemEmailAddress,
				},
			});

			return info?.messageId;
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : "Unknown error";
			const typedError = error as {
				code?: string;
				response?: string;
				command?: string;
			};
			this.logger.error({
				message: `Email send failed: ${errorMessage}`,
				service: SERVICE_NAME,
				method: "sendEmail",
				details: {
					recipient: to,
					from: systemEmailAddress,
					subject,
					code: typedError.code,
					response: typedError.response,
					command: typedError.command,
				},
				stack: error instanceof Error ? error.stack : undefined,
			});
			return false;
		}
	};
}
