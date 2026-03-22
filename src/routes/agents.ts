import { Router, Request, Response } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import { z } from 'zod';
import { db } from '../db';
import { agents, runs, schedules, agentCalls, agentMemory } from '../db/schema';
import { eq, desc, and } from 'drizzle-orm';
import { executeAgent } from '../services/executor';
import { checkBudget, recordSpend } from '../services/budget';
import { scheduleAgent, removeSchedule } from '../services/scheduler';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import memoryRouter from './memory';

const execAsync = promisify(exec);

const router = Router();

const createAgentSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  type: z.enum(['http', 'claude', 'openai', 'bash', 'claude-code', 'openai-codex', 'cursor', 'openclaw', 'a2a', 'internal', 'mcp']),
  config: z.record(z.unknown()).default({}),
  status: z.enum(['active', 'paused', 'error']).default('active'),
  role: z.enum(['ceo', 'manager', 'worker', 'specialist']).optional(),
  jobDescription: z.string().optional(),
  parentAgentId: z.string().optional(),
  organizationId: z.string().optional(),
});

const updateAgentSchema = createAgentSchema.partial();

// ─── POST /api/agents/test-cli ────────────────────────────────────────────────
// Tests whether a local CLI tool (claude, codex, cursor) is installed and returns version.
// Must be placed BEFORE /:id routes to avoid routing conflicts.

router.post('/test-cli', async (req: Request, res: Response) => {
  try {
    const { type } = req.body as { type: string };
    const cliCommands: Record<string, string> = {
      'claude-code':    'claude --version',
      'openai-codex':   'codex --version',
      'cursor':         'cursor --version',
    };
    const installHints: Record<string, string> = {
      'claude-code':  'npm install -g @anthropic-ai/claude-code',
      'openai-codex': 'npm install -g @openai/codex',
      'cursor':       'Install from https://cursor.com',
    };
    const cmd = cliCommands[type];
    if (!cmd) {
      res.status(400).json({ error: `Unknown CLI type: ${type}` });
      return;
    }
    try {
      const { stdout, stderr } = await execAsync(cmd, { timeout: 6000 });
      const version = (stdout || stderr).trim().split('\n')[0] || 'installed';
      res.json({ installed: true, version });
    } catch {
      res.json({ installed: false, error: `Not found. Install: ${installHints[type]}`, hint: installHints[type] });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/agents/test-api-key ───────────────────────────────────────────
// Verifies an API key by making a minimal real API call.

router.post('/test-api-key', async (req: Request, res: Response) => {
  try {
    const { provider, apiKey } = req.body as { provider: string; apiKey: string };
    if (!provider || !apiKey) {
      res.status(400).json({ error: 'provider and apiKey are required' });
      return;
    }

    if (provider === 'anthropic') {
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic.default({ apiKey });
      const resp = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'Hi' }],
      });
      res.json({ valid: true, model: resp.model });
    } else if (provider === 'openai') {
      const OpenAI = require('openai');
      const client = new OpenAI.default({ apiKey });
      const models = await client.models.list();
      const count = models.data?.length || 0;
      res.json({ valid: true, modelCount: count });
    } else {
      res.status(400).json({ error: `Unknown provider: ${provider}` });
    }
  } catch (err: any) {
    // API errors (invalid key, etc.) come here
    const msg = err?.error?.message || err?.message || 'Invalid API key';
    res.json({ valid: false, error: msg });
  }
});

// ─── POST /api/agents/test-http-endpoint ─────────────────────────────────────
// Checks whether an HTTP endpoint is reachable.

