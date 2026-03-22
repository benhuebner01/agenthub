/**
 * Step Executor — the Decide → Check → Execute → Verify → Commit loop.
 *
 * Takes a plan step that is "ready", runs the assigned agent,
 * stores the result, runs verification, and advances the goal.
 */

import { db } from '../db';
import { planSteps, goals, agents } from '../db/schema';
import { eq, and, asc } from 'drizzle-orm';
import { executeAgent } from './executor';
import { verifyStepOutput, requestHumanApproval } from './verification';
import { checkToolPermission } from './toolGovernance';
import { getSetting } from '../routes/settings';

async function isApprovalGateOff(): Promise<boolean> {
  const val = await getSetting('autonomy_approval_gates');
  return val === 'off';
}

export interface StepExecutionResult {
  stepId: string;
  status: 'completed' | 'verified' | 'failed' | 'blocked' | 'retry' | 'awaiting_approval' | 'skipped';
  runId?: string;
  output?: unknown;
  error?: string;
  attempt?: number;
  verificationPassed?: boolean;
}

// ─── Tool class mapping per agent type ───────────────────────────────────────

const AGENT_TYPE_TOOL_CLASS: Record<string, string> = {
  claude: 'generation',
  openai: 'generation',
  http: 'api_call',
  bash: 'code_exec',
  'claude-code': 'code_exec',
  'openai-codex': 'code_exec',
  cursor: 'code_exec',
  openclaw: 'code_exec',
  a2a: 'api_call',
  mcp: 'api_call',
  internal: 'generation',
};

// ─── Execute a single plan step ──────────────────────────────────────────────

