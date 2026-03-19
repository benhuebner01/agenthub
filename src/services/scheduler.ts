import cron from 'node-cron';
import { db } from '../db/index';
import { schedules, agents } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { executeAgent } from './executor';
import { checkBudget, recordSpend } from './budget';

// Map of scheduleId -> cron task
const tasks = new Map<string, cron.ScheduledTask>();

export async function startScheduler(): Promise<void> {
  console.log('[Scheduler] Starting...');
  await refreshSchedules();
  console.log(`[Scheduler] Started with ${tasks.size} active schedules`);
}

export async function refreshSchedules(): Promise<void> {
  // Stop all existing tasks
  for (const [id, task] of tasks) {
    task.stop();
    tasks.delete(id);
  }

  // Load all enabled schedules with active agents from DB
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
    await registerSchedule({
      id: schedule.id,
      agentId: schedule.agentId,
      cronExpression: schedule.cronExpression,
      enabled: schedule.enabled,
    });
  }

  console.log('[Scheduler] Schedules refreshed');
}

export async function registerSchedule(schedule: {
  id: string;
  agentId: string;
  cronExpression: string;
  enabled: boolean;
}): Promise<void> {
  // Validate cron expression
  if (!cron.validate(schedule.cronExpression)) {
    console.warn(`[Scheduler] Invalid cron expression for schedule ${schedule.id}: ${schedule.cronExpression}`);
    return;
  }

  // Stop existing task if any
  const existing = tasks.get(schedule.id);
  if (existing) {
    existing.stop();
    tasks.delete(schedule.id);
  }

  if (!schedule.enabled) return;

  const task = cron.schedule(schedule.cronExpression, async () => {
    try {
      console.log(`[Scheduler] Running scheduled agent for schedule ${schedule.id}`);

      // Check budget before running
      const budgetCheck = await checkBudget(schedule.agentId);
      if (!budgetCheck.allowed) {
        console.warn(`[Scheduler] Budget exceeded for agent ${schedule.agentId}. Skipping run.`);
        return;
      }

      // Check agent is still active
      const [agent] = await db.select().from(agents).where(eq(agents.id, schedule.agentId));
      if (!agent || agent.status === 'paused') {
        console.log(`[Scheduler] Agent ${schedule.agentId} is paused or not found. Skipping.`);
        return;
      }

      // Update last_run_at
      await db
        .update(schedules)
        .set({ lastRunAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
        .where(eq(schedules.id, schedule.id));

      const result = await executeAgent(schedule.agentId, {}, 'schedule');

      // Record spend
      if (result.costUsd > 0) {
        await recordSpend(schedule.agentId, result.costUsd);
      }
    } catch (err) {
      console.error(`[Scheduler] Error for schedule ${schedule.id}:`, err);
    }
  });

  tasks.set(schedule.id, task);
  console.log(`[Scheduler] Registered schedule ${schedule.id} (${schedule.cronExpression})`);
}

// Alias kept for backward compatibility with routes that call scheduleAgent()
export async function scheduleAgent(schedule: {
  id: string;
  agentId: string;
  cronExpression: string;
  enabled: boolean;
}): Promise<void> {
  return registerSchedule(schedule);
}

export async function removeSchedule(scheduleId: string): Promise<void> {
  const task = tasks.get(scheduleId);
  if (task) {
    task.stop();
    tasks.delete(scheduleId);
    console.log(`[Scheduler] Removed schedule ${scheduleId}`);
  }
}

// Alias kept for backward compat
export async function removeScheduleTask(scheduleId: string): Promise<void> {
  return removeSchedule(scheduleId);
}

export function getActiveScheduleCount(): number {
  return tasks.size;
}

export async function stopScheduler(): Promise<void> {
  for (const [id, task] of tasks) {
    task.stop();
    tasks.delete(id);
  }
  console.log('[Scheduler] Stopped');
}
