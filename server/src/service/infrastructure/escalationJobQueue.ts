import Redis from 'ioredis';
import { Queue, Worker, type Job } from 'bullmq';
import { ILogger } from '@/utils/logger.js';
import type { INotificationsService } from './notificationsService.js';
import type { IMonitorsRepository } from '@/repositories/index.js';

const SERVICE_NAME = 'EscalationJobQueue';

export interface IEscalationJobQueue {
	readonly serviceName: string;
	scheduleEscalation(monitorId: string, teamId: string, delayMinutes: number, notificationIds: string[]): Promise<void>;
	shutdown(): Promise<void>;
}

export interface EscalationJobData {
	monitorId: string;
	teamId: string;
	notificationIds: string[];
}

export class EscalationJobQueue implements IEscalationJobQueue {
	static SERVICE_NAME = SERVICE_NAME;
	readonly serviceName = SERVICE_NAME;

	private queue: Queue<EscalationJobData> | null = null;
	private worker: Worker<EscalationJobData> | null = null;
	private logger: ILogger;
	private notificationsService: INotificationsService;
	private monitorsRepository: IMonitorsRepository;
	private redisAvailable: boolean = false;
	private isInitializing: boolean = false;

	constructor(
		logger: ILogger,
		notificationsService: INotificationsService,
		monitorsRepository: IMonitorsRepository,
		redisUrl?: string
	) {
		this.logger = logger;
		this.notificationsService = notificationsService;
		this.monitorsRepository = monitorsRepository;

		void this.initialize(redisUrl);
	}

	private async initialize(redisUrl?: string): Promise<void> {
		if (this.isInitializing) {
			return;
		}

		this.isInitializing = true;
		const connectionOptions = redisUrl
			? { url: redisUrl }
			: { host: 'localhost', port: 6379 };

		try {
			await this.verifyRedisConnection(redisUrl);

			this.queue = new Queue<EscalationJobData>('escalation-notifications', {
				connection: connectionOptions,
				defaultJobOptions: {
					removeOnComplete: 50,
					removeOnFail: 50,
				},
			});

			this.worker = new Worker<EscalationJobData>(
				'escalation-notifications',
				this.processEscalationJob.bind(this),
				{
					connection: connectionOptions,
					concurrency: 5,
				}
			);

			this.queue.on('error', (error) => {
				this.logger.warn({
					message: 'Escalation queue error',
					service: SERVICE_NAME,
					method: 'queue.error',
					details: {
						error: error instanceof Error ? error.message : String(error),
					},
				});
				this.redisAvailable = false;
			});

			this.worker.on('error', (error) => {
				this.logger.warn({
					message: 'Escalation worker error',
					service: SERVICE_NAME,
					method: 'worker.error',
					details: {
						error: error instanceof Error ? error.message : String(error),
					},
				});
				this.redisAvailable = false;
			});

			this.worker.on('completed', (job) => {
				this.logger.info({
					message: `Escalation: Monitor ${job.data.monitorId} still down`,
					service: SERVICE_NAME,
					method: 'worker.completed',
					details: {
						jobId: job.id,
					},
				});
			});

			this.worker.on('failed', (job, err) => {
				this.logger.error({
					message: `Escalation: Monitor ${job?.data.monitorId} still down`,
					service: SERVICE_NAME,
					method: 'worker.failed',
					details: {
						jobId: job?.id,
						error: err.message,
					},
				});
			});

			this.redisAvailable = true;
			this.logger.info({
				message: 'Escalation job queue initialized successfully',
				service: SERVICE_NAME,
				method: 'initialize',
			});
		} catch (error) {
			this.redisAvailable = false;
			this.logger.warn({
				message: 'Redis not available - escalation notifications will be disabled',
				service: SERVICE_NAME,
				method: 'initialize',
				details: {
					error: error instanceof Error ? error.message : String(error),
				},
			});
		} finally {
			this.isInitializing = false;
		}
	}

	private async verifyRedisConnection(redisUrl?: string): Promise<void> {
		const redisOptions = redisUrl
			? { url: redisUrl, maxRetriesPerRequest: 0, retryStrategy: null, connectTimeout: 2000 }
			: { host: 'localhost', port: 6379, maxRetriesPerRequest: 0, retryStrategy: null, connectTimeout: 2000 };

		const client = new (Redis as any)(redisOptions as any);
		try {
			await client.connect();
			await client.ping();
		} finally {
			await client.quit().catch(() => undefined);
		}
	}

