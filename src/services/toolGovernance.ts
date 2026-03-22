import { db } from '../db';
import { toolPolicies, toolCalls, runs } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';

export interface ToolCheckRequest {
  agentId: string;
  toolName: string;
  organizationId?: string;
  runId?: string;
  estimatedCostUsd?: number;
}

export interface ToolCheckResult {
  allowed: boolean;
  mode: string;
  approvalRequired: boolean;
  reason?: string;
  policyId?: string;
}

/**
 * Check if an agent is allowed to use a specific tool.
 * Implements the Tool Governance Layer from the architecture plan.
 *
 * Policy resolution order:
 * 1. Check if tool has any policies defined
 * 2. If no policies exist for this tool → allowed by default (open by default)
 * 3. If policies exist → check allowed/denied lists
 * 4. Check rate limits (max calls per run, per day)
 * 5. Check cost limits
 * 6. Return mode and approval requirement
 */
export async function checkToolPermission(req: ToolCheckRequest): Promise<ToolCheckResult> {
  const policies = await db.select().from(toolPolicies)
    .where(and(
      eq(toolPolicies.toolName, req.toolName),
      eq(toolPolicies.enabled, true)
    ));

  // No policies = open by default
  if (policies.length === 0) {
    return { allowed: true, mode: 'execute', approvalRequired: false };
  }

  // Check each policy (most restrictive wins)
  for (const policy of policies) {
    // Check org scope
    if (policy.organizationId && policy.organizationId !== req.organizationId) continue;

    // Check denied list
    const denied = (policy.deniedAgentIds || []) as string[];
    if (denied.includes(req.agentId)) {
      return {
        allowed: false,
        mode: policy.mode,
        approvalRequired: false,
        reason: `Agent is explicitly denied access to ${req.toolName}`,
        policyId: policy.id,
      };
    }

    // Check allowed list (null = all allowed)
    const allowed = policy.allowedAgentIds as string[] | null;
    if (allowed && allowed.length > 0 && !allowed.includes(req.agentId)) {
      return {
        allowed: false,
        mode: policy.mode,
        approvalRequired: false,
        reason: `Agent is not in the allowed list for ${req.toolName}`,
        policyId: policy.id,
      };
    }

    // Check rate limits per run
    if (policy.maxCallsPerRun && req.runId) {
      const callCount = await db.select({ count: sql<number>`count(*)` })
        .from(toolCalls)
        .where(and(eq(toolCalls.runId, req.runId), eq(toolCalls.toolName, req.toolName)));

      if (callCount[0] && callCount[0].count >= policy.maxCallsPerRun) {
        return {
          allowed: false,
          mode: policy.mode,
          approvalRequired: false,
          reason: `Rate limit exceeded: ${policy.maxCallsPerRun} calls per run for ${req.toolName}`,
          policyId: policy.id,
        };
      }
    }

    // Check daily rate limits
    if (policy.maxCallsPerDay) {
      const today = new Date().toISOString().split('T')[0];
      const dailyCount = await db.select({ count: sql<number>`count(*)` })
        .from(toolCalls)
        .where(and(
          eq(toolCalls.toolName, req.toolName),
          sql`${toolCalls.createdAt} >= ${today}`
        ));

      if (dailyCount[0] && dailyCount[0].count >= policy.maxCallsPerDay) {
        return {
          allowed: false,
          mode: policy.mode,
          approvalRequired: false,
          reason: `Daily rate limit exceeded: ${policy.maxCallsPerDay} calls/day for ${req.toolName}`,
          policyId: policy.id,
        };
      }
    }

    // Check cost limit
    if (policy.maxCostPerCallUsd && req.estimatedCostUsd && req.estimatedCostUsd > policy.maxCostPerCallUsd) {
      return {
        allowed: false,
        mode: policy.mode,
        approvalRequired: false,
        reason: `Cost limit exceeded: max $${policy.maxCostPerCallUsd} per call`,
        policyId: policy.id,
      };
    }

    // Policy matched and passed all checks
    return {
      allowed: true,
      mode: policy.mode,
      approvalRequired: policy.approvalRequired,
      policyId: policy.id,
    };
  }

  // No matching policy found for this context → allowed by default
  return { allowed: true, mode: 'execute', approvalRequired: false };
}

/**
 * Get all policies for an organization (for display in UI)
 */
export async function getOrgPolicies(orgId?: string) {
  if (orgId) {
    return db.select().from(toolPolicies).where(eq(toolPolicies.organizationId, orgId));
  }
  return db.select().from(toolPolicies);
}

/**
 * Get a summary of tool usage for an agent
 */
export async function getToolUsageSummary(agentId: string) {
  const agentRuns = await db.select().from(runs).where(eq(runs.agentId, agentId));
  const runIds = agentRuns.map((r: any) => r.id);

  if (runIds.length === 0) return [];

  // Get tool call counts grouped by tool name
  const usage = await db.select({
    toolName: toolCalls.toolName,
    count: sql<number>`count(*)`,
  })
    .from(toolCalls)
    .where(sql`${toolCalls.runId} IN (${sql.join(runIds.map((id: string) => sql`${id}`), sql`,`)})`)
    .groupBy(toolCalls.toolName);

  return usage;
}
