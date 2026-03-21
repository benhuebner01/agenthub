import { Router, Request, Response } from 'express';
import { db } from '../db';
import { agents, organizations, proposals, runs, sharedMemory } from '../db/schema';
import { eq, desc, and, gte, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getApiKeyForProvider } from './settings';

const router = Router();

// ─── AI Analysis Helpers ──────────────────────────────────────────────────────

async function callAI(systemPrompt: string, userMessage: string): Promise<string> {
  const anthropicKey = await getApiKeyForProvider('anthropic');
  const openaiKey = await getApiKeyForProvider('openai');

  if (anthropicKey) {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic.default({ apiKey: anthropicKey });
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 12800,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });
    return resp.content[0]?.type === 'text' ? resp.content[0].text : '';
  } else if (openaiKey) {
    const OpenAI = require('openai');
    const client = new OpenAI.default({ apiKey: openaiKey });
    const resp = await client.chat.completions.create({
      model: 'gpt-5.4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    });
    return resp.choices[0]?.message?.content || '';
  }
  throw new Error('No AI provider configured. Add API keys in Settings or set ANTHROPIC_API_KEY / OPENAI_API_KEY in .env.');
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

    const systemPrompt = `You are an expert AI business architect designing agent organizations — like Paperclip AI but better.

HIERARCHY RULES (strict):
- Exactly 1 CEO at the root. Every agent reports to exactly one manager.
- Tree structure: CEO → Managers → Workers/Specialists
- No agent can have multiple managers.
- The CEO's mission is the company goal — every agent's job traces back to it.

AGENT TYPES:
- claude: Anthropic Claude (reasoning, writing, strategy, analysis) — best for CEO/managers
- openai: OpenAI GPT-5.4 (writing, code, general tasks)
- http: HTTP webhook (trigger n8n, Zapier, external APIs)
- bash: Shell/Python scripts (data processing, automation)
- claude-code: Claude Code CLI (autonomous coding, repo management)
- openclaw: OpenClaw local agent (runs on user machine, OpenAI-compatible API)
- a2a: Agent-to-Agent protocol (any A2A-compatible external agent)
- mcp: MCP server tool (filesystem, GitHub, search via Model Context Protocol)
- internal: Built-in AgentHub AI (orchestration, platform management)

COST TABLE (per 1M tokens):
- claude-opus-4-6: $5 input / $25 output
- claude-sonnet-4-6: $3 input / $15 output
- claude-haiku-4-5: $1 input / $5 output
- gpt-5.4: $2.50 input / $15 output
- gpt-5.4-mini: $0.75 input / $3.00 output
- gpt-5.4-nano: $0.10 input / $0.50 output
- http/bash/openclaw/a2a/mcp: $0 (no token cost)

DESIGN PRINCIPLES:
1. CEO should use claude-sonnet-4-6 (best strategic reasoning)
2. High-volume workers should use cheaper models (gpt-5.4-mini, haiku, or http/bash)
3. Propose 1 CEO + 3-6 team agents (don't over-staff)
4. Each agent's jobDescription must be specific and mission-driven
5. Include costBreakdown: realistic token estimate per agent per month
6. EVERY agent MUST have a unique, descriptive name (NEVER "Internal Agent" or generic names). Use role-based names like "Research Analyst", "Content Strategist", "Ops Coordinator", "QA Auditor" etc.

Respond with ONLY valid JSON, no markdown:
{
  "organization": { "name": "string", "description": "string", "industry": "string", "goals": ["string"] },
  "ceoAgent": {
    "name": "string",
    "description": "string",
    "type": "claude",
    "config": { "model": "claude-sonnet-4-6", "system_prompt": "You are the CEO of [company]. Mission: [goals]. Your team: [agents]." },
    "jobDescription": "string"
  },
  "proposedTeam": [
    {
      "name": "string",
      "role": "manager|worker|specialist",
      "description": "string",
      "type": "claude|openai|http|bash|claude-code|openclaw|a2a|mcp|internal",
      "config": { "model": "gpt-5.4" },
      "jobDescription": "string",
      "reportsTo": "ceo|<agentName>"
    }
  ],
  "costBreakdown": [
    { "agentName": "string", "model": "string", "estimatedMonthlyTokens": number, "estimatedMonthlyCostUsd": number }
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

Design the optimal strict-hierarchy AI agent organization. Include 1 CEO and 3-6 team agents. Be specific about job descriptions and choose the most cost-efficient agent types.`;

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
          name: teamConfig.name || `${(teamConfig.role || 'Worker').charAt(0).toUpperCase() + (teamConfig.role || 'worker').slice(1)} - ${(teamConfig.jobDescription || 'Agent').split(' ').slice(0, 3).join(' ')}`,
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

    // ── Auto-generate org memory via AI (async, non-blocking) ──
    const allTeamNames = teamAgents.map((a: any) => `${a.name} (${a.role})`).join(', ');
    generateOrgMemory(orgId, organizationData, ceoAgent, allTeamNames).catch((e: any) =>
      console.error('[Business] Auto-generate org memory failed (non-critical):', e.message)
    );

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

// ─── Auto-generate Org Memory ─────────────────────────────────────────────────

async function generateOrgMemory(orgId: string, orgData: any, ceo: any, teamNames: string) {
  try {
    const prompt = `You are setting up the organizational memory for a new AI company called "${orgData.name}".
Industry: ${orgData.industry || 'General'}
Description: ${orgData.description || 'N/A'}
Goals: ${Array.isArray(orgData.goals) ? orgData.goals.join(', ') : 'Not specified'}
CEO: ${ceo.name}
Team: ${teamNames || 'No team yet'}

Generate 5-8 essential shared memory entries that ALL agents in this organization should know.
Output ONLY a JSON array of objects with "key" and "value" fields. Keys should be snake_case identifiers.

Example entries to consider:
- company_mission: the core mission statement
- brand_voice: how the company communicates
- target_audience: who the company serves
- key_products: main products/services
- communication_style: formal/casual/etc
- quality_standards: what quality means for this company
- escalation_rules: when to escalate issues to management

Output ONLY valid JSON array, no markdown, no explanation.`;

    const result = await callAI('You are a business setup assistant. Output only valid JSON.', prompt);

    // Parse the JSON array
    const cleaned = result.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
    const entries = JSON.parse(cleaned);
    const now = new Date().toISOString();

    if (Array.isArray(entries)) {
      for (const entry of entries) {
        if (entry.key && entry.value) {
          await db.insert(sharedMemory).values({
            id: uuidv4(),
            organizationId: orgId,
            key: String(entry.key).trim(),
            value: String(entry.value).trim(),
            createdByAgentId: ceo.id,
            updatedAt: now,
          }).onConflictDoNothing();
        }
      }
      console.log(`[Business] Auto-generated ${entries.length} org memory entries for ${orgData.name}`);
    }
  } catch (e: any) {
    console.error('[Business] generateOrgMemory error:', e.message);
  }
}

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

You can also generate or update system prompts for your team agents. When you want to set a system prompt for an agent, output:
<system_prompt agent_name="AgentName">
The system prompt content here...
</system_prompt>

Analyze the situation and respond to: ${userInput || 'Please analyze our current organizational performance and recommend improvements.'}`;

    // Check if this is the first CEO run (no previous runs for this CEO)
    const ceoRunCount = orgRuns.filter((r) => r.agentId === ceoAgent.id).length;
    const isFirstRun = ceoRunCount === 0;

    // On first run, ask CEO to also generate system prompts for all agents
    let actualInput = userInput || 'Analyze organizational performance and recommend improvements.';
    if (isFirstRun && teamAgents.length > 0) {
      actualInput += '\n\nIMPORTANT: This is your first run. Please also generate appropriate system prompts for each team member using <system_prompt agent_name="..."> blocks. Each system prompt should define the agent\'s personality, capabilities, and behavioral guidelines aligned with our organization\'s mission and goals.';
    }

    // Use callAI directly — works with any available API key (Anthropic or OpenAI),
    // independent of the CEO agent's stored type so there's no SDK mismatch error.
    const ceoOutput = await callAI(
      ceoSystemPrompt,
      actualInput,
    );

    // Parse any <proposal> blocks the CEO produced and save them
    const proposalRegex = /<proposal>([\s\S]*?)<\/proposal>/g;
    let match;
    while ((match = proposalRegex.exec(ceoOutput)) !== null) {
      try {
        const parsed = JSON.parse(match[1].trim());
        await db.insert(proposals).values({
          id: uuidv4(),
          organizationId: orgId,
          proposedByAgentId: ceoAgent.id,
          type: parsed.type || 'strategy',
          title: parsed.title || 'Untitled Proposal',
          details: parsed,
          reasoning: parsed.reasoning || null,
          estimatedCostUsd: parsed.estimatedMonthlyCostUsd || parsed.estimatedCostUsd || null,
          status: 'pending',
          createdAt: new Date().toISOString(),
        });
      } catch {
        // Malformed JSON — skip
      }
    }

    // Parse any <system_prompt> blocks and update agent configs
    const sysPromptRegex = /<system_prompt\s+agent_name="([^"]+)">([\s\S]*?)<\/system_prompt>/g;
    let sysMatch;
    let promptsUpdated = 0;
    while ((sysMatch = sysPromptRegex.exec(ceoOutput)) !== null) {
      const agentName = sysMatch[1].trim();
      const sysPromptContent = sysMatch[2].trim();
      const targetAgent = orgAgents.find((a) => a.name.toLowerCase() === agentName.toLowerCase());
      if (targetAgent) {
        const updatedConfig = { ...(targetAgent.config as Record<string, unknown>), systemPrompt: sysPromptContent };
        await db.update(agents)
          .set({ config: updatedConfig, updatedAt: new Date().toISOString() })
          .where(eq(agents.id, targetAgent.id));
        promptsUpdated++;
      }
    }

    res.json({ data: { success: true, output: ceoOutput, tokensUsed: 0, costUsd: 0, promptsUpdated } });
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

// ─── PATCH /api/business/organizations/:id/status ────────────────────────────
// Start/Pause an organization

router.patch('/organizations/:id/status', async (req: Request, res: Response) => {
  try {
    const { status } = req.body as { status: string };
    if (!['active', 'paused'].includes(status)) {
      res.status(400).json({ error: 'status must be "active" or "paused"' });
      return;
    }

    const [org] = await db.select().from(organizations).where(eq(organizations.id, req.params.id));
    if (!org) { res.status(404).json({ error: 'Organization not found' }); return; }

    await db.update(organizations)
      .set({ status, updatedAt: new Date().toISOString() })
      .where(eq(organizations.id, req.params.id));

    res.json({ data: { ...org, status } });
  } catch (err: any) {
    console.error('[Business] PATCH /organizations/:id/status error:', err);
    res.status(500).json({ error: 'Failed to update organization status' });
  }
});

// ─── DELETE /api/business/organizations/:id ──────────────────────────────────
router.delete('/organizations/:id', async (req: Request, res: Response) => {
  try {
    const orgId = req.params.id;
    const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
    if (!org) {
      res.status(404).json({ error: 'Organization not found' });
      return;
    }
    // Unlink agents from org (don't delete them, just detach)
    await db.update(agents).set({ organizationId: null, parentAgentId: null }).where(eq(agents.organizationId, orgId));
    // Delete org (cascading deletes shared memory and proposals)
    await db.delete(organizations).where(eq(organizations.id, orgId));
    res.json({ success: true, message: `Organization "${org.name}" deleted` });
  } catch (err: any) {
    console.error('[Business] DELETE /organizations/:id error:', err);
    res.status(500).json({ error: 'Failed to delete organization', details: err.message });
  }
});

// ─── Shared Memory — organization-wide key-value (Paperclip-style hub) ───────

router.get('/organizations/:id/memory', async (req: Request, res: Response) => {
  try {
    const memories = await db.select().from(sharedMemory)
      .where(eq(sharedMemory.organizationId, req.params.id));
    res.json({ data: memories });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch shared memory' });
  }
});

router.post('/organizations/:id/memory', async (req: Request, res: Response) => {
  try {
    const { key, value, agentId } = req.body as { key: string; value: string; agentId?: string };
    if (!key || value === undefined) {
      res.status(400).json({ error: 'key and value are required' });
      return;
    }

    const existing = await db.select().from(sharedMemory)
      .where(and(eq(sharedMemory.organizationId, req.params.id), eq(sharedMemory.key, key)));

    if (existing.length > 0) {
      await db.update(sharedMemory)
        .set({ value, createdByAgentId: agentId || null, updatedAt: new Date().toISOString() })
        .where(eq(sharedMemory.id, existing[0].id));
    } else {
      await db.insert(sharedMemory).values({
        organizationId: req.params.id,
        key,
        value,
        createdByAgentId: agentId || null,
      });
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to save shared memory' });
  }
});

router.delete('/organizations/:id/memory/:key', async (req: Request, res: Response) => {
  try {
    await db.delete(sharedMemory)
      .where(and(
        eq(sharedMemory.organizationId, req.params.id),
        eq(sharedMemory.key, decodeURIComponent(req.params.key)),
      ));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to delete shared memory' });
  }
});

export default router;