router.post('/test-http-endpoint', async (req: Request, res: Response) => {
  try {
    const { url, headers } = req.body as { url: string; headers?: Record<string, string> };
    if (!url) {
      res.status(400).json({ error: 'url is required' });
      return;
    }
    try {
      const resp = await axios.request({
        method: 'HEAD',
        url,
        headers: headers || {},
        timeout: 6000,
        validateStatus: () => true, // never throw on HTTP status
      });
      res.json({ reachable: resp.status < 500, status: resp.status, statusText: resp.statusText });
    } catch (err: any) {
      res.json({ reachable: false, error: err.message });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/agents
router.get('/', async (req: Request, res: Response) => {
  try {
    const organizationId = req.query.organizationId as string | undefined;
    const role = req.query.role as string | undefined;

    let allAgents = await db.select().from(agents).orderBy(agents.createdAt);
    type Agent = typeof allAgents[number];

    if (organizationId) {
      allAgents = allAgents.filter((a: Agent) => a.organizationId === organizationId);
    }
    if (role) {
      allAgents = allAgents.filter((a: Agent) => a.role === role);
    }

    // Enrich with parent name and children count
    const agentMap = new Map<string, Agent>(allAgents.map((a: Agent) => [a.id, a]));
    const enriched = allAgents.map((a: Agent) => {
      const parentAgent = a.parentAgentId ? agentMap.get(a.parentAgentId) : null;
      const childrenCount = allAgents.filter((c: Agent) => c.parentAgentId === a.id).length;
      return {
        ...a,
        parentAgentName: parentAgent?.name || null,
        childrenCount,
      };
    });

    res.json({ data: enriched, total: enriched.length });
  } catch (err) {
    console.error('[Agents] GET / error:', err);
    res.status(500).json({ error: 'Failed to fetch agents' });
  }
});

// GET /api/agents/:id
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const [agent] = await db.select().from(agents).where(eq(agents.id, req.params.id));
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    // Enrich with parent agent info
    let parentAgent = null;
    if (agent.parentAgentId) {
      const [parent] = await db.select().from(agents).where(eq(agents.id, agent.parentAgentId));
      parentAgent = parent || null;
    }

    const children = await db.select().from(agents).where(eq(agents.parentAgentId, agent.id));

    res.json({ data: { ...agent, parentAgent, children } });
  } catch (err) {
    console.error('[Agents] GET /:id error:', err);
    res.status(500).json({ error: 'Failed to fetch agent' });
  }
});

// POST /api/agents
router.post('/', async (req: Request, res: Response) => {
  try {
    const parsed = createAgentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      return;
    }

    const { name, description, type, config, status, role, jobDescription, parentAgentId, organizationId } = parsed.data;
    const now = new Date().toISOString();

    const [newAgent] = await db
      .insert(agents)
      .values({
        id: uuidv4(),
        name,
        description: description || null,
        type,
        config,
        status,
        role: role || 'worker',
        jobDescription: jobDescription || null,
        parentAgentId: parentAgentId || null,
        organizationId: organizationId || null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    res.status(201).json({ data: newAgent });
  } catch (err) {
    console.error('[Agents] POST / error:', err);
    res.status(500).json({ error: 'Failed to create agent' });
  }
});

// PUT /api/agents/:id
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const parsed = updateAgentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() });
      return;
    }

    const [existing] = await db.select().from(agents).where(eq(agents.id, req.params.id));
    if (!existing) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const updateData: Record<string, unknown> = { ...parsed.data, updatedAt: new Date().toISOString() };

    const [updated] = await db
      .update(agents)
      .set(updateData)
      .where(eq(agents.id, req.params.id))
      .returning();

    // If status changed to paused/active, update schedules
    if (parsed.data.status === 'paused') {
      const agentSchedules = await db.select().from(schedules).where(eq(schedules.agentId, req.params.id));
      for (const schedule of agentSchedules) {
        await removeSchedule(schedule.id);
      }
    } else if (parsed.data.status === 'active' && existing.status !== 'active') {
      const agentSchedules = await db
        .select()
        .from(schedules)
        .where(eq(schedules.agentId, req.params.id));
      for (const schedule of agentSchedules) {
        if (schedule.enabled) {
          await scheduleAgent({
            id: schedule.id,
            agentId: schedule.agentId,
            cronExpression: schedule.cronExpression,
            enabled: true,
          });
        }
      }
    }

    res.json({ data: updated });
  } catch (err) {
    console.error('[Agents] PUT /:id error:', err);
    res.status(500).json({ error: 'Failed to update agent' });
  }
});

