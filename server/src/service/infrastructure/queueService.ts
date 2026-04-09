import { Queue, Worker, JobsOptions, Job } from "bullmq";
import IORedis from "ioredis";

const connection = new (IORedis as any)(process.env.REDIS_URL || "redis://127.0.0.1:6379");

const queues = new Map<string, Queue>();
const workers = new Map<string, Worker>();

function getQueue(name: string) {
	if (!queues.has(name)) queues.set(name, new Queue(name, { connection }));
	return queues.get(name)!;
}

export default {
	async enqueueDelayed(name: string, data: any, delayMs = 0, opts: JobsOptions = {}) {
		const queue = getQueue(name);
		await queue.add(name, data, { delay: delayMs, ...opts });
	},

	process(name: string, processor: (job: Job) => Promise<void>) {
		if (workers.has(name)) return;
		const worker = new Worker(
			name,
			async (job) => {
				await processor(job);
			},
			{ connection }
		);
		workers.set(name, worker);
	},
};
