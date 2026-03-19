import { db } from '../db';
import { budgets } from '../db/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export interface BudgetCheckResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  currentSpend: number;
}

function getPeriodEndDate(periodStart: string | Date, period: 'daily' | 'weekly' | 'monthly'): Date {
  const end = new Date(periodStart);
  switch (period) {
    case 'daily':
      end.setDate(end.getDate() + 1);
      break;
    case 'weekly':
      end.setDate(end.getDate() + 7);
      break;
    case 'monthly':
      end.setMonth(end.getMonth() + 1);
      break;
  }
  return end;
}

export async function checkBudget(agentId: string): Promise<BudgetCheckResult> {
  const [budget] = await db.select().from(budgets).where(eq(budgets.agentId, agentId));

  if (!budget) {
    // No budget set - allow unlimited
    return { allowed: true, remaining: Infinity, limit: Infinity, currentSpend: 0 };
  }

  const limit = budget.limitUsd as number;
  const currentSpend = budget.currentSpend as number;
  const remaining = Math.max(0, limit - currentSpend);

  // Check if period has expired and needs reset
  const periodEnd = getPeriodEndDate(budget.periodStart!, budget.period as 'daily' | 'weekly' | 'monthly');
  if (new Date() > periodEnd) {
    await resetBudget(agentId);
    return { allowed: true, remaining: limit, limit, currentSpend: 0 };
  }

  return {
    allowed: currentSpend < limit,
    remaining,
    limit,
    currentSpend,
  };
}

export async function recordSpend(agentId: string, costUsd: number): Promise<void> {
  if (costUsd <= 0) return;

  const [budget] = await db.select().from(budgets).where(eq(budgets.agentId, agentId));

  if (!budget) return;

  const currentSpend = budget.currentSpend as number;
  const newSpend = currentSpend + costUsd;

  await db
    .update(budgets)
    .set({
      currentSpend: newSpend,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(budgets.agentId, agentId));
}

export async function resetBudget(agentId: string): Promise<void> {
  await db
    .update(budgets)
    .set({
      currentSpend: 0,
      periodStart: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(budgets.agentId, agentId));
}

export async function resetExpiredBudgets(): Promise<void> {
  const allBudgets = await db.select().from(budgets);

  for (const budget of allBudgets) {
    const periodEnd = getPeriodEndDate(budget.periodStart!, budget.period as 'daily' | 'weekly' | 'monthly');
    if (new Date() > periodEnd) {
      await resetBudget(budget.agentId);
      console.log(`[Budget] Reset expired budget for agent ${budget.agentId} (period: ${budget.period})`);
    }
  }
}

export async function createOrUpdateBudget(
  agentId: string,
  period: 'daily' | 'weekly' | 'monthly',
  limitUsd: number
): Promise<void> {
  const [existing] = await db.select().from(budgets).where(eq(budgets.agentId, agentId));

  if (existing) {
    await db
      .update(budgets)
      .set({
        period,
        limitUsd,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(budgets.agentId, agentId));
  } else {
    await db.insert(budgets).values({
      id: uuidv4(),
      agentId,
      period,
      limitUsd,
      currentSpend: 0,
      periodStart: new Date().toISOString(),
    });
  }
}