// DELETE /api/agents/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const [existing] = await db.select().from(agents).where(eq(agents.id, req.params.id));
    if (!existing) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    // Remove all schedules from queue first
    const agentSchedules = await db.select().from(schedules).where(eq(schedules.agentId, req.params.id));
    for (const schedule of agentSchedules) {
      await removeSchedule(schedule.id);
    }

    await db.delete(agents).where(eq(agents.id, req.params.id));

    res.json({ message: 'Agent deleted successfully' });
  } catch (err) {
    console.error('[Agents] DELETE /:id error:', err);
    res.status(500).json({ error: 'Failed to delete agent' });
  }
});

// POST /api/agents/:id/run
router.post('/:id/run', async (req: Request, res: Response) => {
  try {
    const [agent] = await db.select().from(agents).where(eq(agents.id, req.params.id));
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    if (agent.status === 'paused') {
      res.status(400).json({ error: 'Agent is paused' });
      return;
    }

    const budgetCheck = await checkBudget(agent.id);
    if (!budgetCheck.allowed) {
      res.status(429).json({
        error: 'Budget exceeded',
        remaining: budgetCheck.remaining,
        limit: budgetCheck.limit,
        currentSpend: budgetCheck.currentSpend,
      });
      return;
    }

    const input = req.body.input || req.body || {};
    const result = await executeAgent(agent.id, input, 'api');

    if (result.costUsd > 0) {
      await recordSpend(agent.id, result.costUsd);
    }

    res.json({ data: result });
  } catch (err) {
    console.error('[Agents] POST /:id/run error:', err);
    res.status(500).json({ error: 'Failed to run agent' });
  }
});

// GET /api/agents/:id/runs
router.get('/:id/runs', async (req: Request, res: Response) => {
  try {
    const [agent] = await db.select().from(agents).where(eq(agents.id, req.params.id));
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const limit = Math.min(parseInt(req.query.limit as string || '50', 10), 200);
    const offset = parseInt(req.query.offset as string || '0', 10);

    const agentRuns = await db
      .select()
      .from(runs)
      .where(eq(runs.agentId, req.params.id))
      .orderBy(desc(runs.createdAt))
      .limit(limit)
      .offset(offset);

    res.json({ data: agentRuns, total: agentRuns.length, limit, offset });
  } catch (err) {
    console.error('[Agents] GET /:id/runs error:', err);
    res.status(500).json({ error: 'Failed to fetch runs' });
  }
});

// GET /api/agents/:id/memory
router.get('/:id/memory', async (req: Request, res: Response) => {
  try {
    const agentId = req.params.id;
    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const memories = await db.select().from(agentMemory).where(eq(agentMemory.agentId, agentId));
    res.json({ data: memories, total: memories.length });
  } catch (err: any) {
    console.error('[Agents] GET /:id/memory error:', err);
    res.status(500).json({ error: 'Failed to fetch agent memory' });
  }
});

// POST /api/agents/:id/memory
router.post('/:id/memory', async (req: Request, res: Response) => {
  try {
    const agentId = req.params.id;
    const { key, value } = req.body;

    if (!key || value === undefined) {
      res.status(400).json({ error: 'key and value are required' });
      return;
    }

    const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const now = new Date().toISOString();
    const existing = await db.select().from(agentMemory)
      .where(and(eq(agentMemory.agentId, agentId), eq(agentMemory.key, key)));

    if (existing.length > 0) {
      const [updated] = await db.update(agentMemory)
        .set({ value: String(value), updatedAt: now })
        .where(and(eq(agentMemory.agentId, agentId), eq(agentMemory.key, key)))
        .returning();
      res.json({ data: updated });
    } else {
      const [created] = await db.insert(agentMemory).values({
        id: uuidv4(),
        agentId,
        key,
        value: String(value),
        updatedAt: now,
      }).returning();
      res.status(201).json({ data: created });
    }
  } catch (err: any) {
    console.error('[Agents] POST /:id/memory error:', err);
    res.status(500).json({ error: 'Failed to set memory' });
  }
});

