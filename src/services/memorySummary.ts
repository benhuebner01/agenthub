/**
 * Memory Summary Service — generates concise summaries of completed work.
 *
 * Instead of dumping all step outputs into context (which overflows quickly),
 * this service creates condensed summaries stored on goals and in shared memory.
 *
 * Used by:
 * - stepExecutor: after step completion, update goal summary
 * - ceoAutoPilot: include summaries in CEO briefing instead of raw outputs
 * - executor: inject recent summaries into agent context
 */

import { db } from '../db';
import { goals, planSteps, sharedMemory, agents, runs } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { executeAgent } from './executor';

/**
 * Generate/update the summary for a goal based on completed steps.
 * Called after each step completes successfully.
 */
export async function updateGoalSummary(goalId: string): Promise<string | null> {
  const now = new Date().toISOString();

  const [goal] = await db.select().from(goals).where(eq(goals.id, goalId));
  if (!goal) return null;

  const steps = await db.select().from(planSteps).where(eq(planSteps.goalId, goalId));
  const completedSteps = steps.filter((s: any) =>
    s.status === 'completed' || s.status === 'verified'
  );

  if (completedSteps.length === 0) return null;

  // For small goals (≤3 completed steps), build a simple mechanical summary
  // For larger goals, use an LLM to compress
  if (completedSteps.length <= 3) {
    const lines = completedSteps.map((s: any) => {
      const outSnippet = s.output
        ? (typeof s.output === 'string' ? s.output : JSON.stringify(s.output)).substring(0, 300)
        : 'done';
      return `✅ ${s.title}: ${outSnippet}`;
    });
    const summary = lines.join('\n');

    await db.update(goals).set({ summary, updatedAt: now }).where(eq(goals.id, goalId));
    return summary;
  }

  // For larger goals — try LLM-based summarization
  const summary = await generateLlmSummary(goal, completedSteps);
  if (summary) {
    await db.update(goals).set({ summary, updatedAt: now }).where(eq(goals.id, goalId));
  }
  return summary;
}

/**
 * Use an available agent to generate a compressed summary.
 * Falls back to mechanical summary if no agent is available.
 */
async function generateLlmSummary(goal: any, completedSteps: any[]): Promise<string> {
  // Find a suitable summarizer agent (prefer internal, then any org agent)
  let summarizerAgentId: string | null = null;

  if (goal.organizationId) {
    const orgAgents = await db.select().from(agents).where(
      and(eq(agents.organizationId, goal.organizationId), eq(agents.status, 'active'))
    );
    // Prefer internal agent (cheapest), then any
    const internal = orgAgents.find((a: any) => a.type === 'internal');
    summarizerAgentId = internal?.id || orgAgents[0]?.id || null;
  }

  if (!summarizerAgentId && goal.agentId) {
    summarizerAgentId = goal.agentId;
  }

  if (!summarizerAgentId) {
    // Fallback: mechanical summary
    return completedSteps.map((s: any) => {
      const out = s.output
        ? (typeof s.output === 'string' ? s.output : JSON.stringify(s.output)).substring(0, 200)
        : 'done';
      return `✅ ${s.title}: ${out}`;
    }).join('\n');
  }

  // Build summarization prompt
  const stepsText = completedSteps.map((s: any, i: number) => {
    const out = s.output
      ? (typeof s.output === 'string' ? s.output : JSON.stringify(s.output)).substring(0, 1500)
      : 'completed';
    return `Step ${i + 1}: "${s.title}" (${s.type})\nOutput: ${out}`;
  }).join('\n\n');

  const prompt = `Summarize the following completed work for goal "${goal.title}" in 2-5 concise bullet points.
Focus on: key findings, decisions made, outputs produced, and current state.
Be brief but preserve critical information that subsequent steps would need.

${stepsText}

Respond with ONLY the bullet-point summary, no extra text.`;

  try {
    const result = await executeAgent(summarizerAgentId, prompt, 'api');
    if (result.success && result.output) {
      return typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
    }
  } catch {
    // LLM summary failed — fall back to mechanical
  }

  // Fallback
  return completedSteps.map((s: any) => {
    const out = s.output
      ? (typeof s.output === 'string' ? s.output : JSON.stringify(s.output)).substring(0, 200)
      : 'done';
    return `✅ ${s.title}: ${out}`;
  }).join('\n');
}

/**
 * Store a goal's summary into shared org memory so all agents can access it.
 */
export async function persistSummaryToSharedMemory(goalId: string): Promise<void> {
  const [goal] = await db.select().from(goals).where(eq(goals.id, goalId));
  if (!goal || !goal.summary || !goal.organizationId) return;

  const now = new Date().toISOString();
  const key = `goal_summary:${goalId}`;
  const value = `[${goal.status}] ${goal.title}\n${goal.summary}`;

  // Upsert into shared memory
  const existing = await db.select().from(sharedMemory).where(
    and(eq(sharedMemory.organizationId, goal.organizationId), eq(sharedMemory.key, key))
  );

  if (existing.length > 0) {
    await db.update(sharedMemory).set({ value, updatedAt: now }).where(eq(sharedMemory.id, existing[0].id));
  } else {
    await db.insert(sharedMemory).values({
      organizationId: goal.organizationId,
      key,
      value,
      updatedAt: now,
    });
  }
}

/**
 * Build a condensed memory context for an agent, including:
 * - Active goal summaries from the org
 * - Recent run summaries (last N runs for this agent)
 */
export async function buildMemorySummaryContext(
  agentId: string,
  organizationId?: string | null
): Promise<string> {
  const parts: string[] = [];

  // 1. Active goal summaries from org
  if (organizationId) {
    const activeGoals = await db.select().from(goals)
      .where(eq(goals.organizationId, organizationId))
      .orderBy(desc(goals.updatedAt));

    const goalSummaries = activeGoals
      .filter((g: any) => g.summary && (g.status === 'active' || g.status === 'in_progress'))
      .slice(0, 5)
      .map((g: any) => `### ${g.title} [${g.progress}%]\n${g.summary}`);

    if (goalSummaries.length > 0) {
      parts.push('## Active Goal Summaries\n' + goalSummaries.join('\n\n'));
    }
  }

  // 2. Recent run summaries for this agent (last 5)
  const recentRuns = await db.select().from(runs)
    .where(and(eq(runs.agentId, agentId), eq(runs.status, 'success')))
    .orderBy(desc(runs.createdAt));

  const last5 = recentRuns.slice(0, 5);
  if (last5.length > 0) {
    const runSummaries = last5.map((r: any) => {
      const out = r.output
        ? (typeof r.output === 'string' ? r.output : JSON.stringify(r.output)).substring(0, 200)
        : 'completed';
      return `- [${r.createdAt?.substring(0, 16)}] ${out}`;
    });
    parts.push('## Your Recent Work\n' + runSummaries.join('\n'));
  }

  if (parts.length === 0) return '';
  return '\n\n' + parts.join('\n\n');
}
