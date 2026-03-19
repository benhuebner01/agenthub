import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../db';
import { budgets, agents } from '../db/schema';
import { eq } from 'drizzle-orm';
import { createOrUpdateBudget, resetBudget } from '../services/budget';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

const budgetSchema = z.object({
  agentId: z.string().uuid(),
  period: z.enum(['daily', 'weekly', 'monthly']).default('monthly'),
  limitUsd: z.number().positive(),
});

// GET /api/budgets
router.get('/', async (req: Request, res: Response) => {
  try {
    const allBudgets = await db
      .select({
        id: budgets.id,
        agentId: budgets.agentId,
        agentName: agents.name,
        agentType: agents.type,
        period: budgets.period,
        limitUsd: budgets.limitUsd,
        currentSpend: budgets.currentSpend,
        periodStart: budgets.periodStart,
        createdAt: budgets.createdAt,
        updatedAt: budgets.updatedAt,
      })
      .from(budgets)
      .innerJoin(agents, eq(budgets.agentId, agents.id))
      .orderBy(budgets.createdAt);

    res.json({ data: allBudgets, total: allBudgets.length });
  } catch (err) {
    console.error('[Budgets] GET / error:', err);
    res.status(500).json({ error: 'Failed to fetch budgets' });
  }
});

// GET /api/budgets/:agentId
router.get('/:agentId', async (req: Request, res: Response) => {
  try {
    const [budget] = await db
      .select({
        id: budgets.id,
        agentId: budgets.agentId,
        agentName: agents.name,
        agentType: agents.type,
        period: budgets.period,
        limitUsd: budgets.limitUsd,
        currentSpend: budgets.currentSpend,
        periodStart: budgets.periodStart,
        createdAt: budgets.createdAt,
        updatedAt: budgets.updatedAt,
      })
      .from(budgets)
      .innerJoin(agents, eq(budgets.agentId, agents.id))
      .where(eq(budgets.agentId, req.params.agentId));

    if (!budget) {
      res.status(404).json({ error: 'Budget not found for this agent' });
      return;
    }

    const limit = parseFloat(budget.limitUsd as string);
    const spend = parseFloat(budget.currentSpend as string);
    const percentUsed = limit > 0 ? (spend / limit) * 100 : 0;

    res.json({
      data: {
        ...budget,
        percentUsed: parseFloat(percentUsed.toFixed(2)),
        remaining: Math.max(0, limit - spend),
      },
    });
  } catch (err) {
    console.error('[Budgets] GET /:agentId error:', err);
    res.status(500).json({ error: 'Failed to fetch budget' });
  }
});

// POST /api/budgets
router.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = budgetSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      return;
    }

    const { agentId, period, limitUsd } = parsed.data;

    // Verify agent exists
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    await createOrUpdateBudget(agentId, period, limitUsd);

    const [budget] = await db.select().from(budgets).where(eq(budgets.agentId, agentId));

    res.status(201).json({ data: budget });
  } catch (err) {
    console.error('[Budgets] POST / error:', err);
    res.status(500).json({ error: 'Failed to create/update budget' });
  }
});

// DELETE /api/budgets/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const [existing] = await db.select().from(budgets).where(eq(budgets.id, req.params.id));
    if (!existing) {
      res.status(404).json({ error: 'Budget not found' });
      return;
    }

    await db.delete(budgets).where(eq(budgets.id, req.params.id));

    res.json({ message: 'Budget deleted successfully' });
  } catch (err) {
    console.error('[Budgets] DELETE /:id error:', err);
    res.status(500).json({ error: 'Failed to delete budget' });
  }
});

// POST /api/budgets/:agentId/reset
router.post('/:agentId/reset', async (req: Request, res: Response) => {
  try {
    const [existing] = await db.select().from(budgets).where(eq(budgets.agentId, req.params.agentId));
    if (!existing) {
      res.status(404).json({ error: 'Budget not found for this agent' });
      return;
    }

    await resetBudget(req.params.agentId);

    const [updated] = await db.select().from(budgets).where(eq(budgets.agentId, req.params.agentId));

    res.json({ data: updated, message: 'Budget reset to zero' });
  } catch (err) {
    console.error('[Budgets] POST /:agentId/reset error:', err);
    res.status(500).json({ error: 'Failed to reset budget' });
  }
});

export default router;
