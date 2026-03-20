import { Router, Request, Response } from 'express';
import { db } from '../db';
import { agents, organizations, proposals, runs } from '../db/schema';
import { eq, desc, and, gte, sql } from 'drizzle-orm';
import { executeAgent } from '../services/executor';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// ─── AI Analysis Helpers ──────────────────────────────────────────────────────

async function callAI(systemPrompt: string, userMessage: string): Promise<string> {
  if (process.env.ANTHROPIC_API_KEY) {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });
    return resp.content[0]?.type === 'text' ? resp.content[0].text : '';
  } else if (process.env.OPENAI_API_KEY) {
    const OpenAI = require('openai');
    const client = new OpenAI.default({ apiKey: process.env.OPENAI_API_KEY });
    const resp = await client.chat.completions.create({
      model: 'gpt-5.2',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    });
    return resp.choices[0]?.message?.content || '';
  }
  throw new Error('No AI provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.');
}

function buildCostTable(): string {
  return `
Model cost reference (per million tokens):
| Model | Input $/MTok | Output $/MTok | Best for |
|-------|-------------|---------------|----------|
| claude-opus-4-6 | $5.00 | $25.00 | Complex reasoning, strategy |
| claude-sonnet-4-6 | $3.00 | $15.00 | General tasks, good balance |
| claude-haiku-4-5 | $1.00 | $5.00 | Fast, simple tasks, cheapest Claude |
| gpt-5.2 | $1.75 | $14.00 | OpenAI flagship, complex tasks |
| gpt-5-mini | $0.25 | $2.00 | Fast, good quality, cost-effective |
| gpt-5-nano | $0.05 | $0.40 | Ultra cheap, simple tasks only |
| gpt-4.1 | $2.00 | $8.00 | Previous gen, still reliable |
| o3 | $2.00 | $8.00 | Advanced reasoning |
| o4-mini | $1.10 | $4.40 | Fast reasoning, cost-effective |

Typical monthly costs per agent:
- Light use (1K calls/month, ~1K tokens avg): $0.50-5
- Medium use (10K calls/month): $5-50
- Heavy use (100K+ calls/month): $50-500
- HTTP/bash agents: $0 (no token costs)
`;
}

// ─── POST /api/business/analyze ──────────────────────────────────────────────

