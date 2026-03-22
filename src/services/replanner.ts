/**
 * Replanner — when a goal's step fails after max retries,
 * this service generates an alternative plan while preserving constraints.
 *
 * Flow:
 * 1. Step fails permanently → stepExecutor calls tryReplan()
 * 2. Replanner checks if goal allows replanning (replanCount < maxReplans)
 * 3. Builds context: goal, completed steps, failed step + error
 * 4. Calls an internal/CEO agent to propose a new plan
 * 5. Parses the new steps, marks old failed/pending steps as 'skipped'
 * 6. Inserts new steps, resets goal to in_progress
 */

import { db } from '../db';
import { goals, planSteps, agents } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { executeAgent } from './executor';

export interface ReplanResult {
  success: boolean;
  goalId: string;
  replanCount: number;
  newStepCount: number;
  reason?: string;
  error?: string;
}

/**
 * Attempt to replan a goal after a step has permanently failed.
 */
export async function tryReplan(
  goalId: string,
  failedStepId: string,
  failureReason: string
): Promise<ReplanResult> {
  const now = new Date().toISOString();

  // 1. Load goal
  const [goal] = await db.select().from(goals).where(eq(goals.id, goalId));
  if (!goal) return { success: false, goalId, replanCount: 0, newStepCount: 0, error: 'Goal not found' };

  // 2. Check replan budget
  const replanCount = (goal.replanCount || 0) + 1;
  const maxReplans = goal.maxReplans || 2;
  if (replanCount > maxReplans) {
    // No more replans allowed — mark goal as blocked
    await db.update(goals).set({ status: 'blocked', updatedAt: now }).where(eq(goals.id, goalId));
    return { success: false, goalId, replanCount: replanCount - 1, newStepCount: 0, error: `Max replans (${maxReplans}) exhausted` };
  }

  // 3. Load all steps for context
  const allSteps = await db.select().from(planSteps).where(eq(planSteps.goalId, goalId));
  const completedSteps = allSteps.filter((s: any) => s.status === 'completed' || s.status === 'verified');
  const failedStep = allSteps.find((s: any) => s.id === failedStepId);
  const pendingSteps = allSteps.filter((s: any) => s.status === 'pending' || s.status === 'ready' || s.status === 'blocked');

  // 4. Find a suitable agent for replanning (CEO > manager > any org agent)
  let plannerAgentId: string | null = null;

  if (goal.organizationId) {
    const orgAgents = await db.select().from(agents).where(
      and(eq(agents.organizationId, goal.organizationId), eq(agents.status, 'active'))
    );
    const ceo = orgAgents.find((a: any) => a.role === 'ceo');
    const manager = orgAgents.find((a: any) => a.role === 'manager');
    plannerAgentId = ceo?.id || manager?.id || orgAgents[0]?.id || null;
  }

  if (!plannerAgentId && goal.agentId) {
    plannerAgentId = goal.agentId;
  }

  if (!plannerAgentId) {
    // No agent available — can't replan
    await db.update(goals).set({ status: 'blocked', replanReason: 'No agent available for replanning', updatedAt: now }).where(eq(goals.id, goalId));
    return { success: false, goalId, replanCount, newStepCount: 0, error: 'No agent available for replanning' };
  }

  // 5. Build replanning prompt
  const constraintsStr = Array.isArray(goal.constraints)
    ? (goal.constraints as string[]).map((c: string) => `- ${c}`).join('\n')
    : 'None';
  const successStr = Array.isArray(goal.successCriteria)
    ? (goal.successCriteria as string[]).map((c: string) => `- ${c}`).join('\n')
    : 'None';
  const completedStr = completedSteps.length > 0
    ? completedSteps.map((s: any) => {
        const outSnippet = s.output ? (typeof s.output === 'string' ? s.output : JSON.stringify(s.output)).substring(0, 500) : 'N/A';
        return `- ✅ "${s.title}" (${s.type}) — output: ${outSnippet}`;
      }).join('\n')
    : 'None yet';
  const failedStr = failedStep
    ? `"${failedStep.title}" (${failedStep.type}) — Error: ${failureReason}`
    : `Unknown step — Error: ${failureReason}`;

  const prompt = `You are replanning a goal after a step failed. This is replan attempt ${replanCount}/${maxReplans}.

## Goal
Title: ${goal.title}
Description: ${goal.description || 'N/A'}
Priority: ${goal.priority}

## Success Criteria
${successStr}

## Constraints (MUST be preserved)
${constraintsStr}

## Already Completed Steps (DO NOT redo these)
${completedStr}

## Failed Step
${failedStr}

## Remaining Steps That Were Planned
${pendingSteps.map((s: any) => `- "${s.title}" (${s.type})`).join('\n') || 'None'}

---

Create a NEW plan to achieve the goal, working around the failure. You MUST:
1. Preserve all constraints
2. Not repeat already-completed work
3. Address why the previous step failed (alternative approach)
4. Return the plan as a JSON array

Respond with ONLY a JSON array of step objects:
[
  {
    "title": "Step title",
    "description": "What to do",
    "type": "research|reasoning|generation|validation|approval|action",
    "order": 1,
    "dependsOn": []
  }
]`;

  // 6. Execute the planner agent
  let result;
  try {
    result = await executeAgent(plannerAgentId, prompt, 'api');
  } catch (err: any) {
    return { success: false, goalId, replanCount, newStepCount: 0, error: `Planner agent failed: ${err.message}` };
  }

  if (!result.success) {
    return { success: false, goalId, replanCount, newStepCount: 0, error: `Planner agent returned failure: ${result.error}` };
  }

  // 7. Parse new steps from output
  let newSteps: Array<{ title: string; description?: string; type?: string; order?: number; dependsOn?: string[] }> = [];
  try {
    const outputStr = typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
    // Extract JSON array from output (may be wrapped in markdown code blocks)
    const jsonMatch = outputStr.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      newSteps = JSON.parse(jsonMatch[0]);
    }
  } catch {
    return { success: false, goalId, replanCount, newStepCount: 0, error: 'Failed to parse new plan from agent output' };
  }

  if (newSteps.length === 0) {
    return { success: false, goalId, replanCount, newStepCount: 0, error: 'Agent returned empty plan' };
  }

  // 8. Skip old pending/failed steps
  for (const step of allSteps) {
    if (step.status === 'pending' || step.status === 'ready' || step.status === 'blocked') {
      await db.update(planSteps).set({ status: 'skipped', updatedAt: now }).where(eq(planSteps.id, step.id));
    }
  }

  // 9. Insert new steps
  const maxOrder = Math.max(...allSteps.map((s: any) => s.order || 0), 0);
  const newStepIds: string[] = [];

  for (let i = 0; i < newSteps.length; i++) {
    const ns = newSteps[i];
    const stepId = crypto.randomUUID();
    newStepIds.push(stepId);

    await db.insert(planSteps).values({
      id: stepId,
      goalId,
      title: ns.title,
      description: ns.description || ns.title,
      type: ns.type || 'action',
      order: maxOrder + i + 1,
      status: i === 0 ? 'ready' : 'pending', // first new step is ready
      dependsOn: ns.dependsOn || (i > 0 ? [newStepIds[i - 1]] : []),
      retries: 0,
      maxRetries: 3,
      createdAt: now,
      updatedAt: now,
    });
  }

  // 10. Update goal
  await db.update(goals).set({
    replanCount,
    replanReason: `Step "${failedStep?.title || failedStepId}" failed: ${failureReason}`,
    status: 'in_progress',
    updatedAt: now,
  }).where(eq(goals.id, goalId));

  return {
    success: true,
    goalId,
    replanCount,
    newStepCount: newSteps.length,
    reason: `Replanned after "${failedStep?.title}" failed. ${newSteps.length} new steps created.`,
  };
}
