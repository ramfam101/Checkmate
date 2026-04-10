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
		this.init();
	}

	get serviceName() {
		return EmailService.SERVICE_NAME;
	}

	private normalizeString = (value?: string) => {
		if (typeof value !== "string") {
			return undefined;
		}
		const normalized = value.trim();
		return normalized.length > 0 ? normalized : undefined;
	};

	init = () => {
		this.loadTemplate = (templateName) => {
			try {
				const templatePath = this.path.join(__dirname, `../../templates/${templateName}.mjml`);
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
			const html = await this.mjml2html(mjml);
			return html.html;
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

		const normalizedHost = this.normalizeString(systemEmailHost);
		const normalizedFromAddress = this.normalizeString(systemEmailAddress);
		const normalizedAuthUser = this.normalizeString(systemEmailUser) || normalizedFromAddress;
		const normalizedPassword = this.normalizeString(systemEmailPassword);
		const normalizedConnectionHost = this.normalizeString(systemEmailConnectionHost);
		const normalizedTlsServername = this.normalizeString(systemEmailTLSServername);

		const missingFields = [
			!normalizedHost ? "systemEmailHost" : null,
			typeof systemEmailPort !== "number" ? "systemEmailPort" : null,
			!normalizedFromAddress ? "systemEmailAddress" : null,
			!normalizedPassword ? "systemEmailPassword" : null,
		].filter((field): field is string => field !== null);

		if (missingFields.length > 0) {
			this.logger.warn({
				message: `Email transport is missing required settings: ${missingFields.join(", ")}. To configure, set SMTP settings in system settings.`,
				service: SERVICE_NAME,
				method: "sendEmail",
				details: {
					hasHost: Boolean(normalizedHost),
					hasPort: typeof systemEmailPort === "number",
					hasFromAddress: Boolean(normalizedFromAddress),
					hasAuthUser: Boolean(normalizedAuthUser),
					hasPassword: Boolean(normalizedPassword),
				},
			});
			return false;
		}

		const emailConfig = {
			host: normalizedHost,
			port: Number(systemEmailPort),
			secure: Boolean(systemEmailSecure),
			auth: {
				user: normalizedAuthUser,
				pass: normalizedPassword,
			},
			name: normalizedConnectionHost || "localhost",
			connectionTimeout: 5000,
			pool: Boolean(systemEmailPool),
			tls: {
				rejectUnauthorized: systemEmailRejectUnauthorized ?? true,
				ignoreTLS: Boolean(systemEmailIgnoreTLS),
				requireTLS: Boolean(systemEmailRequireTLS),
				servername: normalizedTlsServername || normalizedHost,
			},
		};
		this.transporter = this.nodemailer.createTransport(emailConfig);

		try {
			await this.transporter.verify();
		} catch (error: unknown) {
			this.logger.warn({
				message: `Email transporter verification failed: ${error instanceof Error ? error.message : "Unknown error"}`,
				service: SERVICE_NAME,
				method: "verifyTransporter",
				details: {
					host: normalizedHost,
					port: Number(systemEmailPort),
					secure: Boolean(systemEmailSecure),
					from: normalizedFromAddress,
					authUser: normalizedAuthUser,
					pool: Boolean(systemEmailPool),
					ignoreTLS: Boolean(systemEmailIgnoreTLS),
					requireTLS: Boolean(systemEmailRequireTLS),
					rejectUnauthorized: systemEmailRejectUnauthorized ?? true,
					tlsServername: normalizedTlsServername || normalizedHost,
				},
				stack: error instanceof Error ? error.stack : undefined,
			});
			return false;
		}

		try {
			const info = await this.transporter.sendMail({
				to: to,
				from: normalizedFromAddress,
				subject: subject,
				html: html,
			});
			return info?.messageId;
		} catch (error: unknown) {
			this.logger.error({
				message: `Failed to send email: ${error instanceof Error ? error.message : "Unknown error"}`,
				service: SERVICE_NAME,
				method: "sendEmail",
				details: {
					to,
					from: normalizedFromAddress,
					subject,
					host: normalizedHost,
					port: Number(systemEmailPort),
				},
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	};
}