router.post('/analyze', async (req: Request, res: Response) => {
  try {
    const { name, description, industry, goals, availableConnections } = req.body;

    if (!name || !description) {
      res.status(400).json({ error: 'name and description are required' });
      return;
    }

    const goalsStr = Array.isArray(goals) ? goals.join('\n- ') : (goals || 'General productivity');
    const connectionsStr = Array.isArray(availableConnections) && availableConnections.length > 0
      ? availableConnections.join(', ')
      : 'claude, openai, http, bash';

    const costTable = buildCostTable();

    const systemPrompt = `You are an expert AI business consultant and system architect.
Your job is to analyze a business and design an optimal AI agent organization.

Available agent types and their capabilities:
- claude: Anthropic Claude AI (reasoning, writing, analysis, complex tasks). Models: claude-sonnet-4-6 (recommended), claude-opus-4-6 (most capable), claude-haiku-4-5 (cheapest)
- openai: OpenAI GPT models (reasoning, writing, code generation). Models: gpt-5.2 (flagship), gpt-5-mini (fast+cheap), gpt-5-nano (ultra cheap), o3 (reasoning), o4-mini (fast reasoning)
- http: HTTP webhook agent (call external APIs, n8n, Zapier, Make)
- bash: Bash command agent (run shell scripts, system tasks)
- internal: Internal AgentHub AI (uses configured provider, no extra setup)
- claude-code: Claude Code CLI (autonomous coding on this machine)
- openai-codex: OpenAI Codex CLI (code generation on this machine)
- a2a: Agent-to-Agent protocol (communicate with other AI agents)
- mcp: Model Context Protocol (connect to MCP servers for tools)

Roles available:
- ceo: Top-level strategic agent, manages the whole org, proposes new hires, can override sub-agent instructions
- manager: Mid-level agent that oversees workers in a domain
- worker: Executes specific tasks
- specialist: Expert in a narrow domain

${costTable}

IMPORTANT: For each agent, specify the exact model in config.model. Choose models based on task complexity and budget.
For CEO, recommend claude-sonnet-4-6 or gpt-5.2. For simple tasks, use claude-haiku-4-5 or gpt-5-nano.

You must respond with ONLY valid JSON matching exactly this structure (no markdown, no explanation):
{
  "organization": {
    "name": "string",
    "description": "string",
    "industry": "string",
    "goals": ["string"]
  },
  "ceoAgent": {
    "name": "string",
    "description": "string",
    "type": "claude|openai|internal",
    "config": {"model": "string", "system_prompt": "string"},
    "jobDescription": "string"
  },
  "proposedTeam": [
    {
      "name": "string",
      "role": "manager|worker|specialist",
      "description": "string",
      "type": "claude|openai|http|bash|internal|mcp",
      "config": {"model": "string", "system_prompt": "string"},
      "jobDescription": "string",
      "reportsTo": "ceo|<agentName>"
    }
  ],
  "reasoning": "string",
  "estimatedMonthlyCostUsd": number,
  "costBreakdown": [
    {"agentName": "string", "model": "string", "estimatedCallsPerMonth": number, "estimatedCostUsd": number}
  ],
  "alternatives": [
    {"description": "string", "estimatedMonthlyCostUsd": number, "tradeoff": "string"}
  ],
  "recommendation": "string"
}`;

    const userMessage = `Business to analyze:
Name: ${name}
Industry: ${industry || 'Not specified'}
Description: ${description}
Goals:
- ${goalsStr}
Available integrations: ${connectionsStr}

Design the optimal AI agent organization for this business. Include 1 CEO and 3-6 team agents.`;

    const rawResponse = await callAI(systemPrompt, userMessage);

    // Extract JSON from response (handle potential markdown wrapping)
    let jsonStr = rawResponse.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) jsonStr = jsonMatch[1];

    const analysisResult = JSON.parse(jsonStr);
    res.json({ data: analysisResult });
  } catch (err: any) {
    console.error('[Business] POST /analyze error:', err);
    res.status(500).json({ error: 'Failed to analyze business', details: err.message });
  }
});

// ─── POST /api/business/create ────────────────────────────────────────────────

router.post('/create', async (req: Request, res: Response) => {
  try {
    const { organizationData, ceoConfig, teamConfigs } = req.body;

    if (!organizationData?.name) {
      res.status(400).json({ error: 'organizationData.name is required' });
      return;
    }

    const now = new Date().toISOString();

    // Create organization
    const orgId = uuidv4();
    const [org] = await db.insert(organizations).values({
      id: orgId,
      name: organizationData.name,
      description: organizationData.description || null,
      industry: organizationData.industry || null,
      goals: organizationData.goals || [],
      createdAt: now,
      updatedAt: now,
    }).returning();

    // Create CEO agent
    const ceoId = uuidv4();
    const [ceoAgent] = await db.insert(agents).values({
      id: ceoId,
      name: ceoConfig.name || `${organizationData.name} CEO`,
      description: ceoConfig.description || `CEO of ${organizationData.name}`,
      type: ceoConfig.type || 'claude',
      config: ceoConfig.config || {},
      status: 'active',
      role: 'ceo',
      jobDescription: ceoConfig.jobDescription || 'Lead the organization and manage the AI team',
      organizationId: orgId,
      createdAt: now,
      updatedAt: now,
    }).returning();

    // Create team agents
    const teamAgents = [];
    if (Array.isArray(teamConfigs)) {
      for (const teamConfig of teamConfigs) {
        const agentId = uuidv4();
        const [teamAgent] = await db.insert(agents).values({
          id: agentId,
          name: teamConfig.name,
          description: teamConfig.description || null,
          type: teamConfig.type || 'claude',
          config: teamConfig.config || {},
          status: 'active',
          role: teamConfig.role || 'worker',
          jobDescription: teamConfig.jobDescription || null,
          parentAgentId: teamConfig.reportsTo === 'ceo' ? ceoId : null,
          organizationId: orgId,
          createdAt: now,
          updatedAt: now,
        }).returning();
        teamAgents.push(teamAgent);
      }
    }

    res.status(201).json({
      data: {
        organization: org,
        ceoAgent,
        teamAgents,
      },
    });
  } catch (err: any) {
    console.error('[Business] POST /create error:', err);
    res.status(500).json({ error: 'Failed to create business', details: err.message });
  }
});

