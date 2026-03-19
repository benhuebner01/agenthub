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
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    });
    return resp.choices[0]?.message?.content || '';
  }
  throw new Error('No AI provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.');
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

    const systemPrompt = `You are an expert AI business consultant and system architect.
Your job is to analyze a business and design an optimal AI agent organization.

Available agent types and their capabilities:
- claude: Anthropic Claude AI (reasoning, writing, analysis, complex tasks)
- openai: OpenAI GPT models (reasoning, writing, code generation)
- http: HTTP webhook agent (call external APIs and services)
- bash: Bash command agent (run shell scripts, system tasks)
- internal: Internal AgentHub AI (system management, orchestration)
- claude-code: Claude Code CLI (coding tasks, repository management)
- a2a: Agent-to-Agent protocol (communicate with other AI agents)

Roles available:
- ceo: Top-level strategic agent, manages the whole org, proposes new hires
- manager: Mid-level agent that oversees workers in a domain
- worker: Executes specific tasks
- specialist: Expert in a narrow domain

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
    "config": {},
    "jobDescription": "string"
  },
  "proposedTeam": [
    {
      "name": "string",
      "role": "manager|worker|specialist",
      "description": "string",
      "type": "claude|openai|http|bash|internal",
      "config": {},
      "jobDescription": "string",
      "reportsTo": "ceo|<agentName>"
    }
  ],
  "reasoning": "string",
  "estimatedMonthlyCostUsd": number,
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

    // Build CEO system prompt with full organizational context
    const ceoSystemPrompt = `You are the CEO of ${org.name}. Your mission: ${goalsStr}.

Your team:
${teamStr || 'No team members yet.'}

Recent performance (last 30 days):
- Total runs: ${totalRuns}
- Success rate: ${successRate}%
- Total cost: $${totalCost.toFixed(4)}

When you decide to hire a new agent or make strategic changes, output a JSON block like:
<proposal>
{"type": "hire_agent", "title": "Hire Research Specialist", "reasoning": "We need better research capabilities", "agentConfig": {"name": "Research Agent", "type": "claude", "role": "specialist", "config": {"system_prompt": "You are a research specialist."}}, "estimatedMonthlyCostUsd": 10}
</proposal>

For restructuring or strategy proposals:
<proposal>
{"type": "strategy", "title": "Improve Content Pipeline", "reasoning": "Current output is too slow", "details": {}, "estimatedMonthlyCostUsd": 0}
</proposal>

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
