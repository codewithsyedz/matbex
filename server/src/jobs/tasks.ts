/**
 * Background tasks (the BullMQ "tasks" queue): work that should not run inside an API request,
 * such as building a business's full data export. A task names a server function and the body to
 * call it with; the worker calls it with the cron secret (see queues.ts, runTask).
 * Without Redis the task runs in this process, after the current request.
 */
import { Queue } from "bullmq";
import { config } from "../config.js";

export interface FunctionTask { fn: string; body: Record<string, unknown> }

let queue: Queue | null = null;
const PREFIX = `${config.REDIS_KEY_PREFIX.replace(/:+$/, "")}:bull`;

export async function enqueueTask(task: FunctionTask, opts: { jobId?: string } = {}) {
  if (config.REDIS_URL) {
    queue ??= new Queue("tasks", { connection: { url: config.REDIS_URL, maxRetriesPerRequest: null }, prefix: PREFIX });
    await queue.add("function", task, { jobId: opts.jobId, attempts: 1, removeOnComplete: 500, removeOnFail: 1000 });
    return;
  }
  setImmediate(() => {
    void runFunctionTask(task).catch((err) => console.error(`[tasks] ${task.fn} failed`, err));
  });
}

/** Runs a task's server function with the cron secret; throws on a non-2xx reply. */
export async function runFunctionTask(task: FunctionTask): Promise<string> {
  const { invokeFunction } = await import("../functions/host.js");
  const res = await invokeFunction(task.fn, {
    headers: { "content-type": "application/json", "x-cron-secret": process.env.CRON_SECRET ?? "" },
    body: JSON.stringify(task.body),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text.slice(0, 300);
}