// ─── GET /api/business/organizations ─────────────────────────────────────────

router.get('/organizations', async (req: Request, res: Response) => {
  try {
    const allOrgs = await db.select().from(organizations).orderBy(desc(organizations.createdAt));
    res.json({ data: allOrgs, total: allOrgs.length });
  } catch (err: any) {
    console.error('[Business] GET /organizations error:', err);
    res.status(500).json({ error: 'Failed to fetch organizations' });
  }
});

// ─── GET /api/business/organizations/:id ─────────────────────────────────────

router.get('/organizations/:id', async (req: Request, res: Response) => {
  try {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, req.params.id));
    if (!org) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }

    const orgAgents = await db.select().from(agents).where(eq(agents.organizationId, req.params.id));

    res.json({ data: { ...org, agents: orgAgents } });
  } catch (err: any) {
    console.error('[Business] GET /organizations/:id error:', err);
    res.status(500).json({ error: 'Failed to fetch organization' });
  }
});

// ─── GET /api/business/organizations/:id/chart ───────────────────────────────

router.get('/organizations/:id/chart', async (req: Request, res: Response) => {
  try {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, req.params.id));
    if (!org) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }

    const orgAgents = await db.select().from(agents).where(eq(agents.organizationId, req.params.id));

    // Build tree structure
    function buildTree(agentId: string | null): any[] {
      return orgAgents
        .filter((a) => a.parentAgentId === agentId)
        .map((a) => ({
          id: a.id,
          name: a.name,
          role: a.role,
          status: a.status,
          description: a.description,
          jobDescription: a.jobDescription,
          type: a.type,
          children: buildTree(a.id),
        }));
    }

    // Find CEO(s) — agents with role 'ceo' or no parent
    const ceos = orgAgents.filter((a) => a.role === 'ceo' || (!a.parentAgentId && a.role !== 'ceo'));
    const chart = ceos.map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      status: a.status,
      description: a.description,
      jobDescription: a.jobDescription,
      type: a.type,
      children: buildTree(a.id),
    }));

    res.json({ data: { organization: org, chart } });
  } catch (err: any) {
    console.error('[Business] GET /organizations/:id/chart error:', err);
    res.status(500).json({ error: 'Failed to fetch org chart' });
  }
});

// ─── POST /api/business/organizations/:id/ceo-run ────────────────────────────

