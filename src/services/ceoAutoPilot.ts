/**
 * CEO Auto-Pilot — periodic autonomous CEO execution.
 *
 * When enabled, the CEO agent runs on a configurable interval to:
 * 1. Review active goals and their progress
 * 2. Execute ready plan steps (if auto-execute is on)
 * 3. Propose new goals, strategies, or team changes
 * 4. Start workflows when appropriate
 *
 * The CEO sees org context, goal progress, and recent run history.
 */

import { db } from '../db';
import { agents, organizations, goals, planSteps, runs, proposals } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { getSetting } from '../routes/settings';
import { executeAgent } from './executor';
import { executeReadySteps } from './stepExecutor';

let autopilotTimer: ReturnType<typeof setInterval> | null = null;
let currentIntervalMs = 0;

// ─── Build CEO context ───────────────────────────────────────────────────────

async function buildCeoContext(orgId: string, ceoAgent: any): Promise<string> {
  // Get org info
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  if (!org) return '';

  // Get all agents in org
  const orgAgents = await db.select().from(agents).where(eq(agents.organizationId, orgId));

  // Get active goals with steps
  const activeGoals = await db.select().from(goals)
    .where(and(eq(goals.organizationId, orgId)))
    .orderBy(desc(goals.updatedAt));

  const goalSummaries: string[] = [];
  for (const goal of activeGoals.slice(0, 10)) {
    const steps = await db.select().from(planSteps).where(eq(planSteps.goalId, goal.id));
    const readyCount = steps.filter((s: any) => s.status === 'ready').length;
    const completedCount = steps.filter((s: any) => s.status === 'completed' || s.status === 'verified').length;
    const failedCount = steps.filter((s: any) => s.status === 'failed').length;
    goalSummaries.push(
      `- "${goal.title}" [${goal.status}] — ${goal.progress}% done, ${completedCount}/${steps.length} steps completed` +
      (readyCount > 0 ? `, ${readyCount} ready to execute` : '') +
      (failedCount > 0 ? `, ${failedCount} FAILED` : '') +
      (goal.priority === 'critical' || goal.priority === 'high' ? ` [${goal.priority} priority]` : '')
    );
  }

  // Get recent runs (last 24h)
  const oneDayAgo = new Date(Date.now() - 86400000).toISOString();
  const recentRuns = await db.select().from(runs)
    .where(eq(runs.status, 'success'))
    .orderBy(desc(runs.createdAt));
  const runsSince = recentRuns.filter((r: any) => r.createdAt && r.createdAt > oneDayAgo);

  // Get pending proposals
  const pendingProposals = await db.select().from(proposals)
    .where(and(eq(proposals.organizationId, orgId), eq(proposals.status, 'pending')));

  // Get approved proposals (recent)
  const approvedProposals = await db.select().from(proposals)
    .where(and(eq(proposals.organizationId, orgId), eq(proposals.status, 'approved')))
    .orderBy(desc(proposals.resolvedAt));

  const orgGoalsStr = Array.isArray(org.goals)
    ? (org.goals as string[]).map(g => `- ${g}`).join('\n')
    : '- No org goals defined';

  return `# CEO Briefing — ${org.name}

## Organization
- Industry: ${org.industry || 'General'}
- Team: ${orgAgents.length} agents (${orgAgents.filter((a: any) => a.status === 'active').length} active)
- Launch State: ${org.launchState}

## Organization Goals
${orgGoalsStr}

## Team
${orgAgents.map((a: any) => `- ${a.name} (${a.role}, ${a.type}) — ${a.status}`).join('\n')}

## Active Goals
${goalSummaries.length > 0 ? goalSummaries.join('\n') : 'No active goals.'}

## Activity (last 24h)
- ${runsSince.length} successful runs
- Total cost: $${runsSince.reduce((sum: number, r: any) => sum + (typeof r.costUsd === 'number' ? r.costUsd : 0), 0).toFixed(4)}

## Pending Proposals (${pendingProposals.length})
${pendingProposals.slice(0, 5).map((p: any) => `- [${p.type}] "${p.title}" — awaiting user decision`).join('\n') || 'None'}

## Recently Approved (${approvedProposals.length})
${approvedProposals.slice(0, 3).map((p: any) => `- [${p.type}] "${p.title}" ✅`).join('\n') || 'None'}

---

YOUR TASK: As CEO, review the current state and decide what to do next.

You can:
1. Assess goal progress — are things on track?
2. Identify blockers — any failed steps that need attention?
3. Propose new actions using <proposal> blocks

PROPOSAL FORMAT (wrap in <proposal> tags, one per proposal):
<proposal>
{
  "type": "hire_agent|restructure|budget_increase|strategy",
  "title": "Short title",
  "reasoning": "Why this is needed",
  "details": { ... any relevant details ... },
  "estimatedMonthlyCostUsd": 0
}
</proposal>

Be strategic. Don't propose things already pending. Focus on what will move goals forward.
If everything is on track, just provide a brief status summary — no proposals needed.`;
}

