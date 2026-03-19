import { Router, Request, Response } from 'express';
import { db } from '../db';
import { runs, agents, toolCalls, auditLogs } from '../db/schema';
import { eq, desc, and, SQL } from 'drizzle-orm';

const router = Router();

// GET /api/runs
router.get('/', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string || '50', 10), 200);
    const offset = parseInt(req.query.offset as string || '0', 10);
    const agentId = req.query.agentId as string | undefined;
    const status = req.query.status as string | undefined;

    const conditions: SQL[] = [];

    if (agentId) {
      conditions.push(eq(runs.agentId, agentId));
    }

    if (status) {
      conditions.push(eq(runs.status, status as 'pending' | 'running' | 'success' | 'failed' | 'cancelled'));
    }

    const query = db
      .select({
        id: runs.id,
        agentId: runs.agentId,
        agentName: agents.name,
        agentType: agents.type,
        scheduleId: runs.scheduleId,
        status: runs.status,
        startedAt: runs.startedAt,
        completedAt: runs.completedAt,
        tokensUsed: runs.tokensUsed,
        costUsd: runs.costUsd,
        triggeredBy: runs.triggeredBy,
        error: runs.error,
        createdAt: runs.createdAt,
      })
      .from(runs)
      .innerJoin(agents, eq(runs.agentId, agents.id))
      .orderBy(desc(runs.createdAt))
      .limit(limit)
      .offset(offset);

    const allRuns = conditions.length > 0
      ? await query.where(and(...conditions))
      : await query;

    res.json({ data: allRuns, total: allRuns.length, limit, offset });
  } catch (err) {
    console.error('[Runs] GET / error:', err);
    res.status(500).json({ error: 'Failed to fetch runs' });
  }
});

// GET /api/runs/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const [run] = await db
      .select({
        id: runs.id,
        agentId: runs.agentId,
        agentName: agents.name,
        agentType: agents.type,
        scheduleId: runs.scheduleId,
        status: runs.status,
        startedAt: runs.startedAt,
        completedAt: runs.completedAt,
        input: runs.input,
        output: runs.output,
        error: runs.error,
        tokensUsed: runs.tokensUsed,
        costUsd: runs.costUsd,
        triggeredBy: runs.triggeredBy,
        createdAt: runs.createdAt,
      })
      .from(runs)
      .innerJoin(agents, eq(runs.agentId, agents.id))
      .where(eq(runs.id, req.params.id));

    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    // Get tool calls for this run
    const runToolCalls = await db
      .select()
      .from(toolCalls)
      .where(eq(toolCalls.runId, req.params.id))
      .orderBy(toolCalls.createdAt);

    res.json({ data: { ...run, toolCalls: runToolCalls } });
  } catch (err) {
    console.error('[Runs] GET /:id error:', err);
    res.status(500).json({ error: 'Failed to fetch run' });
  }
});

// DELETE /api/runs/:id - Cancel a pending/running run
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const [run] = await db.select().from(runs).where(eq(runs.id, req.params.id));
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    if (run.status !== 'pending' && run.status !== 'running') {
      res.status(400).json({
        error: `Cannot cancel run with status "${run.status}". Only pending or running runs can be cancelled.`,
      });
      return;
    }

    await db
      .update(runs)
      .set({ status: 'cancelled', completedAt: new Date().toISOString() })
      .where(eq(runs.id, req.params.id));

    res.json({ message: 'Run cancelled successfully' });
  } catch (err) {
    console.error('[Runs] DELETE /:id error:', err);
    res.status(500).json({ error: 'Failed to cancel run' });
  }
});

// GET /api/runs/:id/logs - Get audit logs for a run
router.get('/:id/logs', async (req: Request, res: Response) => {
  try {
    const [run] = await db.select().from(runs).where(eq(runs.id, req.params.id));
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    const logs = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.runId, req.params.id))
      .orderBy(auditLogs.createdAt);

    res.json({ data: logs, total: logs.length });
  } catch (err) {
    console.error('[Runs] GET /:id/logs error:', err);
    res.status(500).json({ error: 'Failed to fetch run logs' });
  }
});

export default router;
