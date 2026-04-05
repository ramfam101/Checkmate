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
	private transporter: any = null;
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

		const emailConfig = {
			host: systemEmailHost,
			port: Number(systemEmailPort),
			secure: systemEmailSecure,
			auth: {
				user: systemEmailUser || systemEmailAddress,
				pass: systemEmailPassword,
			},
			name: systemEmailConnectionHost || "localhost",
			connectionTimeout: 5000,
			pool: systemEmailPool,
			tls: {
				rejectUnauthorized: systemEmailRejectUnauthorized,
				ignoreTLS: systemEmailIgnoreTLS,
				requireTLS: systemEmailRequireTLS,
				servername: systemEmailTLSServername,
			},
		};
		this.transporter = this.nodemailer.createTransport(emailConfig) as any;

		try {
			if (this.transporter && typeof this.transporter.verify === "function") {
				await this.transporter.verify();
			}
		} catch (error: unknown) {
			this.logger.warn({
				message: "Email transporter verification failed using DB settings, will attempt environment fallback",
				service: SERVICE_NAME,
				method: "verifyTransporter",
				stack: error instanceof Error ? error.stack : undefined,
			});

			// Try an environment-based fallback (useful for local dev with MailHog or explicit SMTP env vars)
			const envHost = process.env.SMTP_HOST || "localhost";
			const envPort = Number(process.env.SMTP_PORT || 1025);
			const envSecure = (process.env.SMTP_SECURE || "false").toLowerCase() === "true";
			const envUser = process.env.SMTP_USER;
			const envPass = process.env.SMTP_PASS;
			const envFrom = process.env.SMTP_FROM || systemEmailAddress || envUser;

			const envConfig = {
				host: envHost,
				port: envPort,
				secure: envSecure,
				auth: envUser ? { user: envUser, pass: envPass } : undefined,
				name: process.env.SMTP_NAME || emailConfig.name || "localhost",
				connectionTimeout: 5000,
				pool: false,
				tls: {
					rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED
						? process.env.SMTP_REJECT_UNAUTHORIZED === "true"
						: Boolean(emailConfig.tls?.rejectUnauthorized),
					ignoreTLS: process.env.SMTP_IGNORE_TLS === "true",
					requireTLS: process.env.SMTP_REQUIRE_TLS === "true",
					servername: process.env.SMTP_TLS_SERVERNAME || undefined,
				},
			};

			this.transporter = this.nodemailer.createTransport(envConfig as any) as any;
			try {
				if (this.transporter && typeof this.transporter.verify === "function") {
					await this.transporter.verify();
				}
				this.logger.info({
					message: "Email transporter verified using environment SMTP settings",
					service: SERVICE_NAME,
					method: "verifyTransporter",
				});
				// ensure from address is set if missing
				let fromAddress = systemEmailAddress;
				if (!fromAddress && envFrom) {
					fromAddress = envFrom;
				}
				// overwrite local variable for send below
				// @ts-ignore assign to a local alias later when sending
				config = { ...config, systemEmailAddress: fromAddress } as EmailTransportConfig;
			} catch (envError: unknown) {
				this.logger.warn({
					message: "Environment SMTP transporter verification also failed; will attempt send but it may error",
					service: SERVICE_NAME,
					method: "verifyTransporterEnv",
					stack: envError instanceof Error ? envError.stack : undefined,
				});
			}
		}

		try {
			if (!this.transporter) {
				this.logger.warn({
					message: "No transporter available when attempting to send email",
					service: SERVICE_NAME,
					method: "sendEmail",
				});
				return false;
			}
			const fromAddressToUse = config.systemEmailAddress || systemEmailAddress || process.env.SMTP_FROM || process.env.SMTP_USER;
			const info = await this.transporter.sendMail({
				to: to,
				from: fromAddressToUse,
				subject: subject,
				html: html,
			});
			return info?.messageId;
		} catch (error: unknown) {
			this.logger.error({
				message: error instanceof Error ? error.message : "Unknown error",
				service: SERVICE_NAME,
				method: "sendEmail",
				stack: error instanceof Error ? error.stack : undefined,
			});
		}
	};
}
