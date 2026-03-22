import { Router, Request, Response } from 'express';
import { db } from '../db';
import { runs, agents, organizations } from '../db/schema';
import { eq, gte, lte, and, sql, desc } from 'drizzle-orm';

const router = Router();

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

// ─── GET /api/costs/summary ───────────────────────────────────────────────────

router.get('/summary', async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const todayStart = startOfDay(now).toISOString();
    const weekStart = startOfWeek(now).toISOString();
    const monthStart = startOfMonth(now).toISOString();

    const allRuns = await db.select({
      agentId: runs.agentId,
      costUsd: runs.costUsd,
      createdAt: runs.createdAt,
      status: runs.status,
    }).from(runs).orderBy(desc(runs.createdAt));

    const allAgents = await db.select({ id: agents.id, name: agents.name }).from(agents);
    const agentMap = new Map<string, string>(allAgents.map((a: { id: string; name: string }) => [a.id, a.name]));

    let totalThisMonth = 0;
    let totalThisWeek = 0;
    let totalToday = 0;
    const agentCostMap = new Map<string, { agentId: string; name: string; cost: number; runs: number }>();

    for (const run of allRuns) {
      const cost = Number(run.costUsd) || 0;
      const createdAt = run.createdAt;

      if (createdAt && createdAt >= monthStart) totalThisMonth += cost;
      if (createdAt && createdAt >= weekStart) totalThisWeek += cost;
      if (createdAt && createdAt >= todayStart) totalToday += cost;

      if (!agentCostMap.has(run.agentId)) {
        agentCostMap.set(run.agentId, {
          agentId: run.agentId,
          name: agentMap.get(run.agentId) || run.agentId.slice(0, 8),
          cost: 0,
          runs: 0,
        });
      }
      const entry = agentCostMap.get(run.agentId)!;
      entry.cost += cost;
      entry.runs += 1;
    }

    // Build by-day for last 30 days
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(now.getDate() - 29);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    const byDayMap = new Map<string, number>();
    for (const run of allRuns) {
      if (!run.createdAt || run.createdAt < thirtyDaysAgo.toISOString()) continue;
      const day = run.createdAt.slice(0, 10);
      byDayMap.set(day, (byDayMap.get(day) || 0) + (Number(run.costUsd) || 0));
    }

    const byDay: { date: string; cost: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      byDay.push({ date: dateStr, cost: byDayMap.get(dateStr) || 0 });
    }

    const byAgent = Array.from(agentCostMap.values()).sort((a, b) => b.cost - a.cost);

    res.json({
      data: {
        totalToday,
        totalThisWeek,
        totalThisMonth,
        byAgent,
        byDay,
      },
    });
  } catch (err: any) {
    console.error('[Costs] GET /summary error:', err);
    res.status(500).json({ error: 'Failed to fetch cost summary' });
  }
});

// ─── GET /api/costs/by-agent ──────────────────────────────────────────────────

router.get('/by-agent', async (req: Request, res: Response) => {
  try {
    const period = (req.query.period as string) || 'month';
    const now = new Date();

    let cutoff: Date;
    if (period === 'day') cutoff = startOfDay(now);
    else if (period === 'week') cutoff = startOfWeek(now);
    else cutoff = startOfMonth(now);

    const cutoffStr = cutoff.toISOString();

    const periodRuns = await db.select({
      agentId: runs.agentId,
      costUsd: runs.costUsd,
      tokensUsed: runs.tokensUsed,
      status: runs.status,
    }).from(runs).where(gte(runs.createdAt, cutoffStr));

    const allAgents = await db.select({ id: agents.id, name: agents.name, type: agents.type }).from(agents);
    const agentMap = new Map<string, { id: string; name: string; type: string }>(allAgents.map((a: { id: string; name: string; type: string }) => [a.id, a]));

    const agentStats = new Map<string, { agentId: string; name: string; type: string; cost: number; runs: number; tokens: number }>();

    for (const run of periodRuns) {
      if (!agentStats.has(run.agentId)) {
        const agentInfo = agentMap.get(run.agentId);
        agentStats.set(run.agentId, {
          agentId: run.agentId,
          name: agentInfo?.name || run.agentId.slice(0, 8),
          type: agentInfo?.type || 'unknown',
          cost: 0,
          runs: 0,
          tokens: 0,
        });
      }
      const entry = agentStats.get(run.agentId)!;
      entry.cost += Number(run.costUsd) || 0;
      entry.runs += 1;
      entry.tokens += Number(run.tokensUsed) || 0;
    }

    const totalCost = Array.from(agentStats.values()).reduce((s, a) => s + a.cost, 0);
    const result = Array.from(agentStats.values())
      .map((a) => ({ ...a, percentOfTotal: totalCost > 0 ? (a.cost / totalCost) * 100 : 0 }))
      .sort((a, b) => b.cost - a.cost);

    res.json({ data: result, total: result.length, period });
  } catch (err: any) {
    console.error('[Costs] GET /by-agent error:', err);
    res.status(500).json({ error: 'Failed to fetch costs by agent' });
  }
});

// ─── GET /api/costs/by-organization ──────────────────────────────────────────

