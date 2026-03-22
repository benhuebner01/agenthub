/**
 * Workflow Engine — drives multi-step agent workflows.
 *
 * Takes a workflow run, executes steps sequentially with agent handoffs,
 * handles retries, approvals, and payload transforms between steps.
 */

import { db } from '../db';
import { workflows, workflowRuns, agents } from '../db/schema';
import { eq } from 'drizzle-orm';
import { executeAgent } from './executor';
import { requestHumanApproval, getPendingApprovals } from './verification';
import type { WorkflowStepDef } from '../db/schema';

export interface WorkflowStepResult {
  stepId: string;
  status: 'completed' | 'failed' | 'awaiting_approval';
  output?: unknown;
  error?: string;
  costUsd?: number;
}

export interface WorkflowRunResult {
  runId: string;
  status: string;
  stepsExecuted: number;
  currentStepId?: string | null;
  error?: string;
}

// ─── Execute a single workflow step ──────────────────────────────────────────

export async function executeWorkflowStep(runId: string): Promise<WorkflowStepResult> {
  const now = new Date().toISOString();

  // Load run + workflow
  const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, runId));
  if (!run) throw new Error(`Workflow run ${runId} not found`);
  if (run.status === 'completed' || run.status === 'failed') {
    return { stepId: run.currentStepId || '', status: run.status as 'completed' | 'failed', error: 'Run already finished' };
  }

  const [wf] = await db.select().from(workflows).where(eq(workflows.id, run.workflowId));
  if (!wf) throw new Error(`Workflow ${run.workflowId} not found`);

  const steps = (wf.steps || []) as WorkflowStepDef[];
  if (steps.length === 0) {
    await db.update(workflowRuns).set({ status: 'failed', completedAt: now }).where(eq(workflowRuns.id, runId));
    return { stepId: '', status: 'failed', error: 'Workflow has no steps' };
  }

  // Find current step
  const currentStep = steps.find(s => s.id === run.currentStepId);
  if (!currentStep) {
    await db.update(workflowRuns).set({ status: 'failed', completedAt: now }).where(eq(workflowRuns.id, runId));
    return { stepId: run.currentStepId || '', status: 'failed', error: 'Current step not found in workflow definition' };
  }

  // Check approval gate
  if (currentStep.approvalRequired) {
    // Check if there's already a resolved approval for this step
    const pending = await getPendingApprovals();
    const existingApproval = pending.find((v: any) =>
      v.notes?.includes(currentStep.id) && v.notes?.includes(runId)
    );
    if (!existingApproval) {
      // Create approval request
      await requestHumanApproval(currentStep.id, {
        workflowRunId: runId,
        action: currentStep.action,
        agentId: currentStep.agentId,
      }, {
        runId: undefined,
        agentId: currentStep.agentId,
        notes: `workflow:${runId}:step:${currentStep.id}`,
      });
      return { stepId: currentStep.id, status: 'awaiting_approval' };
    }
  }

  // Verify agent exists
  const [agent] = await db.select().from(agents).where(eq(agents.id, currentStep.agentId));
  if (!agent) {
    await db.update(workflowRuns).set({ status: 'failed', completedAt: now }).where(eq(workflowRuns.id, runId));
    return { stepId: currentStep.id, status: 'failed', error: `Agent ${currentStep.agentId} not found` };
  }

  // Build input — combine workflow input + previous step results + action instruction
  const stepResults = (run.stepResults || {}) as Record<string, any>;
  const inputParts: string[] = [];

  inputParts.push(`## Task\n${currentStep.action}`);

  // Add initial workflow input
  if (run.input) {
    inputParts.push(`\n## Workflow Input\n${typeof run.input === 'string' ? run.input : JSON.stringify(run.input)}`);
  }

  // Add previous step results based on payload transform
  const prevStepIds = steps
    .slice(0, steps.indexOf(currentStep))
    .map(s => s.id)
    .filter(id => stepResults[id]);

  if (prevStepIds.length > 0) {
    inputParts.push('\n## Previous Step Results');
    for (const prevId of prevStepIds) {
      const prevResult = stepResults[prevId];
      let outputStr = typeof prevResult.output === 'string'
        ? prevResult.output
        : JSON.stringify(prevResult.output);

      // Apply payload transform
      if (currentStep.payloadTransform === 'summary' && outputStr.length > 500) {
        outputStr = outputStr.substring(0, 500) + '...(summarized)';
      }

      // Filter by payloadFields
      if (currentStep.payloadFields && typeof prevResult.output === 'object' && prevResult.output) {
        const filtered: Record<string, any> = {};
        for (const field of currentStep.payloadFields) {
          if ((prevResult.output as Record<string, any>)[field] !== undefined) {
            filtered[field] = (prevResult.output as Record<string, any>)[field];
          }
        }
        outputStr = JSON.stringify(filtered);
      }

      const prevStep = steps.find(s => s.id === prevId);
      inputParts.push(`\n### ${prevStep?.action || prevId}\n${outputStr}`);
    }
  }

  const builtInput = inputParts.join('\n');

  // Execute agent
  let result;
  try {
    const timeout = currentStep.timeoutMs || 120000;
    result = await Promise.race([
      executeAgent(currentStep.agentId, builtInput, 'api'),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Step timed out after ${timeout}ms`)), timeout)
      ),
    ]);
  } catch (err: any) {
    // Handle failure / retry
    const retryCount = (stepResults[currentStep.id]?.retries || 0) + 1;
    const maxRetries = currentStep.maxRetries || 0;

    if (currentStep.onFailure === 'retry' && retryCount <= maxRetries) {
      // Store retry attempt
      stepResults[currentStep.id] = { ...(stepResults[currentStep.id] || {}), retries: retryCount, lastError: err.message };
      await db.update(workflowRuns).set({ stepResults }).where(eq(workflowRuns.id, runId));
      // Re-attempt by returning — caller can call again
      return { stepId: currentStep.id, status: 'failed', error: `Retry ${retryCount}/${maxRetries}: ${err.message}` };
    }

    if (currentStep.onFailure === 'abort' || !currentStep.onFailure) {
      await db.update(workflowRuns).set({
        status: 'failed',
        completedAt: now,
        stepResults: { ...stepResults, [currentStep.id]: { error: err.message, success: false } },
      }).where(eq(workflowRuns.id, runId));
      return { stepId: currentStep.id, status: 'failed', error: err.message };
    }

    // onFailure is a step ID — jump to that step
    stepResults[currentStep.id] = { error: err.message, success: false };
    await db.update(workflowRuns).set({
      currentStepId: currentStep.onFailure,
      stepResults,
    }).where(eq(workflowRuns.id, runId));
    return { stepId: currentStep.id, status: 'failed', error: err.message };
  }

  // Store result
  stepResults[currentStep.id] = {
    output: result.output,
    success: result.success,
    costUsd: result.costUsd,
    runId: result.runId,
  };

  // Determine next step
  let nextStepId: string | null = null;

  if (result.success) {
    if (currentStep.onSuccess) {
      nextStepId = currentStep.onSuccess;
    } else {
      // Sequential: find next step in array
      const currentIndex = steps.indexOf(currentStep);
      if (currentIndex < steps.length - 1) {
        nextStepId = steps[currentIndex + 1].id;
      }
    }
  } else {
    // Agent returned success: false
    if (currentStep.onFailure === 'abort' || !currentStep.onFailure) {
      await db.update(workflowRuns).set({
        status: 'failed',
        completedAt: now,
        stepResults,
      }).where(eq(workflowRuns.id, runId));
      return { stepId: currentStep.id, status: 'failed', output: result.output, error: result.error };
    }
    if (currentStep.onFailure === 'retry') {
      // Already handled above in catch block for thrown errors;
      // For non-thrown failures, just re-attempt
      return { stepId: currentStep.id, status: 'failed', output: result.output, error: result.error || 'Agent returned failure' };
    }
    nextStepId = currentStep.onFailure;
  }

  // Update run
  if (nextStepId) {
    await db.update(workflowRuns).set({
      currentStepId: nextStepId,
      stepResults,
    }).where(eq(workflowRuns.id, runId));
  } else {
    // No next step — workflow complete
    await db.update(workflowRuns).set({
      status: 'completed',
      completedAt: now,
      output: result.output,
      stepResults,
    }).where(eq(workflowRuns.id, runId));
  }

  return {
    stepId: currentStep.id,
    status: nextStepId ? 'completed' : 'completed',
    output: result.output,
    costUsd: result.costUsd,
  };
}

// ─── Run entire workflow until done/blocked/failed ───────────────────────────

export async function runWorkflow(runId: string): Promise<WorkflowRunResult> {
  let stepsExecuted = 0;
  const maxSteps = 50; // safety limit

  while (stepsExecuted < maxSteps) {
    const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, runId));
    if (!run) return { runId, status: 'failed', stepsExecuted, error: 'Run not found' };
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      return { runId, status: run.status, stepsExecuted, currentStepId: run.currentStepId };
    }

    const stepResult = await executeWorkflowStep(runId);
    stepsExecuted++;

    if (stepResult.status === 'awaiting_approval') {
      return { runId, status: 'awaiting_approval', stepsExecuted, currentStepId: stepResult.stepId };
    }

    // Re-check run status
    const [updated] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, runId));
    if (updated?.status === 'completed' || updated?.status === 'failed') {
      return { runId, status: updated.status, stepsExecuted, currentStepId: updated.currentStepId };
    }
  }

  return { runId, status: 'failed', stepsExecuted, error: `Safety limit: exceeded ${maxSteps} steps` };
}

// ─── Resume after approval ───────────────────────────────────────────────────

export async function resumeWorkflowRun(runId: string): Promise<WorkflowRunResult> {
  const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, runId));
  if (!run) throw new Error(`Workflow run ${runId} not found`);
  if (run.status === 'completed' || run.status === 'failed') {
    return { runId, status: run.status, stepsExecuted: 0 };
  }

  // Continue execution
  return runWorkflow(runId);
}
