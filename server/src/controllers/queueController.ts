import { ISuperSimpleQueue } from "@/service/index.js";
import { Request, Response, NextFunction } from "express";

const SERVICE_NAME = "JobQueueController";

export interface IJobQueueController {
	getMetrics(req: Request, res: Response, next: NextFunction): Promise<void>;
	getJobs(req: Request, res: Response, next: NextFunction): Promise<Response | void>;
	getAllMetrics(req: Request, res: Response, next: NextFunction): Promise<Response | void>;
	flushQueue(req: Request, res: Response, next: NextFunction): Promise<Response | void>;
	testEscalationNotifications(req: Request, res: Response, next: NextFunction): Promise<Response | void>;
}

class JobQueueController implements IJobQueueController {
	static SERVICE_NAME = SERVICE_NAME;
	private jobQueue: ISuperSimpleQueue;
	constructor(jobQueue: ISuperSimpleQueue) {
		this.jobQueue = jobQueue;
	}

	get serviceName() {
		return JobQueueController.SERVICE_NAME;
	}

	getMetrics = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const metrics = await this.jobQueue.getMetrics();
			res.status(200).json({
				success: true,
				msg: "Queue metrics fetched successfully",
				data: metrics,
			});
		} catch (error) {
			next(error);
		}
	};

	getJobs = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const jobs = await this.jobQueue.getJobs();
			return res.status(200).json({
				success: true,
				msg: "Queue jobs fetched successfully",
				data: jobs,
			});
		} catch (error) {
			next(error);
		}
	};

	getAllMetrics = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const jobs = await this.jobQueue.getJobs();
			const metrics = await this.jobQueue.getMetrics();
			return res.status(200).json({
				success: true,
				msg: "Queue metrics fetched successfully",
				data: { jobs, metrics },
			});
		} catch (error) {
			next(error);
		}
	};

	flushQueue = async (req: Request, res: Response, next: NextFunction) => {
		try {
			const result = await this.jobQueue.flushQueues();
			return res.status(200).json({
				success: true,
				msg: "Queue flushed successfully",
				data: result,
			});
		} catch (error) {
			next(error);
		}
	};

	testEscalationNotifications = async (req: Request, res: Response, next: NextFunction) => {
		try {
			// Create a mock monitor with escalation notifications for testing
			const mockMonitor = {
				id: "test-monitor-escalation",
				name: "Test Escalation Monitor",
				url: "http://nonexistent-domain-12345.com",
				status: "down",
				type: "http",
				teamId: "test-team",
				escalationNotifications: [
					{
						delay: 1, // 1 minute for quick testing
						contacts: [
							{
								type: "email",
								address: "test@example.com"
							}
						],
						enabled: true
					}
				]
			};

			// Create mock status response
			const mockStatus = {
				status: "down",
				code: 500,
				responseTime: 1000,
				timestamp: new Date()
			};

			// Get the SuperSimpleQueueHelper and call scheduleEscalationNotifications
			const queueHelper = (this.jobQueue as any).helper;
			if (queueHelper && typeof queueHelper.scheduleEscalationNotifications === 'function') {
				queueHelper.scheduleEscalationNotifications(mockMonitor, mockStatus);
				return res.status(200).json({
					success: true,
					msg: "Test escalation notifications scheduled. Check server logs for debug output.",
					data: { monitorId: mockMonitor.id, escalations: mockMonitor.escalationNotifications }
				});
			} else {
				return res.status(500).json({
					success: false,
					msg: "Could not access queue helper for testing"
				});
			}
		} catch (error) {
			next(error);
		}
	};
}
export default JobQueueController;