router.post('/organizations/:id/ceo-run', async (req: Request, res: Response) => {
  try {
    const { input: userInput } = req.body;
    const orgId = req.params.id;

    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
    if (!org) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }

    const orgAgents = await db.select().from(agents).where(eq(agents.organizationId, orgId));
    const ceoAgent = orgAgents.find((a) => a.role === 'ceo');

    if (!ceoAgent) {
      res.status(404).json({ error: 'No CEO agent found for this organization' });
      return;
    }

    const teamAgents = orgAgents.filter((a) => a.role !== 'ceo');

    // Gather stats for last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const cutoffDate = thirtyDaysAgo.toISOString();

    const recentRuns = await db.select().from(runs)
      .where(gte(runs.createdAt, cutoffDate));

    const orgRunAgentIds = new Set(orgAgents.map((a) => a.id));
    const orgRuns = recentRuns.filter((r) => orgRunAgentIds.has(r.agentId));
    const totalRuns = orgRuns.length;
    const successRuns = orgRuns.filter((r) => r.status === 'success').length;
    const successRate = totalRuns > 0 ? Math.round((successRuns / totalRuns) * 100) : 0;
    const totalCost = orgRuns.reduce((sum, r) => sum + (Number(r.costUsd) || 0), 0);

    const goalsStr = Array.isArray(org.goals) ? (org.goals as string[]).join(', ') : String(org.goals || '');
    const teamStr = teamAgents.map((a) => `- ${a.name} (${a.role}): ${a.jobDescription || a.description || 'No description'}`).join('\n');

    // Per-agent performance stats
    const agentStatsStr = teamAgents.map(a => {
      const agentRuns = orgRuns.filter(r => r.agentId === a.id);
      const agentSuccess = agentRuns.filter(r => r.status === 'success').length;
      const agentCost = agentRuns.reduce((sum, r) => sum + (Number(r.costUsd) || 0), 0);
      return `  - ${a.name} (${a.role}, ${a.type}): ${agentRuns.length} runs, ${agentRuns.length > 0 ? Math.round((agentSuccess / agentRuns.length) * 100) : 0}% success, $${agentCost.toFixed(4)} spent`;
    }).join('\n');

    // Get pending proposals
    const pendingProposals = await db.select().from(proposals)
      .where(and(
        eq(proposals.organizationId, orgId),
        eq(proposals.status, 'pending')
      ));

    const proposalsStr = pendingProposals.length > 0
      ? pendingProposals.map(p => `  - [${p.type}] "${p.title}" (est. $${p.estimatedCostUsd || 0}/mo)`).join('\n')
      : '  None';

    const costTable = buildCostTable();

    // Build CEO system prompt with full organizational context (heartbeat)
    const ceoSystemPrompt = `You are the CEO of ${org.name}. Your mission: ${goalsStr}.

═══ ORGANIZATION HEARTBEAT ═══

Your team:
${teamStr || 'No team members yet.'}

Per-agent performance (last 30 days):
${agentStatsStr || '  No data yet.'}

Aggregate performance:
- Total runs: ${totalRuns}
- Success rate: ${successRate}%
- Total cost: $${totalCost.toFixed(4)}

Pending proposals awaiting user approval:
${proposalsStr}

${costTable}

═══ YOUR CAPABILITIES ═══

You can take three types of actions by including XML blocks in your response:

1. UPDATE AGENT INSTRUCTIONS — Immediately change a sub-agent's system prompt, job description, or status:
<agent_update>
{"agentId": "<agent-id>", "systemPrompt": "New instructions...", "jobDescription": "Updated role...", "status": "active|paused"}
</agent_update>

2. UPDATE SCHEDULES — Change how often a sub-agent runs:
<schedule_update>
{"agentId": "<agent-id>", "cronExpression": "0 */6 * * *", "enabled": true}
</schedule_update>

3. PROPOSE CHANGES — Propose hiring, restructuring, or strategy changes (requires user approval):
<proposal>
{"type": "hire_agent|restructure|budget_increase|strategy", "title": "...", "reasoning": "...", "agentConfig": {"name": "...", "type": "claude", "role": "specialist", "config": {"model": "claude-haiku-4-5", "system_prompt": "..."}}, "estimatedMonthlyCostUsd": 5}
</proposal>

IMPORTANT: agent_update and schedule_update are applied immediately. Proposals require user approval.
Only update agents that belong to your organization. Be strategic about costs.

═══ CURRENT TASK ═══

Analyze the situation and respond to: ${userInput || 'Please analyze our current organizational performance and recommend improvements.'}`;

    // Override the CEO's system prompt for this run
    const originalConfig = (ceoAgent.config as Record<string, unknown>) || {};
    const runConfig = { ...originalConfig, system_prompt: ceoSystemPrompt };

    // Temporarily patch agent config for this run
    await db.update(agents)
      .set({ config: runConfig, updatedAt: new Date().toISOString() })
      .where(eq(agents.id, ceoAgent.id));

    const result = await executeAgent(ceoAgent.id, userInput || 'Analyze organizational performance and recommend improvements.', 'api');

    // Restore original config
    await db.update(agents)
      .set({ config: originalConfig, updatedAt: new Date().toISOString() })
      .where(eq(agents.id, ceoAgent.id));

    res.json({ data: result });
  } catch (err: any) {
    console.error('[Business] POST /organizations/:id/ceo-run error:', err);
    res.status(500).json({ error: 'Failed to run CEO agent', details: err.message });
  }
});

