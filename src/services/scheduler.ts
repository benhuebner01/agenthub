import { Queue, Worker, Job } from 'bullmq';
import { db } from '../db';
import { schedules, agents, runs } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { executeAgent } from './executor';
import { checkBudget, recordSpend } from './budget';
import { v4 as uuidv4 } from 'uuid';

const QUEUE_NAME = 'agent-scheduler';

let agentQueue: Queue | null = null;
let agentWorker: Worker | null = null;

function getRedisConnection() {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
    password: url.password || undefined,
    db: parseInt(url.pathname?.slice(1) || '0', 10) || 0,
  };
}

export async function startScheduler(): Promise<void> {
  const connection = getRedisConnection();

  agentQueue = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      removeOnComplete: 100,
      removeOnFail: 200,
    },
  });

  agentWorker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      const { agentId, scheduleId } = job.data;

      console.log(`[Scheduler] Processing job for agent ${agentId}, schedule ${scheduleId}`);

      // Check budget before running
      const budgetCheck = await checkBudget(agentId);
      if (!budgetCheck.allowed) {
        console.warn(`[Scheduler] Budget exceeded for agent ${agentId}. Skipping run.`);
        return { skipped: true, reason: 'budget_exceeded' };
      }

      // Check agent is still active
      const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
      if (!agent || agent.status === 'paused') {
        console.log(`[Scheduler] Agent ${agentId} is paused or not found. Skipping.`);
        return { skipped: true, reason: 'agent_paused' };
      }

      // Execute the agent
      const result = await executeAgent(agentId, {}, 'schedule');

      // Record spend
      if (result.costUsd > 0) {
        await recordSpend(agentId, result.costUsd);
      }

      // Update schedule last_run_at
      await db
        .update(schedules)
        .set({ lastRunAt: new Date(), updatedAt: new Date() })
        .where(eq(schedules.id, scheduleId));

      return result;
    },
    {
      connection,
      concurrency: 5,
    }
  );

  agentWorker.on('completed', (job: Job, result: unknown) => {
    console.log(`[Scheduler] Job ${job.id} completed for agent ${job.data.agentId}`);
  });

  agentWorker.on('failed', (job: Job | undefined, err: Error) => {
    if (job) {
      console.error(`[Scheduler] Job ${job.id} failed for agent ${job.data.agentId}:`, err.message);
    }
  });

  agentWorker.on('error', (err: Error) => {
    console.error('[Scheduler] Worker error:', err);
  });

  // Load all active schedules
  await refreshSchedules();

  console.log('[Scheduler] Started successfully');
}

export async function scheduleAgent(schedule: {
  id: string;
  agentId: string;
  cronExpression: string;
  enabled: boolean;
}): Promise<void> {
  if (!agentQueue) {
    console.warn('[Scheduler] Queue not initialized');
    return;
  }

  const jobId = `schedule-${schedule.id}`;

  // Remove existing job if present
  const existingJob = await agentQueue.getJob(jobId);
  if (existingJob) {
    await existingJob.remove();
  }

  if (!schedule.enabled) {
    return;
  }

  // Add repeatable job with cron pattern
  await agentQueue.add(
    'run-agent',
    {
      agentId: schedule.agentId,
      scheduleId: schedule.id,
    },
    {
      jobId,
      repeat: {
        pattern: schedule.cronExpression,
      },
      removeOnComplete: 50,
      removeOnFail: 100,
    }
  );

  console.log(`[Scheduler] Scheduled agent ${schedule.agentId} with cron: ${schedule.cronExpression}`);
}

export async function removeSchedule(scheduleId: string): Promise<void> {
  if (!agentQueue) return;

  const jobId = `schedule-${scheduleId}`;
  const job = await agentQueue.getJob(jobId);
  if (job) {
    await job.remove();
  }

  // Also remove repeatable job
  const repeatableJobs = await agentQueue.getRepeatableJobs();
  for (const repeatJob of repeatableJobs) {
    if (repeatJob.key.includes(scheduleId)) {
      await agentQueue.removeRepeatableByKey(repeatJob.key);
    }
  }

  console.log(`[Scheduler] Removed schedule ${scheduleId}`);
}

export async function refreshSchedules(): Promise<void> {
  if (!agentQueue) return;

  console.log('[Scheduler] Refreshing schedules from database...');

  // Clear all existing repeatable jobs
  const existingRepeatableJobs = await agentQueue.getRepeatableJobs();
  for (const job of existingRepeatableJobs) {
    await agentQueue.removeRepeatableByKey(job.key);
  }

  // Load all enabled schedules with active agents
  const enabledSchedules = await db
    .select({
      id: schedules.id,
      agentId: schedules.agentId,
      cronExpression: schedules.cronExpression,
      enabled: schedules.enabled,
      agentStatus: agents.status,
    })
    .from(schedules)
    .innerJoin(agents, eq(schedules.agentId, agents.id))
    .where(and(eq(schedules.enabled, true), eq(agents.status, 'active')));

  console.log(`[Scheduler] Loading ${enabledSchedules.length} active schedules`);

  for (const schedule of enabledSchedules) {
    await scheduleAgent({
      id: schedule.id,
      agentId: schedule.agentId,
      cronExpression: schedule.cronExpression,
      enabled: schedule.enabled,
    });
  }

  console.log('[Scheduler] Schedules refreshed');
}

export async function stopScheduler(): Promise<void> {
  if (agentWorker) {
    await agentWorker.close();
    agentWorker = null;
  }
  if (agentQueue) {
    await agentQueue.close();
    agentQueue = null;
  }
  console.log('[Scheduler] Stopped');
}

export function getQueue(): Queue | null {
  return agentQueue;
}