	/**
	 * Schedules an escalation notification job to run after the specified delay
	 */
	async scheduleEscalation(monitorId: string, teamId: string, delayMinutes: number, notificationIds: string[]): Promise<void> {
		if (notificationIds.length === 0) {
			this.logger.warn({
				message: `No notification IDs provided for escalation of monitor ${monitorId}`,
				service: SERVICE_NAME,
				method: 'scheduleEscalation',
			});
			return;
		}

		if (!this.redisAvailable || !this.queue) {
			// Fallback to setTimeout if Redis is not available
			this.logger.warn({
				message: `Redis not available - using setTimeout for escalation scheduling for monitor ${monitorId}`,
				service: SERVICE_NAME,
				method: 'scheduleEscalation',
				details: {
					monitorId,
					teamId,
					delayMinutes,
					notificationCount: notificationIds.length,
				},
			});
			const delayMs = delayMinutes * 60 * 1000;
			setTimeout(async () => {
				try {
					await this.processEscalationJob({
						data: {
							monitorId,
							teamId,
							notificationIds,
						},
					} as Job<EscalationJobData>);
				} catch (error) {
					this.logger.error({
						message: `Error processing escalation job for monitor ${monitorId}`,
						service: SERVICE_NAME,
						method: 'scheduleEscalation',
						details: {
							error: error instanceof Error ? error.message : String(error),
						},
					});
				}
			}, delayMs);
			return;
		}

		const delayMs = delayMinutes * 60 * 1000; // Convert minutes to milliseconds

		try {
			await this.queue.add(
				'send-escalation',
				{
					monitorId,
					teamId,
					notificationIds,
				},
				{
					delay: delayMs,
					jobId: `escalation-${monitorId}-${Date.now()}`, // Unique job ID
				}
			);

			this.logger.info({
				message: `Scheduled escalation notification for monitor ${monitorId} in ${delayMinutes} minutes`,
				service: SERVICE_NAME,
				method: 'scheduleEscalation',
				details: {
					monitorId,
					teamId,
					delayMinutes,
					notificationCount: notificationIds.length,
				},
			});
		} catch (error) {
			this.logger.error({
				message: `Failed to schedule escalation for monitor ${monitorId}`,
				service: SERVICE_NAME,
				method: 'scheduleEscalation',
				details: {
					error: error instanceof Error ? error.message : String(error),
				},
			});
			throw error;
		}
	}

	/**
	 * Processes escalation jobs by sending notifications to the specified channels
	 */
	private async processEscalationJob(job: Job<EscalationJobData>): Promise<void> {
		const { monitorId, teamId, notificationIds } = job.data;

		try {
			this.logger.info({
				message: `Processing escalation notification for monitor ${monitorId}`,
				service: SERVICE_NAME,
				method: 'processEscalationJob',
				details: {
					monitorId,
					teamId,
					notificationCount: notificationIds.length,
				},
			});

			// Get monitor details
			const monitor = await this.monitorsRepository.findById(monitorId, teamId);
			if (!monitor) {
				this.logger.warn({
					message: `Monitor ${monitorId} not found during escalation processing`,
					service: SERVICE_NAME,
					method: 'processEscalationJob',
				});
				return;
			}

			// Skip escalation if the monitor has recovered before the escalation fired
			if (monitor.status !== 'down') {
				this.logger.info({
					message: `Skipping escalation for monitor ${monitorId} because monitor status is no longer down`,
					service: SERVICE_NAME,
					method: 'processEscalationJob',
					details: { monitorStatus: monitor.status },
				});
				return;
			}

			// Send notifications to all configured escalation channels
			const sendPromises = notificationIds.map(async (notificationId) => {
				try {
					await this.notificationsService.sendNotification(
						teamId,
						notificationId,
						'monitor_escalation',
						{
							monitorId,
							monitorName: monitor.name,
							monitorUrl: monitor.url,
							escalationDelay: 'delayed notification',
						}
					);
					return true;
				} catch (error) {
					this.logger.error({
						message: `Failed to send escalation notification for monitor ${monitorId}`,
						service: SERVICE_NAME,
						method: 'processEscalationJob',
						details: {
							monitorId,
							teamId,
							notificationId: notificationId,
							error: error instanceof Error ? error.message : String(error),
						},
					});
					return false;
				}
			});

			const results = await Promise.all(sendPromises);
			const successCount = results.filter(Boolean).length;
			const failCount = results.length - successCount;

			if (failCount > 0) {
				this.logger.warn({
					message: `Escalation completed with ${successCount} successes and ${failCount} failures for monitor ${monitorId}`,
					service: SERVICE_NAME,
					method: 'processEscalationJob',
				});
			} else {
				this.logger.info({
					message: `Escalation notifications sent successfully for monitor ${monitorId}`,
					service: SERVICE_NAME,
					method: 'processEscalationJob',
				});
			}
		} catch (error) {
			this.logger.error({
				message: `Failed to process escalation job for monitor ${monitorId}`,
				service: SERVICE_NAME,
				method: 'processEscalationJob',
				details: {
					error: error instanceof Error ? error.message : String(error),
				},
			});
			throw error;
		}
	}

	/**
	 * Shuts down the queue and worker gracefully
	 */
	async shutdown(): Promise<void> {
		this.logger.info({
			message: 'Shutting down escalation job queue',
			service: SERVICE_NAME,
			method: 'shutdown',
		});

		if (this.worker) {
			await this.worker.close();
		}
		if (this.queue) {
			await this.queue.close();
		}
	}
}