import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { schedules, agents } from '../db/schema';
import { eq } from 'drizzle-orm';
import { scheduleAgent, removeSchedule } from '../services/scheduler';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

const createScheduleSchema = z.object({
  agentId: z.string().uuid(),
  cronExpression: z.string().min(1),
  enabled: z.boolean().default(true),
});

const updateScheduleSchema = createScheduleSchema.partial().omit({ agentId: true });

// GET /api/schedules
router.get('/', async (req: Request, res: Response) => {
  try {
    const allSchedules = await db
      .select({
        id: schedules.id,
        agentId: schedules.agentId,
        agentName: agents.name,
        agentStatus: agents.status,
        cronExpression: schedules.cronExpression,
        enabled: schedules.enabled,
        lastRunAt: schedules.lastRunAt,
        nextRunAt: schedules.nextRunAt,
        createdAt: schedules.createdAt,
        updatedAt: schedules.updatedAt,
      })
      .from(schedules)
      .innerJoin(agents, eq(schedules.agentId, agents.id))
      .orderBy(schedules.createdAt);

    res.json({ data: allSchedules, total: allSchedules.length });
  } catch (err) {
    console.error('[Schedules] GET / error:', err);
    res.status(500).json({ error: 'Failed to fetch schedules' });
  }
});

// GET /api/schedules/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const [schedule] = await db
      .select({
        id: schedules.id,
        agentId: schedules.agentId,
        agentName: agents.name,
        cronExpression: schedules.cronExpression,
        enabled: schedules.enabled,
        lastRunAt: schedules.lastRunAt,
        nextRunAt: schedules.nextRunAt,
        createdAt: schedules.createdAt,
        updatedAt: schedules.updatedAt,
      })
      .from(schedules)
      .innerJoin(agents, eq(schedules.agentId, agents.id))
      .where(eq(schedules.id, req.params.id));

    if (!schedule) {
      res.status(404).json({ error: 'Schedule not found' });
      return;
    }

    res.json({ data: schedule });
  } catch (err) {
    console.error('[Schedules] GET /:id error:', err);
    res.status(500).json({ error: 'Failed to fetch schedule' });
  }
});

// POST /api/schedules
router.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = createScheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      return;
    }

    const { agentId, cronExpression, enabled } = parsed.data;

    // Verify agent exists
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    // Validate cron expression basic format
    const cronParts = cronExpression.trim().split(/\s+/);
    if (cronParts.length < 5 || cronParts.length > 6) {
      res.status(400).json({ error: 'Invalid cron expression. Must have 5 or 6 parts.' });
      return;
    }

    const now = new Date().toISOString();
    const [newSchedule] = await db
      .insert(schedules)
      .values({
        id: uuidv4(),
        agentId,
        cronExpression,
        enabled,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Register with scheduler if enabled and agent is active
    if (enabled && agent.status === 'active') {
      await scheduleAgent({
        id: newSchedule.id,
        agentId: newSchedule.agentId,
        cronExpression: newSchedule.cronExpression,
        enabled: true,
      });
    }

    res.status(201).json({ data: newSchedule });
  } catch (err) {
    console.error('[Schedules] POST / error:', err);
    res.status(500).json({ error: 'Failed to create schedule' });
  }
});

// PUT /api/schedules/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const parsed = updateScheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      return;
    }

    const [existing] = await db.select().from(schedules).where(eq(schedules.id, req.params.id));
    if (!existing) {
      res.status(404).json({ error: 'Schedule not found' });
      return;
    }

    const [updated] = await db
      .update(schedules)
      .set({ ...parsed.data, updatedAt: new Date().toISOString() })
      .where(eq(schedules.id, req.params.id))
      .returning();

    // Re-register schedule
    await removeSchedule(req.params.id);
    if (updated.enabled) {
      const [agent] = await db.select().from(agents).where(eq(agents.id, updated.agentId));
      if (agent && agent.status === 'active') {
        await scheduleAgent({
          id: updated.id,
          agentId: updated.agentId,
          cronExpression: updated.cronExpression,
          enabled: true,
        });
      }
    }

    res.json({ data: updated });
  } catch (err) {
    console.error('[Schedules] PUT /:id error:', err);
    res.status(500).json({ error: 'Failed to update schedule' });
  }
});

// DELETE /api/schedules/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const [existing] = await db.select().from(schedules).where(eq(schedules.id, req.params.id));
    if (!existing) {
      res.status(404).json({ error: 'Schedule not found' });
      return;
    }

    await removeSchedule(req.params.id);
    await db.delete(schedules).where(eq(schedules.id, req.params.id));

    res.json({ message: 'Schedule deleted successfully' });
  } catch (err) {
    console.error('[Schedules] DELETE /:id error:', err);
    res.status(500).json({ error: 'Failed to delete schedule' });
  }
});

// POST /api/schedules/:id/enable
router.post('/:id/enable', async (req: Request, res: Response) => {
  try {
    const [existing] = await db.select().from(schedules).where(eq(schedules.id, req.params.id));
    if (!existing) {
      res.status(404).json({ error: 'Schedule not found' });
      return;
    }

    const [updated] = await db
      .update(schedules)
      .set({ enabled: true, updatedAt: new Date().toISOString() })
      .where(eq(schedules.id, req.params.id))
      .returning();

    const [agent] = await db.select().from(agents).where(eq(agents.id, existing.agentId));
    if (agent && agent.status === 'active') {
      await scheduleAgent({
        id: updated.id,
        agentId: updated.agentId,
        cronExpression: updated.cronExpression,
        enabled: true,
      });
    }

    res.json({ data: updated, message: 'Schedule enabled' });
  } catch (err) {
    console.error('[Schedules] POST /:id/enable error:', err);
    res.status(500).json({ error: 'Failed to enable schedule' });
  }
});

// POST /api/schedules/:id/disable
router.post('/:id/disable', async (req: Request, res: Response) => {
  try {
    const [existing] = await db.select().from(schedules).where(eq(schedules.id, req.params.id));
    if (!existing) {
      res.status(404).json({ error: 'Schedule not disabled' });
      return;
    }

    const [updated] = await db
      .update(schedules)
      .set({ enabled: false, updatedAt: new Date().toISOString() })
      .where(eq(schedules.id, req.params.id))
      .returning();

    await removeSchedule(req.params.id);

    res.json({ data: updated, message: 'Schedule disabled' });
  } catch (err) {
    console.error('[Schedules] POST /:id/disable error:', err);
    res.status(500).json({ error: 'Failed to disable schedule' });
  }
});

export default router;