export async function executeStep(
  stepId: string,
  options?: { triggeredBy?: 'manual' | 'api' | 'schedule' | 'workflow' }
): Promise<StepExecutionResult> {
  const now = new Date().toISOString();
  const triggeredBy = options?.triggeredBy || 'api';

  // 1. Load step
  const [step] = await db.select().from(planSteps).where(eq(planSteps.id, stepId));
  if (!step) throw new Error(`Step ${stepId} not found`);

  // Only execute steps that are ready
  if (step.status !== 'ready') {
    return { stepId, status: step.status as StepExecutionResult['status'], error: `Step is '${step.status}', not 'ready'` };
  }

  // 2. Check agent assignment
  if (!step.assignedAgentId) {
    await db.update(planSteps).set({ status: 'blocked', updatedAt: now }).where(eq(planSteps.id, stepId));
    return { stepId, status: 'blocked', error: 'No agent assigned to this step' };
  }

  const [agent] = await db.select().from(agents).where(eq(agents.id, step.assignedAgentId));
  if (!agent) {
    await db.update(planSteps).set({ status: 'blocked', updatedAt: now }).where(eq(planSteps.id, stepId));
    return { stepId, status: 'blocked', error: `Assigned agent ${step.assignedAgentId} not found` };
  }

  // 3. Verify dependencies are met
  const deps = (step.dependsOn as string[]) || [];
  if (deps.length > 0) {
    const siblingSteps = await db.select().from(planSteps).where(eq(planSteps.goalId, step.goalId));
    const completedIds = new Set(
      siblingSteps
        .filter(s => s.status === 'completed' || s.status === 'verified')
        .map(s => s.id)
    );
    const unmetDeps = deps.filter(d => !completedIds.has(d));
    if (unmetDeps.length > 0) {
      await db.update(planSteps).set({ status: 'blocked', updatedAt: now }).where(eq(planSteps.id, stepId));
      return { stepId, status: 'blocked', error: `Unmet dependencies: ${unmetDeps.join(', ')}` };
    }
  }

  // 4. Tool governance pre-check
  const toolClass = AGENT_TYPE_TOOL_CLASS[agent.type] || 'generation';
  const policyCheck = await checkToolPermission({
    agentId: agent.id,
    toolName: toolClass,
    organizationId: agent.organizationId || undefined,
  });

  if (!policyCheck.allowed) {
    await db.update(planSteps).set({ status: 'blocked', updatedAt: now }).where(eq(planSteps.id, stepId));
    return { stepId, status: 'blocked', error: `Policy denied: ${policyCheck.reason}` };
  }

  if (policyCheck.approvalRequired && !(await isApprovalGateOff())) {
    const approval = await requestHumanApproval(stepId, {
      action: `Execute step "${step.title}" using agent "${agent.name}"`,
      agentType: agent.type,
      toolClass,
    }, { agentId: agent.id });
    await db.update(planSteps).set({ status: 'blocked', updatedAt: now }).where(eq(planSteps.id, stepId));
    return { stepId, status: 'awaiting_approval', error: `Approval required (verification ${approval.id})` };
  }

  // 5. Build step input — merge step description + dependency outputs
  const inputParts: string[] = [];

  // The step description is the primary instruction
  inputParts.push(`## Task\n${step.description || step.title}`);

  // Add dependency outputs as context
  if (deps.length > 0) {
    const depSteps = await db.select().from(planSteps).where(eq(planSteps.goalId, step.goalId));
    const depOutputs = depSteps.filter(s => deps.includes(s.id) && s.output);
    if (depOutputs.length > 0) {
      inputParts.push('\n## Context from previous steps');
      for (const dep of depOutputs) {
        const outputText = typeof dep.output === 'string'
          ? dep.output
          : JSON.stringify(dep.output);
        // Truncate very long outputs to avoid context overflow
        const truncated = outputText.length > 8000 ? outputText.substring(0, 8000) + '\n...(truncated)' : outputText;
        inputParts.push(`\n### ${dep.title}\n${truncated}`);
      }
    }
  }

  // Add step's own input data if any
  if (step.input) {
    inputParts.push(`\n## Additional Input\n${typeof step.input === 'string' ? step.input : JSON.stringify(step.input)}`);
  }

  const builtInput = inputParts.join('\n');

  // 6. Mark step as running
  await db.update(planSteps).set({
    status: 'running',
    startedAt: now,
    updatedAt: now,
  }).where(eq(planSteps.id, stepId));

  // 7. Execute the agent
  let result;
  try {
    result = await executeAgent(step.assignedAgentId, builtInput, triggeredBy as any);
  } catch (err: any) {
    // Execution failed entirely
    const retries = (step.retries || 0) + 1;
    if (retries < (step.maxRetries || 3)) {
      await db.update(planSteps).set({ status: 'ready', retries, updatedAt: new Date().toISOString() }).where(eq(planSteps.id, stepId));
      return { stepId, status: 'retry', error: err.message, attempt: retries };
    }
    await db.update(planSteps).set({
      status: 'failed',
      output: { error: err.message },
      updatedAt: new Date().toISOString(),
    }).where(eq(planSteps.id, stepId));
    return { stepId, status: 'failed', error: err.message };
  }

  // 8. Store output
  await db.update(planSteps).set({
    output: result.output,
    runId: result.runId || null,
    updatedAt: new Date().toISOString(),
  }).where(eq(planSteps.id, stepId));

  // 9. Run verification
  const verificationConfig = step.verification as { checks?: string[] } | null;
  let verificationPassed = true;

  if (verificationConfig?.checks && verificationConfig.checks.length > 0) {
    const verResult = await verifyStepOutput(
      stepId,
      result.output,
      verificationConfig.checks,
      { runId: result.runId, agentId: agent.id }
    );
    verificationPassed = verResult.allPassed;
  }

  if (!result.success) {
    // Agent returned failure
    const retries = (step.retries || 0) + 1;
    if (retries < (step.maxRetries || 3)) {
      await db.update(planSteps).set({ status: 'ready', retries, updatedAt: new Date().toISOString() }).where(eq(planSteps.id, stepId));
      return { stepId, status: 'retry', runId: result.runId, error: result.error, attempt: retries };
    }
    await db.update(planSteps).set({ status: 'failed', updatedAt: new Date().toISOString() }).where(eq(planSteps.id, stepId));
    return { stepId, status: 'failed', runId: result.runId, output: result.output, error: result.error };
  }

  // 10. Handle verification result
  if (verificationPassed) {
    const finalStatus = verificationConfig?.checks ? 'verified' : 'completed';
    await db.update(planSteps).set({
      status: finalStatus,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).where(eq(planSteps.id, stepId));

    // 11. Advance the goal — unlock next steps
    await advanceGoal(step.goalId);

    return { stepId, status: finalStatus as StepExecutionResult['status'], runId: result.runId, output: result.output, verificationPassed: true };
  } else {
    // Verification failed
    const retries = (step.retries || 0) + 1;
    if (retries < (step.maxRetries || 3)) {
      await db.update(planSteps).set({ status: 'ready', retries, updatedAt: new Date().toISOString() }).where(eq(planSteps.id, stepId));
      return { stepId, status: 'retry', runId: result.runId, output: result.output, verificationPassed: false, attempt: retries };
    }
    await db.update(planSteps).set({ status: 'failed', updatedAt: new Date().toISOString() }).where(eq(planSteps.id, stepId));
    return { stepId, status: 'failed', runId: result.runId, output: result.output, verificationPassed: false };
  }
}

// ─── Advance goal: unlock next steps, recalculate progress ───────────────────

async function advanceGoal(goalId: string): Promise<void> {
  const now = new Date().toISOString();
  const steps = await db.select().from(planSteps).where(eq(planSteps.goalId, goalId));

  const completedIds = new Set(
    steps.filter(s => s.status === 'completed' || s.status === 'verified').map(s => s.id)
  );

  // Unlock pending steps whose dependencies are now met
  for (const step of steps) {
    if (step.status !== 'pending') continue;
    const deps = (step.dependsOn as string[]) || [];
    const allDepsMet = deps.length === 0 || deps.every(d => completedIds.has(d));
    if (allDepsMet) {
      await db.update(planSteps).set({ status: 'ready', updatedAt: now }).where(eq(planSteps.id, step.id));
    }
  }

  // Recalculate goal progress
  const totalSteps = steps.length;
  const doneSteps = steps.filter(s =>
    s.status === 'completed' || s.status === 'verified' || s.status === 'skipped'
  ).length + 1; // +1 for the step we just completed
  const progress = totalSteps > 0 ? Math.min(100, Math.round((doneSteps / totalSteps) * 100)) : 0;

  const goalStatus = progress >= 100 ? 'achieved' : 'in_progress';
  await db.update(goals).set({
    progress,
    status: goalStatus,
    updatedAt: now,
    ...(goalStatus === 'achieved' ? { completedAt: now } : {}),
  }).where(eq(goals.id, goalId));
}

// ─── Execute all ready steps for a goal ──────────────────────────────────────

export async function executeReadySteps(
  goalId: string,
  options?: { triggeredBy?: 'manual' | 'api' | 'schedule' | 'workflow' }
): Promise<StepExecutionResult[]> {
  const readySteps = await db.select().from(planSteps)
    .where(and(eq(planSteps.goalId, goalId), eq(planSteps.status, 'ready')))
    .orderBy(asc(planSteps.order));

  if (readySteps.length === 0) return [];

  // Execute all ready steps (they are independent since their deps are met)
  const results = await Promise.allSettled(
    readySteps.map(step => executeStep(step.id, options))
  );

  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    return {
      stepId: readySteps[i].id,
      status: 'failed' as const,
      error: r.reason?.message || 'Unknown error',
    };
  });
}