router.get('/by-organization', async (req: Request, res: Response) => {
  try {
    const orgId = req.query.organizationId as string | undefined;

    const allAgents = await db.select().from(agents);
    const allOrgs = await db.select().from(organizations);
    const allRuns = await db.select({ agentId: runs.agentId, costUsd: runs.costUsd, tokensUsed: runs.tokensUsed }).from(runs);

    const orgMap = new Map<string, typeof allOrgs[number]>(allOrgs.map((o: typeof allOrgs[number]) => [o.id, o]));
    const agentToOrg = new Map<string, string>(allAgents.filter((a: typeof allAgents[number]) => a.organizationId).map((a: typeof allAgents[number]) => [a.id, a.organizationId!]));

    const orgCostMap = new Map<string, { orgId: string; name: string; cost: number; agents: number }>();

    for (const run of allRuns) {
      const oId = agentToOrg.get(run.agentId);
      if (!oId) continue;
      if (orgId && oId !== orgId) continue;

      if (!orgCostMap.has(oId)) {
        const org = orgMap.get(oId);
        orgCostMap.set(oId, {
          orgId: oId,
          name: org?.name || oId,
          cost: 0,
          agents: new Set(allAgents.filter((a: typeof allAgents[number]) => a.organizationId === oId).map((a: typeof allAgents[number]) => a.id)).size,
        });
      }
      orgCostMap.get(oId)!.cost += Number(run.costUsd) || 0;
    }

    const result = Array.from(orgCostMap.values()).sort((a, b) => b.cost - a.cost);
    res.json({ data: result, total: result.length });
  } catch (err: any) {
    console.error('[Costs] GET /by-organization error:', err);
    res.status(500).json({ error: 'Failed to fetch costs by organization' });
  }
});

// ─── GET /api/costs/timeline ──────────────────────────────────────────────────

router.get('/timeline', async (req: Request, res: Response) => {
  try {
    const agentId = req.query.agentId as string | undefined;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    const now = new Date();
    const defaultFrom = new Date(now);
    defaultFrom.setDate(now.getDate() - 29);
    defaultFrom.setHours(0, 0, 0, 0);

    const fromDate = from || defaultFrom.toISOString();
    const toDate = to || now.toISOString();

    let query = db.select({
      agentId: runs.agentId,
      costUsd: runs.costUsd,
      createdAt: runs.createdAt,
    }).from(runs).where(and(gte(runs.createdAt, fromDate), lte(runs.createdAt, toDate)));

    const timelineRuns = agentId
      ? await db.select({
          agentId: runs.agentId,
          costUsd: runs.costUsd,
          createdAt: runs.createdAt,
        }).from(runs).where(and(
          gte(runs.createdAt, fromDate),
          lte(runs.createdAt, toDate),
          eq(runs.agentId, agentId)
        ))
      : await query;

    // Group by day
    const dayMap = new Map<string, number>();
    for (const run of timelineRuns) {
      if (!run.createdAt) continue;
      const day = run.createdAt.slice(0, 10);
      dayMap.set(day, (dayMap.get(day) || 0) + (Number(run.costUsd) || 0));
    }

    // Build complete date range
    const start = new Date(fromDate);
    const end = new Date(toDate);
    const result: { date: string; cost: number }[] = [];

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().slice(0, 10);
      result.push({ date: dateStr, cost: dayMap.get(dateStr) || 0 });
    }

    res.json({ data: result, total: result.length });
  } catch (err: any) {
    console.error('[Costs] GET /timeline error:', err);
    res.status(500).json({ error: 'Failed to fetch cost timeline' });
  }
});

// ─── GET /api/costs/projections ───────────────────────────────────────────────

router.get('/projections', async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(now.getDate() - 30);
    const cutoffStr = thirtyDaysAgo.toISOString();

    const recentRuns = await db.select({
      agentId: runs.agentId,
      costUsd: runs.costUsd,
    }).from(runs).where(gte(runs.createdAt, cutoffStr));

    const allAgents = await db.select({ id: agents.id, name: agents.name }).from(agents);
    const agentMap = new Map<string, { id: string; name: string }>(allAgents.map((a: { id: string; name: string }) => [a.id, a]));

    const agentCostMap = new Map<string, { agentId: string; name: string; last30DayCost: number }>();

    for (const run of recentRuns) {
      if (!agentCostMap.has(run.agentId)) {
        const agentInfo = agentMap.get(run.agentId);
        agentCostMap.set(run.agentId, {
          agentId: run.agentId,
          name: agentInfo?.name || run.agentId.slice(0, 8),
          last30DayCost: 0,
        });
      }
      agentCostMap.get(run.agentId)!.last30DayCost += Number(run.costUsd) || 0;
    }

    const daysInMonth = 30;
    const daysElapsed = Math.max(1, Math.ceil((now.getTime() - thirtyDaysAgo.getTime()) / 86400000));

    const projections = Array.from(agentCostMap.values()).map((a) => ({
      agentId: a.agentId,
      name: a.name,
      last30DayCost: a.last30DayCost,
      projectedNextMonthCost: (a.last30DayCost / daysElapsed) * daysInMonth,
    })).sort((a, b) => b.projectedNextMonthCost - a.projectedNextMonthCost);

    const totalProjected = projections.reduce((s, a) => s + a.projectedNextMonthCost, 0);

    res.json({ data: projections, totalProjectedNextMonth: totalProjected });
  } catch (err: any) {
    console.error('[Costs] GET /projections error:', err);
    res.status(500).json({ error: 'Failed to fetch cost projections' });
  }
});

export default router;
