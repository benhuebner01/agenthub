import { db } from '../db';
import { goals, planSteps, toolPolicies, workflows } from '../db/schema';
import { v4 as uuidv4 } from 'uuid';

/**
 * Auto-generates Goals, Tool Policies, and a default Workflow
 * when an organization is launched.
 *
 * This is what the CEO agent would "decide" during setup.
 */
export async function autoSetupOrganization(
  orgId: string,
  orgData: { name: string; description?: string; industry?: string; goals?: string[] },
  ceoAgentId: string,
  teamAgentIds: string[]
): Promise<{ goalsCreated: number; policiesCreated: number; workflowsCreated: number }> {
  const now = new Date().toISOString();
  let goalsCreated = 0;
  let policiesCreated = 0;
  let workflowsCreated = 0;

  // ─── 1. Create Goals from org goals ───────────────────────────────────────
  const orgGoals = orgData.goals || [];

  for (let i = 0; i < orgGoals.length; i++) {
    const goalId = uuidv4();
    await db.insert(goals).values({
      id: goalId,
      organizationId: orgId,
      agentId: null, // org-level goal
      title: orgGoals[i],
      description: `Organization goal: ${orgGoals[i]}`,
      priority: i === 0 ? 'high' : 'medium',
      status: 'active',
      successCriteria: [`${orgGoals[i]} is measurably achieved`],
      constraints: ['Stay within budget', 'Follow tool governance policies'],
      progress: 0,
      createdAt: now,
      updatedAt: now,
    });

    // Add default plan steps for each goal
    const researchStepId = uuidv4();
    const strategyStepId = uuidv4();
    const executeStepId = uuidv4();
    const reviewStepId = uuidv4();

    const defaultSteps = [
      {
        id: researchStepId,
        goalId,
        assignedAgentId: teamAgentIds[0] || ceoAgentId, // first team member or CEO
        title: 'Research & Analysis',
        description: `Research what's needed to achieve: ${orgGoals[i]}`,
        type: 'research' as const,
        order: 0,
        status: 'ready' as const, // no dependencies, ready to start
        dependsOn: [],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: strategyStepId,
        goalId,
        assignedAgentId: ceoAgentId,
        title: 'Strategy & Planning',
        description: 'Define approach based on research findings',
        type: 'reasoning' as const,
        order: 1,
        status: 'pending' as const,
        dependsOn: [researchStepId],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: executeStepId,
        goalId,
        assignedAgentId: teamAgentIds[1] || teamAgentIds[0] || ceoAgentId,
        title: 'Execute Plan',
        description: 'Carry out the strategy',
        type: 'action' as const,
        order: 2,
        status: 'pending' as const,
        dependsOn: [strategyStepId],
        createdAt: now,
        updatedAt: now,
      },
      {
        id: reviewStepId,
        goalId,
        assignedAgentId: ceoAgentId,
        title: 'Review & Verify',
        description: 'CEO reviews output quality and goal completion',
        type: 'validation' as const,
        order: 3,
        status: 'pending' as const,
        dependsOn: [executeStepId],
        verification: { checks: ['not_empty', 'has_content'] },
        createdAt: now,
        updatedAt: now,
      },
    ];

    for (const step of defaultSteps) {
      await db.insert(planSteps).values(step);
    }

    goalsCreated++;
  }

  // If no org goals were defined, create a bootstrap goal
  if (orgGoals.length === 0) {
    const goalId = uuidv4();
    await db.insert(goals).values({
      id: goalId,
      organizationId: orgId,
      title: `Launch ${orgData.name}`,
      description: `Get ${orgData.name} operational and producing value`,
      priority: 'high',
      status: 'active',
      successCriteria: ['All agents configured and tested', 'First successful workflow run completed'],
      constraints: [],
      progress: 0,
      createdAt: now,
      updatedAt: now,
    });
    goalsCreated++;
  }

  // ─── 2. Create default Tool Policies ──────────────────────────────────────
  const defaultPolicies = [
    {
      toolName: 'web_search',
      toolClass: 'research',
      mode: 'execute',
      approvalRequired: false,
      maxCallsPerRun: 20,
      maxCallsPerDay: 200,
    },
    {
      toolName: 'code_exec',
      toolClass: 'execution',
      mode: 'sandbox_only',
      approvalRequired: false,
      maxCallsPerRun: 10,
      maxCallsPerDay: 50,
    },
    {
      toolName: 'email_send',
      toolClass: 'communication',
      mode: 'draft_only',
      approvalRequired: true,
      maxCallsPerRun: 5,
      maxCallsPerDay: 20,
    },
    {
      toolName: 'file_write',
      toolClass: 'filesystem',
      mode: 'execute',
      approvalRequired: false,
      maxCallsPerRun: 30,
      maxCallsPerDay: 200,
    },
    {
      toolName: 'api_call',
      toolClass: 'execution',
      mode: 'execute_with_approval',
      approvalRequired: true,
      maxCallsPerRun: 10,
      maxCallsPerDay: 100,
      maxCostPerCallUsd: 1.0,
    },
  ];

  for (const policy of defaultPolicies) {
    await db.insert(toolPolicies).values({
      id: uuidv4(),
      organizationId: orgId,
      toolName: policy.toolName,
      toolClass: policy.toolClass,
      allowedAgentIds: null, // all agents allowed by default
      deniedAgentIds: null,
      mode: policy.mode,
      approvalRequired: policy.approvalRequired,
      maxCallsPerRun: policy.maxCallsPerRun || null,
      maxCallsPerDay: policy.maxCallsPerDay || null,
      maxCostPerCallUsd: (policy as any).maxCostPerCallUsd || null,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
    policiesCreated++;
  }

  // ─── 3. Create default Workflow ───────────────────────────────────────────
  // A standard "Research → Create → Review" workflow
  const step1Id = uuidv4();
  const step2Id = uuidv4();
  const step3Id = uuidv4();

  await db.insert(workflows).values({
    id: uuidv4(),
    organizationId: orgId,
    name: `${orgData.name} Standard Pipeline`,
    description: 'Default workflow: Research → Create → CEO Review. Use as template for custom workflows.',
    trigger: 'manual',
    status: 'active',
    steps: [
      {
        id: step1Id,
        agentId: teamAgentIds[0] || ceoAgentId,
        action: 'Research the given topic thoroughly. Provide findings as structured summary.',
        payloadTransform: 'full',
        onSuccess: step2Id,
        onFailure: 'retry',
        maxRetries: 2,
        approvalRequired: false,
      },
      {
        id: step2Id,
        agentId: teamAgentIds[1] || teamAgentIds[0] || ceoAgentId,
        action: 'Based on the research findings, create the requested deliverable.',
        payloadTransform: 'full',
        onSuccess: step3Id,
        onFailure: 'retry',
        maxRetries: 2,
        approvalRequired: false,
      },
      {
        id: step3Id,
        agentId: ceoAgentId,
        action: 'Review the deliverable for quality, accuracy, and alignment with organization goals.',
        payloadTransform: 'full',
        onFailure: 'abort',
        maxRetries: 1,
        approvalRequired: true,
      },
    ],
    createdAt: now,
    updatedAt: now,
  });
  workflowsCreated++;

  console.log(`[AutoSetup] Org ${orgData.name}: ${goalsCreated} goals, ${policiesCreated} policies, ${workflowsCreated} workflows created`);
  return { goalsCreated, policiesCreated, workflowsCreated };
}
