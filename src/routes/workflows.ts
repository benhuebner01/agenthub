import { Router, Request, Response } from 'express';
import { db } from '../db';
import { workflows, workflowRuns } from '../db/schema';
import { eq, desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// GET /api/workflows/runs/all — get all workflow runs (MUST be before /:id)
router.get('/runs/all', async (_req: Request, res: Response) => {
  try {
    const allRuns = await db.select().from(workflowRuns).orderBy(desc(workflowRuns.createdAt));
    res.json(allRuns);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/workflows/runs/:runId — update a workflow run (advance step, complete, etc.)
router.put('/runs/:runId', async (req: Request, res: Response) => {
  try {
    const now = new Date().toISOString();
    const updates: any = { ...req.body };
    delete updates.id;
    delete updates.createdAt;
    if (updates.status === 'completed' || updates.status === 'failed') updates.completedAt = now;

    const [run] = await db.update(workflowRuns).set(updates).where(eq(workflowRuns.id, req.params.runId)).returning();
    if (!run) { res.status(404).json({ error: 'Workflow run not found' }); return; }
    res.json(run);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/workflows
router.get('/', async (req: Request, res: Response) => {
  try {
    const { organizationId } = req.query;
    const query = organizationId
      ? db.select().from(workflows).where(eq(workflows.organizationId, organizationId as string))
      : db.select().from(workflows);
    const result = await query.orderBy(desc(workflows.createdAt));
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/workflows/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const [wf] = await db.select().from(workflows).where(eq(workflows.id, req.params.id));
    if (!wf) { res.status(404).json({ error: 'Workflow not found' }); return; }

    const runs = await db.select().from(workflowRuns)
      .where(eq(workflowRuns.workflowId, req.params.id))
      .orderBy(desc(workflowRuns.createdAt));

    res.json({ ...wf, runs });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/workflows — create
router.post('/', async (req: Request, res: Response) => {
  try {
    const now = new Date().toISOString();
    const [wf] = await db.insert(workflows).values({
      id: uuidv4(),
      name: req.body.name,
      description: req.body.description || null,
      organizationId: req.body.organizationId || null,
      trigger: req.body.trigger || 'manual',
      status: 'draft',
      steps: req.body.steps || [],
      createdAt: now,
      updatedAt: now,
    }).returning();
    res.status(201).json(wf);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/workflows/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const now = new Date().toISOString();
    const updates = { ...req.body, updatedAt: now };
    delete updates.id;
    delete updates.createdAt;
    const [wf] = await db.update(workflows).set(updates).where(eq(workflows.id, req.params.id)).returning();
    if (!wf) { res.status(404).json({ error: 'Workflow not found' }); return; }
    res.json(wf);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/workflows/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await db.delete(workflowRuns).where(eq(workflowRuns.workflowId, req.params.id));
    const [wf] = await db.delete(workflows).where(eq(workflows.id, req.params.id)).returning();
    if (!wf) { res.status(404).json({ error: 'Workflow not found' }); return; }
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/workflows/:id/run — start a workflow run
router.post('/:id/run', async (req: Request, res: Response) => {
  try {
    const [wf] = await db.select().from(workflows).where(eq(workflows.id, req.params.id));
    if (!wf) { res.status(404).json({ error: 'Workflow not found' }); return; }

    const steps = (wf.steps || []) as any[];
    const firstStepId = steps.length > 0 ? steps[0].id : null;

    const now = new Date().toISOString();
    const [run] = await db.insert(workflowRuns).values({
      id: uuidv4(),
      workflowId: req.params.id,
      goalId: req.body.goalId || null,
      status: 'running',
      currentStepId: firstStepId,
      stepResults: {},
      input: req.body.input || null,
      startedAt: now,
      createdAt: now,
    }).returning();

    res.status(201).json(run);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