// ─── GET /api/proposals ───────────────────────────────────────────────────────

router.get('/proposals', async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string | undefined;

    let query = db.select().from(proposals).orderBy(desc(proposals.createdAt));
    const allProposals = status
      ? await db.select().from(proposals).where(eq(proposals.status, status)).orderBy(desc(proposals.createdAt))
      : await query;

    res.json({ data: allProposals, total: allProposals.length });
  } catch (err: any) {
    console.error('[Business] GET /proposals error:', err);
    res.status(500).json({ error: 'Failed to fetch proposals' });
  }
});

// ─── POST /api/proposals/:id/approve ─────────────────────────────────────────

router.post('/proposals/:id/approve', async (req: Request, res: Response) => {
  try {
    const [proposal] = await db.select().from(proposals).where(eq(proposals.id, req.params.id));
    if (!proposal) {
      res.status(404).json({ error: 'Proposal not found' });
      return;
    }

    const resolvedAt = new Date().toISOString();
    const [updated] = await db.update(proposals)
      .set({ status: 'approved', resolvedAt })
      .where(eq(proposals.id, req.params.id))
      .returning();

    // If type is hire_agent, auto-create the agent
    let newAgent = null;
    if (proposal.type === 'hire_agent') {
      const details = proposal.details as Record<string, any>;
      const agentConfig = details.agentConfig || {};
      const now = new Date().toISOString();
      const [created] = await db.insert(agents).values({
        id: uuidv4(),
        name: agentConfig.name || `New Agent ${Date.now()}`,
        description: agentConfig.description || null,
        type: agentConfig.type || 'claude',
        config: agentConfig.config || {},
        status: 'active',
        role: agentConfig.role || 'worker',
        jobDescription: agentConfig.jobDescription || null,
        organizationId: proposal.organizationId || null,
        parentAgentId: agentConfig.parentAgentId || proposal.proposedByAgentId || null,
        createdAt: now,
        updatedAt: now,
      }).returning();
      newAgent = created;
    }

    res.json({ data: updated, newAgent });
  } catch (err: any) {
    console.error('[Business] POST /proposals/:id/approve error:', err);
    res.status(500).json({ error: 'Failed to approve proposal' });
  }
});

// ─── POST /api/proposals/:id/reject ──────────────────────────────────────────

router.post('/proposals/:id/reject', async (req: Request, res: Response) => {
  try {
    const [proposal] = await db.select().from(proposals).where(eq(proposals.id, req.params.id));
    if (!proposal) {
      res.status(404).json({ error: 'Proposal not found' });
      return;
    }

    const { reason } = req.body;
    const [updated] = await db.update(proposals)
      .set({
        status: 'rejected',
        userNotes: reason || null,
        resolvedAt: new Date().toISOString(),
      })
      .where(eq(proposals.id, req.params.id))
      .returning();

    res.json({ data: updated });
  } catch (err: any) {
    console.error('[Business] POST /proposals/:id/reject error:', err);
    res.status(500).json({ error: 'Failed to reject proposal' });
  }
});

export default router;
