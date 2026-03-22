import { Router, Request, Response } from 'express';
import { db } from '../db';
import { goals, planSteps } from '../db/schema';
import { eq, and, desc, asc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// GET /api/goals — list all goals (optionally filter by org or agent)
router.get('/', async (req: Request, res: Response) => {
  try {
    const { organizationId, agentId, status } = req.query;
    let query = db.select().from(goals);

    // Build conditions array
    const conditions: any[] = [];
    if (organizationId) conditions.push(eq(goals.organizationId, organizationId as string));
    if (agentId) conditions.push(eq(goals.agentId, agentId as string));
    if (status) conditions.push(eq(goals.status, status as string));

    const result = conditions.length > 0
      ? await query.where(and(...conditions)).orderBy(desc(goals.createdAt))
      : await query.orderBy(desc(goals.createdAt));

    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/goals/:id — get goal with its plan steps
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const [goal] = await db.select().from(goals).where(eq(goals.id, req.params.id));
    if (!goal) { res.status(404).json({ error: 'Goal not found' }); return; }

    const steps = await db.select().from(planSteps)
      .where(eq(planSteps.goalId, req.params.id))
      .orderBy(asc(planSteps.order));

    res.json({ ...goal, steps });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/goals — create a new goal
router.post('/', async (req: Request, res: Response) => {
  try {
    const { title, description, priority, organizationId, agentId, successCriteria, constraints, deadline, measurableTarget } = req.body;
    if (!title) { res.status(400).json({ error: 'Title is required' }); return; }

    const id = uuidv4();
    const now = new Date().toISOString();
    const [goal] = await db.insert(goals).values({
      id,
      title,
      description: description || null,
      priority: priority || 'medium',
      status: 'draft',
      organizationId: organizationId || null,
      agentId: agentId || null,
      successCriteria: successCriteria || [],
      constraints: constraints || [],
      deadline: deadline || null,
      measurableTarget: measurableTarget || null,
      progress: 0,
      createdAt: now,
      updatedAt: now,
    }).returning();

    res.status(201).json(goal);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/goals/:id — update a goal
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const now = new Date().toISOString();
    const updates: any = { ...req.body, updatedAt: now };
    delete updates.id;
    delete updates.createdAt;

    if (updates.status === 'achieved') updates.completedAt = now;

    const [goal] = await db.update(goals)
      .set(updates)
      .where(eq(goals.id, req.params.id))
      .returning();

    if (!goal) { res.status(404).json({ error: 'Goal not found' }); return; }
    res.json(goal);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/goals/:id — delete a goal and its steps
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await db.delete(planSteps).where(eq(planSteps.goalId, req.params.id));
    const [goal] = await db.delete(goals).where(eq(goals.id, req.params.id)).returning();
    if (!goal) { res.status(404).json({ error: 'Goal not found' }); return; }
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Plan Steps ────────────────────────────────────────────────────────────

// POST /api/goals/:id/steps — add a step to a goal
router.post('/:id/steps', async (req: Request, res: Response) => {
  try {
    const { title, description, type, assignedAgentId, dependsOn, verification, order } = req.body;
    if (!title) { res.status(400).json({ error: 'Step title is required' }); return; }

    // Auto-calculate order if not provided
    let stepOrder = order;
    if (stepOrder === undefined) {
      const existingSteps = await db.select().from(planSteps).where(eq(planSteps.goalId, req.params.id));
      stepOrder = existingSteps.length;
    }

    const id = uuidv4();
    const now = new Date().toISOString();
    const [step] = await db.insert(planSteps).values({
      id,
      goalId: req.params.id,
      title,
      description: description || null,
      type: type || 'action',
      assignedAgentId: assignedAgentId || null,
      order: stepOrder,
      status: 'pending',
      dependsOn: dependsOn || [],
      verification: verification || null,
      retries: 0,
      maxRetries: 3,
      createdAt: now,
      updatedAt: now,
    }).returning();

    res.status(201).json(step);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/goals/:goalId/steps/:stepId — update a step
router.put('/:goalId/steps/:stepId', async (req: Request, res: Response) => {
  try {
    const now = new Date().toISOString();
    const updates: any = { ...req.body, updatedAt: now };
    delete updates.id;
    delete updates.goalId;
    delete updates.createdAt;

    if (updates.status === 'completed' || updates.status === 'verified') updates.completedAt = now;
    if (updates.status === 'running') updates.startedAt = now;

    const [step] = await db.update(planSteps)
      .set(updates)
      .where(and(eq(planSteps.id, req.params.stepId), eq(planSteps.goalId, req.params.goalId)))
      .returning();

    if (!step) { res.status(404).json({ error: 'Step not found' }); return; }

    // Recalculate goal progress
    const allSteps = await db.select().from(planSteps).where(eq(planSteps.goalId, req.params.goalId));
    if (allSteps.length > 0) {
      const completed = allSteps.filter((s: any) => s.status === 'completed' || s.status === 'verified').length;
      const progress = Math.round((completed / allSteps.length) * 100);
      await db.update(goals).set({ progress, updatedAt: now }).where(eq(goals.id, req.params.goalId));
    }

    res.json(step);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/goals/:goalId/steps/:stepId — delete a step
router.delete('/:goalId/steps/:stepId', async (req: Request, res: Response) => {
  try {
    const [step] = await db.delete(planSteps)
      .where(and(eq(planSteps.id, req.params.stepId), eq(planSteps.goalId, req.params.goalId)))
      .returning();
    if (!step) { res.status(404).json({ error: 'Step not found' }); return; }
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/goals/:id/activate — activate a goal (move from draft to active, resolve step readiness)
router.post('/:id/activate', async (req: Request, res: Response) => {
  try {
    const now = new Date().toISOString();
    const [goal] = await db.select().from(goals).where(eq(goals.id, req.params.id));
    if (!goal) { res.status(404).json({ error: 'Goal not found' }); return; }

    // Mark goal as active
    await db.update(goals).set({ status: 'active', updatedAt: now }).where(eq(goals.id, req.params.id));

    // Mark steps with no dependencies as 'ready'
    const steps = await db.select().from(planSteps).where(eq(planSteps.goalId, req.params.id));
    for (const step of steps) {
      const deps = (step.dependsOn as string[]) || [];
      if (deps.length === 0 && step.status === 'pending') {
        await db.update(planSteps).set({ status: 'ready', updatedAt: now }).where(eq(planSteps.id, step.id));
      }
    }

    const updatedSteps = await db.select().from(planSteps)
      .where(eq(planSteps.goalId, req.params.id))
      .orderBy(asc(planSteps.order));

    res.json({ status: 'active', steps: updatedSteps });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/goals/:id/advance — advance the plan: check completed deps, mark next steps as ready
router.post('/:id/advance', async (req: Request, res: Response) => {
  try {
    const now = new Date().toISOString();
    const steps = await db.select().from(planSteps).where(eq(planSteps.goalId, req.params.id));

    const completedIds = new Set(
      steps.filter((s: any) => s.status === 'completed' || s.status === 'verified').map((s: any) => s.id)
    );

    let advanced = 0;
    for (const step of steps) {
      if (step.status !== 'pending') continue;
      const deps = (step.dependsOn as string[]) || [];
      const allDepsMet = deps.length === 0 || deps.every((d: string) => completedIds.has(d));
      if (allDepsMet) {
        await db.update(planSteps).set({ status: 'ready', updatedAt: now }).where(eq(planSteps.id, step.id));
        advanced++;
      }
    }

    // Recalculate
    const updatedSteps = await db.select().from(planSteps)
      .where(eq(planSteps.goalId, req.params.id))
      .orderBy(asc(planSteps.order));
    const totalSteps = updatedSteps.length;
    const doneSteps = updatedSteps.filter((s: any) =>
      s.status === 'completed' || s.status === 'verified' || s.status === 'skipped'
    ).length;

    const progress = totalSteps > 0 ? Math.round((doneSteps / totalSteps) * 100) : 0;
    const goalStatus = progress === 100 ? 'achieved' : 'in_progress';

    await db.update(goals).set({
      progress,
      status: goalStatus,
      updatedAt: now,
      ...(goalStatus === 'achieved' ? { completedAt: now } : {}),
    }).where(eq(goals.id, req.params.id));

    res.json({ advanced, progress, goalStatus, steps: updatedSteps });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