// DELETE /api/agents/:id/memory/:key
router.delete('/:id/memory/:key', async (req: Request, res: Response) => {
  try {
    const agentId = req.params.id;
    const key = req.params.key;

    const existing = await db.select().from(agentMemory)
      .where(and(eq(agentMemory.agentId, agentId), eq(agentMemory.key, key)));

    if (existing.length === 0) {
      res.status(404).json({ error: 'Memory key not found' });
      return;
    }

    await db.delete(agentMemory)
      .where(and(eq(agentMemory.agentId, agentId), eq(agentMemory.key, key)));

    res.json({ message: 'Memory key deleted' });
  } catch (err: any) {
    console.error('[Agents] DELETE /:id/memory/:key error:', err);
    res.status(500).json({ error: 'Failed to delete memory key' });
  }
});

// POST /api/agents/:id/delegate
router.post('/:id/delegate', async (req: Request, res: Response) => {
  try {
    const callerAgentId = req.params.id;
    const { targetAgentId, input, context } = req.body;

    if (!targetAgentId) {
      res.status(400).json({ error: 'targetAgentId is required' });
      return;
    }

    const [callerAgent] = await db.select().from(agents).where(eq(agents.id, callerAgentId));
    if (!callerAgent) {
      res.status(404).json({ error: 'Caller agent not found' });
      return;
    }

    const [targetAgent] = await db.select().from(agents).where(eq(agents.id, targetAgentId));
    if (!targetAgent) {
      res.status(404).json({ error: 'Target agent not found' });
      return;
    }

    if (targetAgent.status === 'paused') {
      res.status(400).json({ error: 'Target agent is paused' });
      return;
    }

    const callId = uuidv4();
    const now = new Date().toISOString();

    // Create agent_call record
    await db.insert(agentCalls).values({
      id: callId,
      callerAgentId,
      calleeAgentId: targetAgentId,
      input: input || null,
      status: 'running',
      costUsd: 0,
      createdAt: now,
    });

    // Execute the target agent
    const delegationInput = context
      ? { ...input, _delegationContext: context, _delegatedBy: callerAgent.name }
      : { ...input, _delegatedBy: callerAgent.name };

    const result = await executeAgent(targetAgentId, delegationInput, 'api');

    // Update agent_call record
    await db.update(agentCalls)
      .set({
        output: result.output as any,
        status: result.success ? 'success' : 'failed',
        costUsd: result.costUsd,
        completedAt: new Date().toISOString(),
      })
      .where(eq(agentCalls.id, callId));

    if (result.costUsd > 0) {
      await recordSpend(targetAgentId, result.costUsd);
    }

    res.json({ data: result, callId });
  } catch (err: any) {
    console.error('[Agents] POST /:id/delegate error:', err);
    res.status(500).json({ error: 'Failed to delegate task', details: err.message });
  }
});

// ─── GET /api/agents/:id/hub-prompt ──────────────────────────────────────────
// Returns a complete hub connection system prompt — paste into any agent (OpenClaw, etc.)

router.get('/:id/hub-prompt', async (req: Request, res: Response) => {
  try {
    const [agent] = await db.select().from(agents).where(eq(agents.id, req.params.id));
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }

    const hubHost = process.env.HUB_HOST || 'localhost';
    const hubPort = process.env.PORT || '3001';
    const hubBase = `http://${hubHost}:${hubPort}/api`;

    const prompt = `## AgentHub — System Context for ${agent.name}

You are **${agent.name}**, a ${agent.role || 'worker'} agent connected to AgentHub.
${agent.jobDescription ? `\nYour task: ${agent.jobDescription}` : ''}
${agent.description ? `\nDescription: ${agent.description}` : ''}

## Your Connection Details
- Hub-URL: ${hubBase}
- Your Agent-ID: \`${agent.id}\`

## How AgentHub contacts you (for OpenClaw)
AgentHub sends you tasks directly via the OpenClaw API:

\`\`\`
POST http://localhost:18789/api/agent/run
Content-Type: application/json

{
  "prompt": "<your system context + task>",
  "model": "gpt"
}
\`\`\`

The \`prompt\` field contains your complete context (who you are, what your task is)
as well as the current task description. Execute the task and return the result.

## Report Results (optional)
If your task contains a runId, report the result back:

\`\`\`
POST ${hubBase}/agents/${agent.id}/push-result
Content-Type: application/json

{
  "output": "<your result>",
  "runId": "<run-id from the context>",
  "success": true
}
\`\`\`

## Behavior Rules
- Stay focused on your role and task description.
- After completing each task, summarize what you have done.
- If you need to delegate, clearly mention the agent name.
- Keep responses concise and structured.

---
*Paste this text into OpenClaw's SOUL.md or system configuration.*`;

    res.json({ data: { agentId: agent.id, agentName: agent.name, prompt } });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to generate hub prompt', details: err.message });
  }
});

