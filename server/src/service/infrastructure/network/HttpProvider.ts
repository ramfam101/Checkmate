import { type Got, HTTPError, RequestError } from "got";
import { IAdvancedMatcher } from "@/service/infrastructure/network/AdvancedMatcher.js";
import { IStatusProvider } from "@/service/infrastructure/network/IStatusProvider.js";
import { HttpStatusPayload } from "@/types/network.js";
import { MonitorStatusResponse } from "@/types/network.js";
import { Agent as HttpsAgent } from "https";
import { Monitor, MonitorType } from "@/types/monitor.js";
import { NETWORK_ERROR } from "@/service/infrastructure/network/utils.js";
import CacheableLookup from "cacheable-lookup";

export class HttpProvider implements IStatusProvider<HttpStatusPayload> {
	readonly type = "http";
	private fallbackGot: Got;
	private static readonly DEFAULT_HEADERS = {
		"user-agent": "Checkmate/1.0 (+https://github.com/bluewave-labs/checkmate)",
		accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
		"accept-language": "en-US,en;q=0.9",
	};

	constructor(
		private got: Got,
		private advancedMatcher: IAdvancedMatcher
	) {
		this.fallbackGot = got.extend({
			timeout: {
				request: 30000,
			},
			headers: HttpProvider.DEFAULT_HEADERS,
			retry: { limit: 1 },
		});

		const cacheable = new CacheableLookup({ maxTtl: 300, errorTtl: 30 });
		this.got = this.fallbackGot.extend({
			dnsCache: cacheable,
		});
	}

	supports(type: MonitorType) {
		return type === "http";
	}

	private handleHttpError<T>(error: unknown, monitor: Monitor): MonitorStatusResponse<T> {
		if (error instanceof HTTPError || error instanceof RequestError) {
			return {
				monitorId: monitor.id,
				teamId: monitor.teamId,
				type: monitor.type,
				status: false,
				code: error.response?.statusCode ?? NETWORK_ERROR,
				message: error.message,
				responseTime: error.timings?.phases?.total ?? 0,
				timings: error.timings,
				payload: null as T,
			};
		}

		return {
			monitorId: monitor.id,
			teamId: monitor.teamId,
			type: monitor.type,
			status: false,
			code: NETWORK_ERROR,
			message: error instanceof Error ? error.message : String(error),
			responseTime: 0,
			payload: null as T,
		};
	}

	private isDnsLookupFailure(error: unknown): error is RequestError {
		if (!(error instanceof RequestError)) {
			return false;
		}

		const code = error.code?.toLowerCase?.() ?? "";
		const message = error.message.toLowerCase();

		return (
			code === "edestruction" ||
			code === "enotfound" ||
			code === "eai_again" ||
			message.includes("edestruction") ||
			message.includes("enotfound") ||
			message.includes("eai_again") ||
			message.includes("getaddrinfo") ||
			message.includes("querya")
		);
	}

	private async executeRequest<T>(client: Got, monitor: Monitor, options: Record<string, unknown>): Promise<MonitorStatusResponse<T>> {
		const response = await client<string>(monitor.url, options);
		const contentType = response.headers["content-type"] || "";
		const isJson = contentType.includes("application/json");

		if (monitor.jsonPath && !isJson) {
			return {
				monitorId: monitor.id,
				teamId: monitor.teamId,
				type: monitor.type,
				status: false,
				code: response.statusCode,
				message: "Response is not JSON",
				responseTime: response.timings.phases.total ?? 0,
				timings: response.timings,
				payload: response.body as unknown as T,
			};
		}

		let payload: T;
		if (isJson) {
			try {
				payload = JSON.parse(response.body) as T;
			} catch {
				payload = response.body as unknown as T;
			}
		} else {
			payload = response.body as unknown as T;
		}

		const matchResult = this.advancedMatcher.validate<T>(payload, monitor);
		return {
			monitorId: monitor.id,
			teamId: monitor.teamId,
			type: monitor.type,
			status: response.ok && matchResult.ok,
			code: response.statusCode,
			message: matchResult.ok ? (response.statusMessage ?? "OK") : matchResult.message,
			responseTime: response.timings.phases.total ?? 0,
			timings: response.timings,
			payload,
			extracted: matchResult.extracted,
		};
	}

	async handle<T>(monitor: Monitor): Promise<MonitorStatusResponse<T>> {
		const { url, secret, jsonPath, ignoreTlsErrors } = monitor;

		if (!url) {
			throw new Error("URL is required for HTTP monitor");
		}

		const options: Record<string, unknown> = {
			headers: monitor.secret ? { Authorization: `Bearer ${secret}` } : undefined,
		};

		options.agent = {
			https: new HttpsAgent({ rejectUnauthorized: !ignoreTlsErrors }),
		};

		try {
			return await this.executeRequest<T>(this.got, monitor, options);
		} catch (error: unknown) {
			if (this.isDnsLookupFailure(error)) {
				try {
					return await this.executeRequest<T>(this.fallbackGot, monitor, options);
				} catch (fallbackError: unknown) {
					return this.handleHttpError(fallbackError, monitor);
				}
			}

			return this.handleHttpError(error, monitor);
		}
	}
}
