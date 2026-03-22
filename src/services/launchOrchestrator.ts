import { db } from '../db';
import { agents, organizations, sharedMemory, ceoPrelaunchMessages } from '../db/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { generateAllAgentFiles } from './agent-files';

interface TeamMember {
  name: string;
  role: string;
  description?: string;
  type: string;
  config?: Record<string, any>;
  jobDescription?: string;
  reportsTo?: string;
}

interface TeamPlan {
  proposedTeam: TeamMember[];
  [key: string]: any;
}

export async function launchOrganization(
  orgId: string,
  ceoAgentId: string,
  teamPlan: TeamPlan,
  options?: { teamOverrides?: TeamMember[] }
): Promise<{ teamAgents: any[]; filesGenerated: number }> {
  const now = new Date().toISOString();

  // Use overrides if provided, otherwise use the plan
  const teamConfigs = options?.teamOverrides || teamPlan.proposedTeam || [];

  // 1. Create team agents
  const teamAgents: any[] = [];
  for (const config of teamConfigs) {
    const agentId = uuidv4();
    const [agent] = await db.insert(agents).values({
      id: agentId,
      name: config.name || 'Agent',
      description: config.description || null,
      type: config.type || 'claude',
      config: config.config || {},
      status: 'active',
      role: config.role || 'worker',
      jobDescription: config.jobDescription || null,
      parentAgentId: config.reportsTo === 'ceo' ? ceoAgentId : null,
      organizationId: orgId,
      createdAt: now,
      updatedAt: now,
    }).returning();
    teamAgents.push(agent);
  }

  // 2. Second pass: resolve reportsTo names to parentAgentId
  const allOrgAgents = await db.select().from(agents).where(eq(agents.organizationId, orgId));
  const nameToId = new Map(allOrgAgents.map((a: any) => [a.name.toLowerCase(), a.id]));

  for (let i = 0; i < teamConfigs.length; i++) {
    const reportsTo = teamConfigs[i].reportsTo;
    if (reportsTo && reportsTo !== 'ceo') {
      const parentId = nameToId.get(reportsTo.toLowerCase());
      if (parentId && teamAgents[i]) {
        await db.update(agents)
          .set({ parentAgentId: parentId })
          .where(eq(agents.id, teamAgents[i].id));
      }
    }
  }

  // 3. Store org settings as shared memory
  const planMeta = [
    { key: '__launch_timestamp', value: now },
    { key: '__team_size', value: String(teamAgents.length + 1) }, // +1 for CEO
  ];
  for (const entry of planMeta) {
    await db.insert(sharedMemory).values({
      id: uuidv4(),
      organizationId: orgId,
      key: entry.key,
      value: entry.value,
      createdByAgentId: ceoAgentId,
      updatedAt: now,
    }).onConflictDoNothing();
  }

  // 4. Update org launch state
  await db.update(organizations)
    .set({ launchState: 'launched', updatedAt: now })
    .where(eq(organizations.id, orgId));

  // 5. Generate agent identity files (AGENT.md, SOUL.md, HEARTBEAT.md, BUSINESS.md)
  let filesGenerated = 0;
  try {
    filesGenerated = await generateAllAgentFiles(orgId);
  } catch (e: any) {
    console.error('[Launch] Agent file generation failed (non-critical):', e.message);
  }

  console.log(`[Launch] Organization launched: ${teamAgents.length} agents created, ${filesGenerated} files generated`);
  return { teamAgents, filesGenerated };
}
