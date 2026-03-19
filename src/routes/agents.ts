import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { agents, runs, schedules } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import { executeAgent } from '../services/executor';
import { checkBudget, recordSpend } from '../services/budget';
import { scheduleAgent, removeSchedule } from '../services/scheduler';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

const createAgentSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  type: z.enum(['http', 'claude', 'openai', 'bash']),
  config: z.record(z.unknown()).default({}),
  status: z.enum(['active', 'paused', 'error']).default('active'),
});

const updateAgentSchema = createAgentSchema.partial();

// GET /api/agents
router.get('/', async (req: Request, res: Response) => {
  try {
    const allAgents = await db.select().from(agents).orderBy(agents.createdAt);
    res.json({ data: allAgents, total: allAgents.length });
  } catch (err) {
    console.error('[Agents] GET / error:', err);
    res.status(500).json({ error: 'Failed to fetch agents' });
  }
});

// GET /api/agents/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const [agent] = await db.select().from(agents).where(eq(agents.id, req.params.id));
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    res.json({ data: agent });
  } catch (err) {
    console.error('[Agents] GET /:id error:', err);
    res.status(500).json({ error: 'Failed to fetch agent' });
  }
});

// POST /api/agents
router.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = createAgentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      return;
    }

    const { name, description, type, config, status } = parsed.data;

    const [newAgent] = await db
      .insert(agents)
      .values({
        id: uuidv4(),
        name,
        description: description || null,
        type,
        config,
        status,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    res.status(201).json({ data: newAgent });
  } catch (err) {
    console.error('[Agents] POST / error:', err);
    res.status(500).json({ error: 'Failed to create agent' });
  }
});

// PUT /api/agents/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const parsed = updateAgentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      return;
    }

    const [existing] = await db.select().from(agents).where(eq(agents.id, req.params.id));
    if (!existing) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const [updated] = await db
      .update(agents)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(agents.id, req.params.id))
      .returning();

    // If status changed to paused/active, update schedules
    if (parsed.data.status === 'paused') {
      const agentSchedules = await db.select().from(schedules).where(eq(schedules.agentId, req.params.id));
      for (const schedule of agentSchedules) {
        await removeSchedule(schedule.id);
      }
    } else if (parsed.data.status === 'active' && existing.status !== 'active') {
      const agentSchedules = await db
        .select()
        .from(schedules)
        .where(eq(schedules.agentId, req.params.id));
      for (const schedule of agentSchedules) {
        if (schedule.enabled) {
          await scheduleAgent({
            id: schedule.id,
            agentId: schedule.agentId,
            cronExpression: schedule.cronExpression,
            enabled: true,
          });
        }
      }
    }

    res.json({ data: updated });
  } catch (err) {
    console.error('[Agents] PUT /:id error:', err);
    res.status(500).json({ error: 'Failed to update agent' });
  }
});

// DELETE /api/agents/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const [existing] = await db.select().from(agents).where(eq(agents.id, req.params.id));
    if (!existing) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    // Remove all schedules from queue first
    const agentSchedules = await db.select().from(schedules).where(eq(schedules.agentId, req.params.id));
    for (const schedule of agentSchedules) {
      await removeSchedule(schedule.id);
    }

    await db.delete(agents).where(eq(agents.id, req.params.id));

    res.json({ message: 'Agent deleted successfully' });
  } catch (err) {
    console.error('[Agents] DELETE /:id error:', err);
    res.status(500).json({ error: 'Failed to delete agent' });
  }
});

// POST /api/agents/:id/run
router.post('/:id/run', async (req: Request, res: Response) => {
  try {
    const [agent] = await db.select().from(agents).where(eq(agents.id, req.params.id));
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    if (agent.status === 'paused') {
      res.status(400).json({ error: 'Agent is paused' });
      return;
    }

    const budgetCheck = await checkBudget(agent.id);
    if (!budgetCheck.allowed) {
      res.status(429).json({
        error: 'Budget exceeded',
        remaining: budgetCheck.remaining,
        limit: budgetCheck.limit,
        currentSpend: budgetCheck.currentSpend,
      });
      return;
    }

    const input = req.body.input || req.body || {};
    const result = await executeAgent(agent.id, input, 'api');

    if (result.costUsd > 0) {
      await recordSpend(agent.id, result.costUsd);
    }

    res.json({ data: result });
  } catch (err) {
    console.error('[Agents] POST /:id/run error:', err);
    res.status(500).json({ error: 'Failed to run agent' });
  }
});

// GET /api/agents/:id/runs
router.get('/:id/runs', async (req: Request, res: Response) => {
  try {
    const [agent] = await db.select().from(agents).where(eq(agents.id, req.params.id));
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const limit = Math.min(parseInt(req.query.limit as string || '50', 10), 200);
    const offset = parseInt(req.query.offset as string || '0', 10);

    const agentRuns = await db
      .select()
      .from(runs)
      .where(eq(runs.agentId, req.params.id))
      .orderBy(desc(runs.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({ data: agentRuns, total: agentRuns.length, limit, offset });
  } catch (err) {
    console.error('[Agents] GET /:id/runs error:', err);
    res.status(500).json({ error: 'Failed to fetch runs' });
  }
});

export default router;