// ─── Run CEO cycle ───────────────────────────────────────────────────────────

async function runCeoCycle(): Promise<void> {
  console.log('[CEO AutoPilot] Starting cycle...');

  try {
    // Check if autopilot is still enabled
    const enabled = await getSetting('autonomy_ceo_autopilot');
    if (enabled !== 'on') {
      console.log('[CEO AutoPilot] Disabled, skipping.');
      return;
    }

    // Find all orgs with a CEO agent
    const allOrgs = await db.select().from(organizations);

    for (const org of allOrgs) {
      if (org.launchState !== 'launched') continue;

      // Find CEO for this org
      const [ceo] = await db.select().from(agents)
        .where(and(eq(agents.organizationId, org.id), eq(agents.role, 'ceo'), eq(agents.status, 'active')));

      if (!ceo) continue;

      console.log(`[CEO AutoPilot] Running CEO "${ceo.name}" for org "${org.name}"`);

      // 1. Auto-execute ready goal steps if enabled
      const autoExec = await getSetting('autonomy_auto_execute_goals');
      if (autoExec === 'on') {
        const activeGoalsList = await db.select().from(goals)
          .where(and(eq(goals.organizationId, org.id), eq(goals.status, 'active')));
        const inProgressGoals = await db.select().from(goals)
          .where(and(eq(goals.organizationId, org.id), eq(goals.status, 'in_progress')));

        for (const goal of [...activeGoalsList, ...inProgressGoals]) {
          try {
            const results = await executeReadySteps(goal.id, { triggeredBy: 'api' });
            if (results.length > 0) {
              console.log(`[CEO AutoPilot] Executed ${results.length} steps for goal "${goal.title}"`);
            }
          } catch (err: any) {
            console.error(`[CEO AutoPilot] Step execution error for goal "${goal.title}":`, err.message);
          }
        }
      }

      // 2. Run CEO agent with full context
      try {
        const context = await buildCeoContext(org.id, ceo);
        const result = await executeAgent(ceo.id, context, 'api');

        if (result.success) {
          console.log(`[CEO AutoPilot] CEO "${ceo.name}" completed — cost: $${result.costUsd.toFixed(4)}`);
          // Proposals are auto-parsed by parseCeoProposals in executor.ts
        } else {
          console.error(`[CEO AutoPilot] CEO run failed: ${result.error}`);
        }
      } catch (err: any) {
        console.error(`[CEO AutoPilot] CEO execution error:`, err.message);
      }
    }

    console.log('[CEO AutoPilot] Cycle complete.');
  } catch (err: any) {
    console.error('[CEO AutoPilot] Cycle error:', err.message);
  }
}

// ─── Start/stop/restart ──────────────────────────────────────────────────────

export async function startCeoAutoPilot(): Promise<void> {
  const enabled = await getSetting('autonomy_ceo_autopilot');
  if (enabled !== 'on') {
    console.log('[CEO AutoPilot] Disabled — not starting.');
    return;
  }

  const intervalStr = await getSetting('autonomy_ceo_interval_minutes') || '60';
  const intervalMs = Math.max(5, parseInt(intervalStr)) * 60 * 1000; // min 5 minutes

  if (autopilotTimer) clearInterval(autopilotTimer);
  currentIntervalMs = intervalMs;

  console.log(`[CEO AutoPilot] Started — running every ${Math.round(intervalMs / 60000)} minutes`);
  autopilotTimer = setInterval(runCeoCycle, intervalMs);

  // Run first cycle after a short delay (let server finish startup)
  setTimeout(runCeoCycle, 10000);
}

export async function stopCeoAutoPilot(): Promise<void> {
  if (autopilotTimer) {
    clearInterval(autopilotTimer);
    autopilotTimer = null;
    currentIntervalMs = 0;
    console.log('[CEO AutoPilot] Stopped.');
  }
}

export async function restartCeoAutoPilot(): Promise<void> {
  await stopCeoAutoPilot();
  await startCeoAutoPilot();
}

export function getCeoAutoPilotStatus(): { running: boolean; intervalMs: number } {
  return { running: autopilotTimer !== null, intervalMs: currentIntervalMs };
}

// Manual trigger
export async function triggerCeoCycle(): Promise<void> {
  await runCeoCycle();
}