// ─── GET /api/agents/:id/next-task ───────────────────────────────────────────
// External agents poll this to pick up pending work

router.get('/:id/next-task', async (req: Request, res: Response) => {
  try {
    const [agent] = await db.select().from(agents).where(eq(agents.id, req.params.id));
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }

    // Find oldest pending run for this agent
    const [pendingRun] = await db
      .select()
      .from(runs)
      .where(and(eq(runs.agentId, req.params.id), eq(runs.status, 'pending')))
      .orderBy(runs.createdAt)
      .limit(1);

    if (!pendingRun) {
      res.json({ task: null });
      return;
    }

    // Mark as running
    await db.update(runs)
      .set({ status: 'running', startedAt: new Date().toISOString() })
      .where(eq(runs.id, pendingRun.id));

    res.json({
      task: {
        runId: pendingRun.id,
        input: pendingRun.input,
        triggeredBy: pendingRun.triggeredBy,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to fetch next task', details: err.message });
  }
});

// ─── POST /api/agents/:id/push-result ────────────────────────────────────────
// External agents (OpenClaw, remote Claude Code, etc.) push completed results

router.post('/:id/push-result', async (req: Request, res: Response) => {
  try {
    const [agent] = await db.select().from(agents).where(eq(agents.id, req.params.id));
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }

    const { output, runId, success = true, tokensUsed = 0, costUsd = 0, error: errMsg } = req.body;
    const now = new Date().toISOString();

    if (runId) {
      // Update existing run
      await db.update(runs)
        .set({
          status: success ? 'success' : 'failed',
          completedAt: now,
          output: typeof output === 'string' ? { text: output } : output,
          tokensUsed: tokensUsed || 0,
          costUsd: costUsd || 0,
          error: errMsg || null,
        })
        .where(eq(runs.id, runId));
    } else {
      // Create a new completed run record
      await db.insert(runs).values({
        id: uuidv4(),
        agentId: agent.id,
        status: success ? 'success' : 'failed',
        startedAt: now,
        completedAt: now,
        output: typeof output === 'string' ? { text: output } : (output || null),
        tokensUsed: tokensUsed || 0,
        costUsd: costUsd || 0,
        triggeredBy: 'api',
        error: errMsg || null,
        createdAt: now,
      });
    }

    if (costUsd > 0) {
      await recordSpend(agent.id, costUsd);
    }

    res.json({ success: true, message: 'Result received' });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to record result', details: err.message });
  }
});

// ─── GET /api/agents/:id/connector-script ────────────────────────────────────
// Returns a bash script to run on a remote machine for remote Claude Code / any CLI agent

router.get('/:id/connector-script', async (req: Request, res: Response) => {
  try {
    const [agent] = await db.select().from(agents).where(eq(agents.id, req.params.id));
    if (!agent) { res.status(404).json({ error: 'Agent not found' }); return; }

    const hubHost = process.env.HUB_HOST || 'localhost';
    const hubPort = process.env.PORT || '3001';
    const hubBase = `http://${hubHost}:${hubPort}/api`;
    const config = (agent.config as Record<string, unknown>) || {};
    const model = (config.model as string) || 'claude-sonnet-4-6';
    const maxTurns = (config.maxTurns as number) || 5;

    const script = `#!/usr/bin/env bash
# AgentHub Connector Script — ${agent.name}
# Agent ID: ${agent.id}
# Generated: ${new Date().toISOString()}
#
# USAGE:
#   chmod +x connector.sh
#   HUB_API_KEY=your-key ./connector.sh
#
# REQUIREMENTS:
#   - claude CLI installed (npm install -g @anthropic-ai/claude-code)
#   - curl, jq

set -euo pipefail

AGENT_ID="${agent.id}"
HUB_BASE="${hubBase}"
API_KEY="\${HUB_API_KEY:-}"
POLL_INTERVAL=\${POLL_INTERVAL:-10}  # seconds between polls
MODEL="${model}"
MAX_TURNS="${maxTurns}"

if [ -z "\$API_KEY" ]; then
  echo "ERROR: Set HUB_API_KEY environment variable"
  exit 1
fi

echo "AgentHub Connector — ${agent.name} (\$AGENT_ID)"
echo "Hub: \$HUB_BASE"
echo "Polling every \${POLL_INTERVAL}s..."
echo ""

while true; do
  # Poll for next task
  RESPONSE=\$(curl -sf \\
    -H "X-API-Key: \$API_KEY" \\
    "\$HUB_BASE/agents/\$AGENT_ID/next-task" || echo '{"task":null}')

  TASK=\$(echo "\$RESPONSE" | jq -r '.task // empty')

  if [ -n "\$TASK" ] && [ "\$TASK" != "null" ]; then
    RUN_ID=\$(echo "\$TASK" | jq -r '.runId // empty')
    INPUT=\$(echo "\$TASK" | jq -r '.input // empty')

    echo "[\$(date '+%H:%M:%S')] Task received (run: \$RUN_ID)"
    echo "Input: \$INPUT"
    echo ""

    # Run claude CLI
    if OUTPUT=\$(claude -p "\$INPUT" --output-format json --max-turns \$MAX_TURNS --model \$MODEL 2>&1); then
      TEXT=\$(echo "\$OUTPUT" | jq -r '.result // .output // .' 2>/dev/null || echo "\$OUTPUT")
      TOKENS=\$(echo "\$OUTPUT" | jq -r '(.usage.input_tokens // 0) + (.usage.output_tokens // 0)' 2>/dev/null || echo "0")
      echo "Completed. Tokens: \$TOKENS"

      curl -sf -X POST \\
        -H "X-API-Key: \$API_KEY" \\
        -H "Content-Type: application/json" \\
        -d "{\\"output\\": \$(echo "\$TEXT" | jq -Rs .), \\"runId\\": \\"\$RUN_ID\\", \\"success\\": true, \\"tokensUsed\\": \$TOKENS}" \\
        "\$HUB_BASE/agents/\$AGENT_ID/push-result" > /dev/null
      echo "Result pushed to hub."
    else
      ERR="\$OUTPUT"
      echo "ERROR: \$ERR"
      curl -sf -X POST \\
        -H "X-API-Key: \$API_KEY" \\
        -H "Content-Type: application/json" \\
        -d "{\\"output\\": null, \\"runId\\": \\"\$RUN_ID\\", \\"success\\": false, \\"error\\": \$(echo "\$ERR" | jq -Rs .)}" \\
        "\$HUB_BASE/agents/\$AGENT_ID/push-result" > /dev/null
    fi
    echo ""
  fi

  sleep \$POLL_INTERVAL
done`;

    // Return as plain text for download
    if (req.query.download === 'true') {
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', `attachment; filename="agenthub-connector-${agent.name.toLowerCase().replace(/\s+/g, '-')}.sh"`);
      res.send(script);
    } else {
      res.json({ data: { agentId: agent.id, agentName: agent.name, script } });
    }
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to generate connector script', details: err.message });
  }
});

// ─── GET /api/agents/:id/soul-md ─────────────────────────────────────────────

router.get('/:id/soul-md', async (req: Request, res: Response) => {
  try {
    const [agent] = await db.select().from(agents).where(eq(agents.id, req.params.id));
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const config = (agent.config as Record<string, unknown>) || {};
    const host = (config.host as string) || 'localhost';
    const port = (config.port as number) || 18789;
    const hubPort = process.env.PORT || 3001;
    const hubHost = process.env.HUB_HOST || 'localhost';

    const ocModel = (config.model as string) && config.model !== 'auto' ? config.model : undefined;
    const connectionType = (config.connectionType as string) || 'responses';
    const gatewayToken   = config.token as string | undefined;
    const toolName       = (config.toolName as string) || 'run';
    const webhookPath    = ((config.webhookPath as string) || '/hooks/agenthub').replace(/^([^/])/, '/$1');
    const ocAgentId      = config.ocAgentId as string | undefined;

    // Build connection-type-specific "how AgentHub calls you" snippet
    let incomingCallSnippet: string;
    let incomingCallNote: string;
    switch (connectionType) {
      case 'cli':
        incomingCallSnippet = `openclaw agent --agent ${ocAgentId || '<your-agent-id>'} --prompt "<task>"`;
        incomingCallNote = 'AgentHub calls the local openclaw CLI (only on the same machine).';
        break;
      case 'webhook':
        incomingCallSnippet = [
          `POST http://${host}:${port}${webhookPath}`,
          'Content-Type: application/json',
          gatewayToken ? `Authorization: Bearer ${gatewayToken}` : '# Authorization: Bearer <webhook-token>',
          '',
          '{',
          '  "prompt": "<system context>\\n\\n<task description>"',
          '}',
        ].join('\n');
        incomingCallNote = `Webhook trigger (hooks.enabled=true in openclaw.yaml). Path: ${webhookPath}`;
        break;
      case 'tools-invoke':
        incomingCallSnippet = [
          `POST http://${host}:${port}/tools/invoke`,
          'Content-Type: application/json',
          gatewayToken ? `Authorization: Bearer ${gatewayToken}` : '# Authorization: Bearer <gateway-token>',
          '',
          '{',
          `  "tool": "${toolName}",`,
          '  "input": { "prompt": "<system context>\\n\\n<task description>" }',
          '}',
        ].join('\n');
        incomingCallNote = 'Tools-Invoke API (always active). No openResponses.enabled required.';
        break;
      default: // 'responses'
        incomingCallSnippet = [
          `POST http://${host}:${port}/v1/responses`,
          'Content-Type: application/json',
          gatewayToken ? `Authorization: Bearer ${gatewayToken}` : '# Authorization: Bearer <gateway-token>',
          '',
          '{',
          '  "input": "<system context>\\n\\n<task description>"' + (ocModel ? `,\n  "model": "${ocModel}"` : ''),
          '}',
        ].join('\n');
        incomingCallNote = 'OpenResponses API (gateway.openResponses.enabled=true required in openclaw.yaml).';
    }

    const soulMd = `# ${agent.name} — SOUL.md

## Identity
You are **${agent.name}**, a ${agent.role || 'worker'} agent.
${agent.jobDescription ? `\nYour task: ${agent.jobDescription}` : ''}
${agent.description ? `\nAbout you: ${agent.description}` : ''}

## AgentHub Connection
Your orchestration hub is running at: **http://${hubHost}:${hubPort}**
Your Agent-ID: \`${agent.id}\`
Connection mode: **${connectionType}**

### How AgentHub contacts you
${incomingCallNote}

\`\`\`
${incomingCallSnippet}
\`\`\`

### Report Results
If your task contains a runId, send the result back:
\`\`\`
POST http://${hubHost}:${hubPort}/api/agents/${agent.id}/push-result
Content-Type: application/json

{
  "output": "your result",
  "runId": "<the-run-id>",
  "success": true
}
\`\`\`

### Poll for pending tasks (optional)
\`\`\`
GET http://${hubHost}:${hubPort}/api/agents/${agent.id}/next-task
\`\`\`

## Behavior Rules
- You are part of a larger AI organization. Stay focused on your role.
- When you complete a task, always summarize what you have done.
- If you need to delegate, mention it clearly so the hub can forward it.
- Keep responses concise and structured.
`;

    const heartbeatMd = `# ${agent.name} — HEARTBEAT.md

## Heartbeat Protocol
Connection mode: **${connectionType}**
${incomingCallNote}

### Incoming Request (how AgentHub calls you)
\`\`\`
${incomingCallSnippet}
\`\`\`

### What you should do
1. Process the incoming prompt — it contains system context + task description
2. Execute the task using your tools and capabilities
3. Send your result back to the hub (if runId is present):

\`\`\`
POST http://${hubHost}:${hubPort}/api/agents/${agent.id}/push-result
Content-Type: application/json

{
  "output": "Task completed: ...",
  "runId": "<optional-run-id>",
  "success": true
}
\`\`\`

### Health Check
\`\`\`
GET http://${host}:${port}/api/health
\`\`\`
-> should return 200 OK
`;

    // BOOTSTRAP.md — the "invite prompt" (Paperclip-style)
    // Placed in ~/.openclaw/agents/<name>/BOOTSTRAP.md
    // OpenClaw reads it once on first boot, then the user deletes it.
    const bootstrapMd = `# BOOTSTRAP.md — AgentHub Onboarding for ${agent.name}

> Read this file completely once. Then you can delete it (\`rm BOOTSTRAP.md\`).

## Who are you?
You are **${agent.name}**, a ${agent.role || 'worker'} agent in AgentHub.${agent.jobDescription ? `\nYour task: ${agent.jobDescription}` : ''}${agent.description ? `\nDescription: ${agent.description}` : ''}

## Your Hub
AgentHub is your orchestration hub — it assigns tasks to you, tracks your costs and stores your results.

- Hub-URL: http://${hubHost}:${hubPort}
- Your Agent-ID: \`${agent.id}\`
- Connection mode: **${connectionType}**

## How you receive tasks
${incomingCallNote}

\`\`\`
${incomingCallSnippet}
\`\`\`

The included prompt field contains everything you need to know: who you are, what the task is, and optionally a runId.

## How to report results

\`\`\`
POST http://${hubHost}:${hubPort}/api/agents/${agent.id}/push-result
Content-Type: application/json

{
  "output": "Task completed: ...",
  "runId": "<runId from the prompt, if present>",
  "success": true
}
\`\`\`

## Poll for next task (optional)

\`\`\`
GET http://${hubHost}:${hubPort}/api/agents/${agent.id}/next-task
\`\`\`

## Your Workspace Files
- **SOUL.md** — Your identity, values and behavior rules (loaded on every start)
- **HEARTBEAT.md** — Protocol for incoming hub requests
- **BOOTSTRAP.md** — This file (one-time, delete afterwards)

## Check OpenClaw Configuration
${connectionType === 'responses' ? `Your \`openclaw.yaml\` must contain:\n\`\`\`yaml\ngateway:\n  openResponses:\n    enabled: true\n  auth:\n    token: "${gatewayToken || '<your-token>'}"\n\`\`\`` : ''}${connectionType === 'webhook' ? `Your \`openclaw.yaml\` must contain:\n\`\`\`yaml\nhooks:\n  enabled: true\n  token: "${gatewayToken || '<your-webhook-token>'}"\n\`\`\`` : ''}${connectionType === 'tools-invoke' ? 'Tools-Invoke is always active — no special configuration required.' : ''}${connectionType === 'cli' ? 'CLI mode: openclaw must be installed on the same machine.' : ''}

## Initial Task
Confirm your readiness with a short response and report it to the hub:

\`\`\`bash
curl -X POST http://${hubHost}:${hubPort}/api/agents/${agent.id}/push-result \\
  -H "Content-Type: application/json" \\
  -d '{"output": "Agent ${agent.name} ready. Connection mode: ${connectionType}. Waiting for tasks.", "success": true}'
\`\`\`

---
*Generated by AgentHub — ${new Date().toISOString()}*
`;

    // Support ?download=true for direct file download
    if (req.query.download === 'soul') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="SOUL.md"`);
      res.send(soulMd);
      return;
    }
    if (req.query.download === 'heartbeat') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="HEARTBEAT.md"`);
      res.send(heartbeatMd);
      return;
    }
    if (req.query.download === 'bootstrap') {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="BOOTSTRAP.md"`);
      res.send(bootstrapMd);
      return;
    }

    res.json({
      data: {
        agentId: agent.id,
        agentName: agent.name,
        soulMd,
        heartbeatMd,
        bootstrapMd,
      },
    });
  } catch (err: any) {
    console.error('[Agents] GET /:id/soul-md error:', err);
    res.status(500).json({ error: 'Failed to generate SOUL.md', details: err.message });
  }
});

// Mount memory/knowledge management sub-routes
router.use('/:id', memoryRouter);

export default router;
