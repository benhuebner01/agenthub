import 'dotenv/config';
import { db } from '../db/index';
import { schedules, agents } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { executeAgent } from './executor';
import { checkBudget, recordSpend } from './budget';

const useBullMQ = !!process.env.REDIS_URL;

// ─── Shared helpers ──────────────────────────────────────────────────────────

interface ScheduleInput {
  id: string;
  agentId: string;
  cronExpression: string;
  enabled: boolean;
}

async function runScheduledJob(scheduleId: string, agentId: string): Promise<void> {
  try {
    console.log(`[Scheduler] Running scheduled agent for schedule ${scheduleId}`);

    const budgetCheck = await checkBudget(agentId);
    if (!budgetCheck.allowed) {
      console.warn(`[Scheduler] Budget exceeded for agent ${agentId}. Skipping run.`);
      return;
    }

    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    if (!agent || agent.status === 'paused') {
      console.log(`[Scheduler] Agent ${agentId} is paused or not found. Skipping.`);
      return;
    }

    await db
      .update(schedules)
      .set({ lastRunAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
      .where(eq(schedules.id, scheduleId));

    const result = await executeAgent(agentId, {}, 'schedule');

    if (result.costUsd > 0) {
      await recordSpend(agentId, result.costUsd);
    }
  } catch (err) {
    console.error(`[Scheduler] Error for schedule ${scheduleId}:`, err);
  }
}

// ─── Cron implementation ─────────────────────────────────────────────────────

let cronTasks: Map<string, import('node-cron').ScheduledTask> | null = null;

async function startCronScheduler(): Promise<void> {
  const cron = await import('node-cron');
  cronTasks = new Map();
  console.log('[Scheduler] Starting in cron mode...');
  await refreshCronSchedules();
  console.log(`[Scheduler] Started with ${cronTasks.size} active schedules`);
}

async function refreshCronSchedules(): Promise<void> {
  const cron = await import('node-cron');
  if (!cronTasks) cronTasks = new Map();

  for (const [id, task] of cronTasks) {
    task.stop();
    cronTasks.delete(id);
  }

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
    await registerCronSchedule({
      id: schedule.id,
      agentId: schedule.agentId,
      cronExpression: schedule.cronExpression,
      enabled: schedule.enabled,
    });
  }

  console.log('[Scheduler] Schedules refreshed');
}

async function registerCronSchedule(schedule: ScheduleInput): Promise<void> {
  const cron = await import('node-cron');
  if (!cronTasks) cronTasks = new Map();

  if (!cron.validate(schedule.cronExpression)) {
    console.warn(
      `[Scheduler] Invalid cron expression for schedule ${schedule.id}: ${schedule.cronExpression}`
    );
    return;
  }

  const existing = cronTasks.get(schedule.id);
  if (existing) {
    existing.stop();
    cronTasks.delete(schedule.id);
  }

  if (!schedule.enabled) return;

  const task = cron.schedule(schedule.cronExpression, () => {
    runScheduledJob(schedule.id, schedule.agentId);
  });

  cronTasks.set(schedule.id, task);
  console.log(`[Scheduler] Registered schedule ${schedule.id} (${schedule.cronExpression})`);
}

async function removeCronSchedule(scheduleId: string): Promise<void> {
  if (!cronTasks) return;
  const task = cronTasks.get(scheduleId);
  if (task) {
    task.stop();
    cronTasks.delete(scheduleId);
    console.log(`[Scheduler] Removed cron schedule ${scheduleId}`);
  }
}

async function stopCronScheduler(): Promise<void> {
  if (!cronTasks) return;
  for (const [id, task] of cronTasks) {
    task.stop();
    cronTasks.delete(id);
  }
  console.log('[Scheduler] Cron scheduler stopped');
}

function getCronActiveCount(): number {
  return cronTasks ? cronTasks.size : 0;
}

// ─── BullMQ implementation ───────────────────────────────────────────────────

let bullQueue: import('bullmq').Queue | null = null;
let bullWorker: import('bullmq').Worker | null = null;
let bullSchedulerMap: Map<string, string> = new Map(); // scheduleId -> repeatJobKey

async function startBullMQScheduler(): Promise<void> {
  const { Queue, Worker } = await import('bullmq');
  const { default: IORedis } = await import('ioredis');

  const redisUrl = process.env.REDIS_URL!;
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

  bullQueue = new Queue('agenthub-schedules', { connection });
  bullSchedulerMap = new Map();

  bullWorker = new Worker(
    'agenthub-schedules',
    async (job) => {
      const { scheduleId, agentId } = job.data as { scheduleId: string; agentId: string };
      await runScheduledJob(scheduleId, agentId);
    },
    { connection }
  );

  bullWorker.on('failed', (job: any, err: Error) => {
    console.error(`[Scheduler][BullMQ] Job ${job?.id} failed:`, err);
  });

  console.log('[Scheduler] Starting in BullMQ mode...');
  await refreshBullMQSchedules();
  console.log('[Scheduler] BullMQ scheduler started');
}

async function refreshBullMQSchedules(): Promise<void> {
  if (!bullQueue) return;

  // Remove all existing repeatable jobs
  const repeatableJobs = await bullQueue.getRepeatableJobs();
  for (const job of repeatableJobs) {
    await bullQueue.removeRepeatableByKey(job.key);
  }
  bullSchedulerMap.clear();

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

  console.log(`[Scheduler][BullMQ] Loading ${enabledSchedules.length} active schedules`);

  for (const schedule of enabledSchedules) {
    await registerBullMQSchedule({
      id: schedule.id,
      agentId: schedule.agentId,
      cronExpression: schedule.cronExpression,
      enabled: schedule.enabled,
    });
  }

  console.log('[Scheduler][BullMQ] Schedules refreshed');
}

async function registerBullMQSchedule(schedule: ScheduleInput): Promise<void> {
  if (!bullQueue) return;
  if (!schedule.enabled) return;

  // Remove existing job for this schedule if any
  const existingKey = bullSchedulerMap.get(schedule.id);
  if (existingKey) {
    await bullQueue.removeRepeatableByKey(existingKey);
    bullSchedulerMap.delete(schedule.id);
  }

  const jobName = `schedule-${schedule.id}`;
  const job = await bullQueue.add(
    jobName,
    { scheduleId: schedule.id, agentId: schedule.agentId },
    {
      repeat: { pattern: schedule.cronExpression },
      jobId: `repeatable-${schedule.id}`,
    }
  );

  // Store the repeat key for later removal
  if (job.repeatJobKey) {
    bullSchedulerMap.set(schedule.id, job.repeatJobKey);
  }

  console.log(`[Scheduler][BullMQ] Registered schedule ${schedule.id} (${schedule.cronExpression})`);
}

async function removeBullMQSchedule(scheduleId: string): Promise<void> {
  if (!bullQueue) return;
  const key = bullSchedulerMap.get(scheduleId);
  if (key) {
    await bullQueue.removeRepeatableByKey(key);
    bullSchedulerMap.delete(scheduleId);
    console.log(`[Scheduler][BullMQ] Removed schedule ${scheduleId}`);
  }
}

async function stopBullMQScheduler(): Promise<void> {
  if (bullWorker) {
    await bullWorker.close();
    bullWorker = null;
  }
  if (bullQueue) {
    await bullQueue.close();
    bullQueue = null;
  }
  bullSchedulerMap.clear();
  console.log('[Scheduler][BullMQ] Scheduler stopped');
}

function getBullMQActiveCount(): number {
  return bullSchedulerMap.size;
}

// ─── Unified public API ───────────────────────────────────────────────────────

export async function startScheduler(): Promise<void> {
  if (useBullMQ) {
    await startBullMQScheduler();
  } else {
    await startCronScheduler();
  }
}

export async function refreshSchedules(): Promise<void> {
  if (useBullMQ) {
    await refreshBullMQSchedules();
  } else {
    await refreshCronSchedules();
  }
}

export async function registerSchedule(schedule: ScheduleInput): Promise<void> {
  if (useBullMQ) {
    await registerBullMQSchedule(schedule);
  } else {
    await registerCronSchedule(schedule);
  }
}

// Alias for backward compatibility
export async function scheduleAgent(schedule: ScheduleInput): Promise<void> {
  return registerSchedule(schedule);
}

export async function removeSchedule(scheduleId: string): Promise<void> {
  if (useBullMQ) {
    await removeBullMQSchedule(scheduleId);
  } else {
    await removeCronSchedule(scheduleId);
  }
}

// Alias for backward compatibility
export async function removeScheduleTask(scheduleId: string): Promise<void> {
  return removeSchedule(scheduleId);
}

export async function stopScheduler(): Promise<void> {
  if (useBullMQ) {
    await stopBullMQScheduler();
  } else {
    await stopCronScheduler();
  }
}

export function getActiveScheduleCount(): number {
  if (useBullMQ) {
    return getBullMQActiveCount();
  }
  return getCronActiveCount();
}

export function getSchedulerMode(): 'cron' | 'bullmq' {
  return useBullMQ ? 'bullmq' : 'cron';
}
