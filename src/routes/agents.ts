import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { agents, runs, schedules, agentCalls, agentMemory } from '../db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { executeAgent } from '../services/executor';
import { checkBudget, recordSpend } from '../services/budget';
import { scheduleAgent, removeSchedule } from '../services/scheduler';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

const createAgentSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  type: z.enum(['http', 'claude', 'openai', 'bash', 'claude-code', 'openai-codex', 'cursor', 'openclaw', 'a2a', 'internal']),
  config: z.record(z.unknown()).default({}),
  status: z.enum(['active', 'paused', 'error']).default('active'),
  role: z.enum(['ceo', 'manager', 'worker', 'specialist']).optional(),
  jobDescription: z.string().optional(),
  parentAgentId: z.string().optional(),
  organizationId: z.string().optional(),
});

const updateAgentSchema = createAgentSchema.partial();

// GET /api/agents
router.get('/', async (req: Request, res: Response) => {
  try {
    const organizationId = req.query.organizationId as string | undefined;
    const role = req.query.role as string | undefined;

    let allAgents = await db.select().from(agents).orderBy(agents.createdAt);

    if (organizationId) {
      allAgents = allAgents.filter((a) => a.organizationId === organizationId);
    }
    if (role) {
      allAgents = allAgents.filter((a) => a.role === role);
    }

    // Enrich with parent name and children count
    const agentMap = new Map(allAgents.map((a) => [a.id, a]));
    const enriched = allAgents.map((a) => {
      const parentAgent = a.parentAgentId ? agentMap.get(a.parentAgentId) : null;
      const childrenCount = allAgents.filter((c) => c.parentAgentId === a.id).length;
      return {
        ...a,
        parentAgentName: parentAgent?.name || null,
        childrenCount,
      };
    });

    res.json({ data: enriched, total: enriched.length });
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

    // Enrich with parent agent info
    let parentAgent = null;
    if (agent.parentAgentId) {
      const [parent] = await db.select().from(agents).where(eq(agents.id, agent.parentAgentId));
      parentAgent = parent || null;
    }

    const children = await db.select().from(agents).where(eq(agents.parentAgentId, agent.id));

    res.json({ data: { ...agent, parentAgent, children } });
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

    const { name, description, type, config, status, role, jobDescription, parentAgentId, organizationId } = parsed.data;
    const now = new Date().toISOString();

    const [newAgent] = await db
      .insert(agents)
      .values({
        id: uuidv4(),
        name,
        description: description || null,
        type,
        config,
        status,
        role: role || 'worker',
        jobDescription: jobDescription || null,
        parentAgentId: parentAgentId || null,
        organizationId: organizationId || null,
        createdAt: now,
        updatedAt: now,
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

    const updateData: Record<string, unknown> = { ...parsed.data, updatedAt: new Date().toISOString() };

    const [updated] = await db
      .update(agents)
      .set(updateData)
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

// GET /api/agents/:id/memory
router.get('/:id/memory', async (req: Request, res: Response) => {
  try {
    const agentId = req.params.id;
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const memories = await db.select().from(agentMemory).where(eq(agentMemory.agentId, agentId));
    res.json({ data: memories, total: memories.length });
  } catch (err: any) {
    console.error('[Agents] GET /:id/memory error:', err);
    res.status(500).json({ error: 'Failed to fetch agent memory' });
  }
});

// POST /api/agents/:id/memory
router.post('/:id/memory', async (req: Request, res: Response) => {
  try {
    const agentId = req.params.id;
    const { key, value } = req.body;

    if (!key || value === undefined) {
      res.status(400).json({ error: 'key and value are required' });
      return;
    }

    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const now = new Date().toISOString();
    const existing = await db.select().from(agentMemory)
      .where(and(eq(agentMemory.agentId, agentId), eq(agentMemory.key, key)));

    if (existing.length > 0) {
      const [updated] = await db.update(agentMemory)
        .set({ value: String(value), updatedAt: now })
        .where(and(eq(agentMemory.agentId, agentId), eq(agentMemory.key, key)))
        .returning();
      res.json({ data: updated });
    } else {
      const [created] = await db.insert(agentMemory).values({
        id: uuidv4(),
        agentId,
        key,
        value: String(value),
        updatedAt: now,
      }).returning();
      res.status(201).json({ data: created });
    }
  } catch (err: any) {
    console.error('[Agents] POST /:id/memory error:', err);
    res.status(500).json({ error: 'Failed to set memory' });
  }
});

// DELETE /api/agents/:id/memory/:key
router.delete('/:id/memory/:key', async (req: Request, res: Response) => {
  try {
    const agentId = req.params.id;
    const key = req.params.key;

    const existing = await db.select().from(agentMemory)
      .where(and(eq(agentMemory.agentId, agentId), eq(agentMemory.key, key)));

    if (existing.length === 0) {
      res.status(404).json({ error: 'Memory key not found' });
      return;
    }

    await db.delete(agentMemory)
      .where(and(eq(agentMemory.agentId, agentId), eq(agentMemory.key, key)));

    res.json({ message: 'Memory key deleted' });
  } catch (err: any) {
    console.error('[Agents] DELETE /:id/memory/:key error:', err);
    res.status(500).json({ error: 'Failed to delete memory key' });
  }
});

// POST /api/agents/:id/delegate
router.post('/:id/delegate', async (req: Request, res: Response) => {
  try {
    const callerAgentId = req.params.id;
    const { targetAgentId, input, context } = req.body;

    if (!targetAgentId) {
      res.status(400).json({ error: 'targetAgentId is required' });
      return;
    }

    const [callerAgent] = await db.select().from(agents).where(eq(agents.id, callerAgentId));
    if (!callerAgent) {
      res.status(404).json({ error: 'Caller agent not found' });
      return;
    }

    const [targetAgent] = await db.select().from(agents).where(eq(agents.id, targetAgentId));
    if (!targetAgent) {
      res.status(404).json({ error: 'Target agent not found' });
      return;
    }

    if (targetAgent.status === 'paused') {
      res.status(400).json({ error: 'Target agent is paused' });
      return;
    }

    const callId = uuidv4();
    const now = new Date().toISOString();

    // Create agent_call record
    await db.insert(agentCalls).values({
      id: callId,
      callerAgentId,
      calleeAgentId: targetAgentId,
      input: input || null,
      status: 'running',
      costUsd: 0,
      createdAt: now,
    });

    // Execute the target agent
    const delegationInput = context
      ? { ...input, _delegationContext: context, _delegatedBy: callerAgent.name }
      : { ...input, _delegatedBy: callerAgent.name };

    const result = await executeAgent(targetAgentId, delegationInput, 'api');

    // Update agent_call record
    await db.update(agentCalls)
      .set({
        output: result.output as any,
        status: result.success ? 'success' : 'failed',
        costUsd: result.costUsd,
        completedAt: new Date().toISOString(),
      })
      .where(eq(agentCalls.id, callId));

    if (result.costUsd > 0) {
      await recordSpend(targetAgentId, result.costUsd);
    }

    res.json({ data: result, callId });
  } catch (err: any) {
    console.error('[Agents] POST /:id/delegate error:', err);
    res.status(500).json({ error: 'Failed to delegate task', details: err.message });
  }
});

export default router;
