import { z } from "zod";
import { GeoContinents } from "@/Types/GeoCheck";

const urlSchema = z.url({ message: "Please enter a valid URL" });

const escalationSchema = z.object({
	delayMinutes: z
		.union([z.number(), z.string()])
		.transform((val) => (typeof val === "string" ? Number(val) : val))
		.pipe(z.number().min(0).max(1440))
		.default(0),
	notificationIds: z.array(z.string()).default([]),
});

const baseSchema = z.object({
	name: z
		.string()
		.min(1, "Monitor name is required")
		.max(50, "Monitor name must be at most 50 characters"),
	description: z.string().optional(),
	interval: z.number().min(15000, "Interval must be at least 15 seconds"),
	notifications: z.array(z.string()),
	escalation: escalationSchema.optional(),
	statusWindowSize: z
		.number({ message: "Status window size is required" })
		.min(1, "Status window size must be at least 1")
		.max(25, "Status window size must be at most 25"),
	statusWindowThreshold: z
		.number({ message: "Threshold percentage is required" })
		.min(1, "Incident percentage must be at least 1")
		.max(100, "Incident percentage must be at most 100"),
	geoCheckEnabled: z.boolean().optional(),
	geoCheckLocations: z.array(z.enum(GeoContinents)).optional(),
	geoCheckInterval: z
		.number()
		.min(300000, "Interval must be at least 5 minutes")
		.optional(),
});

const httpSchema = baseSchema.extend({
	type: z.literal("http"),
	url: urlSchema,
	ignoreTlsErrors: z.boolean(),
	useAdvancedMatching: z.boolean(),
	matchMethod: z.enum(["equal", "include", "regex", ""]).optional(),
	expectedValue: z.string().optional(),
	jsonPath: z.string().optional(),
});

const pingSchema = baseSchema.extend({
	type: z.literal("ping"),
	url: z.string().min(1, "Host is required"),
});

const portSchema = baseSchema.extend({
	type: z.literal("port"),
	url: z.string().min(1, "Host is required"),
	port: z
		.number()
		.min(1, "Port must be at least 1")
		.max(65535, "Port must be at most 65535"),
});

const dockerSchema = baseSchema.extend({
	type: z.literal("docker"),
	url: z.string().min(1, "Container ID is required"),
});

const gameSchema = baseSchema.extend({
	type: z.literal("game"),
	url: z.string().min(1, "Host is required"),
	port: z
		.number()
		.min(1, "Port must be at least 1")
		.max(65535, "Port must be at most 65535"),
	gameId: z.string().min(1, "Game type is required"),
});

const grpcSchema = baseSchema.extend({
	type: z.literal("grpc"),
	url: z.string().min(1, "Host is required"),
	port: z
		.number()
		.min(1, "Port must be at least 1")
		.max(65535, "Port must be at most 65535"),
	grpcServiceName: z.string().optional(),
	ignoreTlsErrors: z.boolean(),
});

const pagespeedSchema = baseSchema.extend({
	type: z.literal("pagespeed"),
	url: urlSchema,
});

const hardwareSchema = baseSchema.extend({
	type: z.literal("hardware"),
	url: urlSchema,
	secret: z.string({ message: "Secret is required" }).min(1, "Secret is required"),
	cpuAlertThreshold: z
		.number()
		.min(0, "CPU threshold must be at least 0")
		.max(100, "CPU threshold must be at most 100"),
	memoryAlertThreshold: z
		.number()
		.min(0, "Memory threshold must be at least 0")
		.max(100, "Memory threshold must be at most 100"),
	diskAlertThreshold: z
		.number()
		.min(0, "Disk threshold must be at least 0")
		.max(100, "Disk threshold must be at most 100"),
	tempAlertThreshold: z
		.number()
		.min(0, "Temperature threshold must be at least 0")
		.max(150, "Temperature threshold must be at most 150"),
	selectedDisks: z.array(z.string()),
});

const websocketSchema = baseSchema.extend({
	type: z.literal("websocket"),
	url: z.string().min(1, "WebSocket URL is required"),
	ignoreTlsErrors: z.boolean(),
});

export const monitorSchema = z.discriminatedUnion("type", [
	httpSchema,
	pingSchema,
	portSchema,
	dockerSchema,
	gameSchema,
	grpcSchema,
	pagespeedSchema,
	hardwareSchema,
	websocketSchema,
]);

export type MonitorFormData = z.infer<typeof monitorSchema>;

export {
	httpSchema,
	pingSchema,
	portSchema,
	dockerSchema,
	gameSchema,
	grpcSchema,
	pagespeedSchema,
	hardwareSchema,
	websocketSchema,
};