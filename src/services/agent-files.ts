import { db } from '../db';
import { knowledgeBase, agents, organizations } from '../db/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

// Template: AGENT.md
function buildAgentMd(agent: any, org: any, parentName?: string): string {
  return `# AGENT.md — ${agent.name}

## Identity
- **Role**: ${agent.role}
- **Type**: ${agent.type}
- **Organization**: ${org.name}
- **Reports to**: ${parentName || 'None (root)'}
- **Created**: ${agent.createdAt}

## Mission
${agent.jobDescription || 'No specific mission defined.'}

## Description
${agent.description || 'No description.'}

## Configuration
- Model: ${agent.config?.model || 'default'}
- System prompt: ${agent.config?.system_prompt ? 'Custom' : 'Default'}
`;
}

// Template: SOUL.md
function buildSoulMd(agent: any, org: any): string {
  const roleGuides: Record<string, string> = {
    ceo: `You are the CEO of ${org.name}. You think strategically, delegate effectively, and always consider the organization's mission. You propose new hires, restructures, and strategies. You communicate clearly and lead by example.`,
    manager: `You are a manager at ${org.name}. You coordinate between the CEO's vision and your team's execution. You break down strategic goals into actionable tasks, monitor quality, and escalate issues when needed.`,
    worker: `You are a worker at ${org.name}. You execute tasks efficiently and thoroughly. You follow your job description closely, report progress, and flag blockers. Quality and consistency matter.`,
    specialist: `You are a specialist at ${org.name}. You bring deep expertise in your domain. You provide analysis, recommendations, and high-quality outputs in your area of specialization.`,
  };

  return `# SOUL.md — ${agent.name}

## Core Behavior
${roleGuides[agent.role] || roleGuides.worker}

## Values
- Quality over speed
- Transparency in decision-making
- Collaboration with the team
- Continuous improvement

## Communication Style
- Be concise and actionable
- Use data and evidence when possible
- Escalate uncertainty rather than guessing
- Document decisions and reasoning

## Organization Context
- Industry: ${org.industry || 'General'}
- Goals: ${Array.isArray(org.goals) ? org.goals.join(', ') : (org.goals || 'Not specified')}
`;
}

// Template: BUSINESS.md (org-level, shared)
function buildBusinessMd(org: any, agentCount: number): string {
  const goalsStr = Array.isArray(org.goals) ? org.goals.map((g: string) => `- ${g}`).join('\n') : '- Not specified';
  return `# BUSINESS.md — ${org.name}

## Organization
- **Name**: ${org.name}
- **Industry**: ${org.industry || 'General'}
- **Team Size**: ${agentCount} agents
- **Status**: ${org.launchState || 'active'}

## Mission
${org.description || 'No description provided.'}

## Goals
${goalsStr}

## Created
${org.createdAt}
`;
}

// Template: HEARTBEAT.md
function buildHeartbeatMd(agent: any): string {
  return `# HEARTBEAT.md — ${agent.name}

## Daily Check-In Format

### Status
- [ ] Active and operational
- [ ] Tasks in progress
- [ ] Blocked on something

### Current Focus
_What are you working on right now?_

### Metrics
- Tasks completed today: 0
- Quality score: N/A
- Tokens used today: 0
- Cost today: $0.00

### Issues / Blockers
_Any problems that need escalation?_

### Notes
_Anything the team should know?_

---
Last updated: ${new Date().toISOString()}
Role: ${agent.role} | Type: ${agent.type}
`;
}

// Main: Generate all files for an org
export async function generateAllAgentFiles(orgId: string): Promise<number> {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  if (!org) throw new Error('Organization not found');

  const orgAgents = await db.select().from(agents).where(eq(agents.organizationId, orgId));
  const now = new Date().toISOString();
  let count = 0;

  // Build parent map for reportsTo resolution
  const agentMap = new Map(orgAgents.map((a: any) => [a.id, a]));

  // Generate BUSINESS.md as org-level knowledge
  const businessMd = buildBusinessMd(org, orgAgents.length);
  await db.insert(knowledgeBase).values({
    id: uuidv4(),
    agentId: null,
    organizationId: orgId,
    category: 'resources',
    title: 'BUSINESS.md',
    content: businessMd,
    createdAt: now,
    updatedAt: now,
  }).onConflictDoNothing();
  count++;

  // Generate per-agent files
  for (const agent of orgAgents) {
    const parent = agent.parentAgentId ? agentMap.get(agent.parentAgentId) : null;
    const parentName = parent ? (parent as any).name : undefined;

    const files = [
      { title: 'AGENT.md', content: buildAgentMd(agent, org, parentName) },
      { title: 'SOUL.md', content: buildSoulMd(agent, org) },
      { title: 'HEARTBEAT.md', content: buildHeartbeatMd(agent) },
    ];

    for (const file of files) {
      await db.insert(knowledgeBase).values({
        id: uuidv4(),
        agentId: agent.id,
        organizationId: orgId,
        category: 'resources',
        title: file.title,
        content: file.content,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing();
      count++;
    }
  }

  console.log(`[AgentFiles] Generated ${count} files for org "${org.name}"`);
  return count;
}

// Generate files for a single agent
export async function generateAgentFiles(agentId: string): Promise<void> {
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
  if (!agent || !agent.organizationId) return;

  const [org] = await db.select().from(organizations).where(eq(organizations.id, agent.organizationId));
  if (!org) return;

  const parent = agent.parentAgentId ? (await db.select().from(agents).where(eq(agents.id, agent.parentAgentId)))[0] : null;
  const now = new Date().toISOString();

  const files = [
    { title: 'AGENT.md', content: buildAgentMd(agent, org, parent?.name) },
    { title: 'SOUL.md', content: buildSoulMd(agent, org) },
    { title: 'HEARTBEAT.md', content: buildHeartbeatMd(agent) },
  ];

  for (const file of files) {
    await db.insert(knowledgeBase).values({
      id: uuidv4(),
      agentId: agent.id,
      organizationId: agent.organizationId,
      category: 'resources',
      title: file.title,
      content: file.content,
      createdAt: now,
      updatedAt: now,
    }).onConflictDoNothing();
  }
}
