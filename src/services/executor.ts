import 'dotenv/config';
import { exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import { db } from '../db';
import { runs, auditLogs, agents, agentMemory, proposals, schedules } from '../db/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

const execAsync = promisify(exec);

// ─── Model Pricing ────────────────────────────────────────────────────────────

const CLAUDE_MODELS: Record<string, { inputCostPerMTok: number; outputCostPerMTok: number }> = {
  'claude-opus-4-6': { inputCostPerMTok: 5, outputCostPerMTok: 25 },
  'claude-sonnet-4-6': { inputCostPerMTok: 3, outputCostPerMTok: 15 },
  'claude-haiku-4-5-20251001': { inputCostPerMTok: 1, outputCostPerMTok: 5 },
  'claude-haiku-4-5': { inputCostPerMTok: 1, outputCostPerMTok: 5 },
};

const OPENAI_MODELS: Record<string, { inputCostPerMTok: number; outputCostPerMTok: number }> = {
  'gpt-5.2': { inputCostPerMTok: 1.75, outputCostPerMTok: 14 },
  'gpt-5-mini': { inputCostPerMTok: 0.25, outputCostPerMTok: 2 },
  'gpt-5-nano': { inputCostPerMTok: 0.05, outputCostPerMTok: 0.4 },
  'gpt-4.1': { inputCostPerMTok: 2, outputCostPerMTok: 8 },
  'gpt-4o': { inputCostPerMTok: 2.5, outputCostPerMTok: 10 },
  'gpt-4o-mini': { inputCostPerMTok: 0.15, outputCostPerMTok: 0.6 },
  'o3': { inputCostPerMTok: 2, outputCostPerMTok: 8 },
  'o3-mini': { inputCostPerMTok: 1.1, outputCostPerMTok: 4.4 },
  'o4-mini': { inputCostPerMTok: 1.1, outputCostPerMTok: 4.4 },
};

// ─── Result Type ──────────────────────────────────────────────────────────────

export interface ExecutionResult {
  success: boolean;
  output: unknown;
  tokensUsed: number;
  costUsd: number;
  error?: string;
}

// ─── Memory Helpers ───────────────────────────────────────────────────────────

async function loadAgentMemoryContext(agentId: string): Promise<string> {
  try {
    const memories = await db.select().from(agentMemory).where(eq(agentMemory.agentId, agentId));
    if (memories.length === 0) return '';
    return '\n\nYour persistent memory:\n' + memories.map(m => `${m.key}: ${m.value}`).join('\n');
  } catch {
    return '';
  }
}

// ─── CEO Proposal Parser ──────────────────────────────────────────────────────

async function parseCeoProposals(
  output: unknown,
  agentRecord: { id: string; organizationId?: string | null; role?: string | null }
): Promise<void> {
  if (agentRecord.role !== 'ceo') return;

  const text = typeof output === 'string' ? output
    : (output as any)?.text
    ? (output as any).text
    : JSON.stringify(output);

  const proposalRegex = /<proposal>([\s\S]*?)<\/proposal>/g;
  let match;

  while ((match = proposalRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      await db.insert(proposals).values({
        id: uuidv4(),
        organizationId: agentRecord.organizationId || null,
        proposedByAgentId: agentRecord.id,
        type: parsed.type || 'strategy',
        title: parsed.title || 'Untitled Proposal',
        details: parsed,
        reasoning: parsed.reasoning || null,
        estimatedCostUsd: parsed.estimatedMonthlyCostUsd || parsed.estimatedCostUsd || null,
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
    } catch {
      // Malformed JSON in proposal block — skip silently
    }
  }
}

// ─── CEO Override Actions ────────────────────────────────────────────────────

async function applyCeoActions(
  output: unknown,
  agentRecord: { id: string; organizationId?: string | null; role?: string | null }
): Promise<{ agentUpdates: number; scheduleUpdates: number }> {
  if (agentRecord.role !== 'ceo') return { agentUpdates: 0, scheduleUpdates: 0 };

  const text = typeof output === 'string' ? output
    : (output as any)?.text ? (output as any).text : JSON.stringify(output);

  let agentUpdates = 0;
  let scheduleUpdates = 0;

  // Parse <agent_update> blocks — CEO can override agent instructions/config
  const agentUpdateRegex = /<agent_update>([\s\S]*?)<\/agent_update>/g;
  let match;
  while ((match = agentUpdateRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (!parsed.agentId) continue;

      const [existingAgent] = await db.select().from(agents).where(eq(agents.id, parsed.agentId));
      if (!existingAgent) continue;
      // Only allow CEO to update agents in the same organization
      if (existingAgent.organizationId !== agentRecord.organizationId) continue;

      const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      if (parsed.systemPrompt || parsed.system_prompt) {
        const currentConfig = (existingAgent.config as Record<string, unknown>) || {};
        updates.config = { ...currentConfig, system_prompt: parsed.systemPrompt || parsed.system_prompt };
      }
      if (parsed.jobDescription) updates.jobDescription = parsed.jobDescription;
      if (parsed.status && ['active', 'paused'].includes(parsed.status)) updates.status = parsed.status;

      await db.update(agents).set(updates).where(eq(agents.id, parsed.agentId));
      agentUpdates++;

      await db.insert(auditLogs).values({
        id: uuidv4(),
        agentId: parsed.agentId,
        eventType: 'ceo_agent_update',
        data: { updatedBy: agentRecord.id, changes: parsed },
        createdAt: new Date().toISOString(),
      });
    } catch {
      // Malformed JSON — skip
    }
  }

  // Parse <schedule_update> blocks — CEO can change schedules
  const scheduleUpdateRegex = /<schedule_update>([\s\S]*?)<\/schedule_update>/g;
  while ((match = scheduleUpdateRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (!parsed.agentId) continue;

      // Verify agent belongs to same org
      const [targetAgent] = await db.select().from(agents).where(eq(agents.id, parsed.agentId));
      if (!targetAgent || targetAgent.organizationId !== agentRecord.organizationId) continue;

      const existingSchedules = await db.select().from(schedules).where(eq(schedules.agentId, parsed.agentId));

      if (existingSchedules.length > 0 && parsed.cronExpression) {
        // Update existing schedule
        await db.update(schedules)
          .set({
            cronExpression: parsed.cronExpression,
            enabled: parsed.enabled !== false,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schedules.id, existingSchedules[0].id));
        scheduleUpdates++;
      } else if (parsed.cronExpression) {
        // Create new schedule
        await db.insert(schedules).values({
          id: uuidv4(),
          agentId: parsed.agentId,
          cronExpression: parsed.cronExpression,
          enabled: parsed.enabled !== false,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        scheduleUpdates++;
      }

      await db.insert(auditLogs).values({
        id: uuidv4(),
        agentId: parsed.agentId,
        eventType: 'ceo_schedule_update',
        data: { updatedBy: agentRecord.id, changes: parsed },
        createdAt: new Date().toISOString(),
      });
    } catch {
      // Malformed JSON — skip
    }
  }

  return { agentUpdates, scheduleUpdates };
}

// ─── HTTP Agent ───────────────────────────────────────────────────────────────

async function executeHttpAgent(config: Record<string, unknown>, input: unknown): Promise<ExecutionResult> {
  const endpoint = config.endpoint as string;
  if (!endpoint) {
    throw new Error('HTTP agent requires config.endpoint');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(config.headers as Record<string, string> || {}),
  };

  const response = await axios.post(endpoint, input, {
    headers,
    timeout: (config.timeout as number) || 30000,
    validateStatus: () => true,
  });

  if (response.status >= 400) {
    throw new Error(`HTTP agent returned status ${response.status}: ${JSON.stringify(response.data)}`);
  }

  return {
    success: true,
    output: response.data,
    tokensUsed: 0,
    costUsd: 0,
  };
}

// ─── Claude Agent ─────────────────────────────────────────────────────────────

async function executeClaudeAgent(config: Record<string, unknown>, input: unknown, memoryContext: string): Promise<ExecutionResult> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;

  const apiKey = (config.api_key_override as string) || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Claude agent requires ANTHROPIC_API_KEY or config.api_key_override');
  }

  const client = new Anthropic({ apiKey });
  const model = (config.model as string) || 'claude-sonnet-4-6';
  const baseSystemPrompt = (config.system_prompt as string) || (config.systemPrompt as string) || 'You are a helpful assistant.';
  const systemPrompt = baseSystemPrompt + memoryContext;

  const userMessage = typeof input === 'string' ? input : JSON.stringify(input);

  const response = await client.messages.create({
    model,
    max_tokens: (config.max_tokens as number) || 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  });

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const tokensUsed = inputTokens + outputTokens;

  const modelCosts = CLAUDE_MODELS[model as keyof typeof CLAUDE_MODELS] || { inputCostPerMTok: 3, outputCostPerMTok: 15 };
  const costUsd = (inputTokens / 1_000_000) * modelCosts.inputCostPerMTok + (outputTokens / 1_000_000) * modelCosts.outputCostPerMTok;

  const outputText = response.content
    .filter((block) => block.type === 'text')
    .map((block) => (block as { type: 'text'; text: string }).text)
    .join('');

  return {
    success: true,
    output: { text: outputText, stop_reason: response.stop_reason },
    tokensUsed,
    costUsd,
  };
}

// ─── OpenAI Agent ─────────────────────────────────────────────────────────────

async function executeOpenAIAgent(config: Record<string, unknown>, input: unknown, memoryContext: string): Promise<ExecutionResult> {
  const OpenAI = (await import('openai')).default;

  const apiKey = (config.api_key_override as string) || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OpenAI agent requires OPENAI_API_KEY or config.api_key_override');
  }

  const client = new OpenAI({ apiKey });
  const model = (config.model as string) || 'gpt-5.2';
  const baseSystemPrompt = (config.system_prompt as string) || (config.systemPrompt as string) || 'You are a helpful assistant.';
  const systemPrompt = baseSystemPrompt + memoryContext;

  const userMessage = typeof input === 'string' ? input : JSON.stringify(input);

  const response = await client.chat.completions.create({
    model,
    max_tokens: (config.max_tokens as number) || 4096,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
  });

  const inputTokens = response.usage?.prompt_tokens || 0;
  const outputTokens = response.usage?.completion_tokens || 0;
  const tokensUsed = inputTokens + outputTokens;

  const modelCosts = OPENAI_MODELS[model as keyof typeof OPENAI_MODELS] || { inputCostPerMTok: 2.5, outputCostPerMTok: 10 };
  const costUsd = (inputTokens / 1_000_000) * modelCosts.inputCostPerMTok + (outputTokens / 1_000_000) * modelCosts.outputCostPerMTok;

  const outputText = response.choices[0]?.message?.content || '';

  return {
    success: true,
    output: { text: outputText, finish_reason: response.choices[0]?.finish_reason },
    tokensUsed,
    costUsd,
  };
}

// ─── Bash Agent ───────────────────────────────────────────────────────────────

async function executeBashAgent(config: Record<string, unknown>, input: unknown): Promise<ExecutionResult> {
  const command = config.command as string;
  if (!command) {
    throw new Error('Bash agent requires config.command');
  }

  const timeout = (config.timeout as number) || 30000;

  // Pass input as environment variables
  const env: Record<string, string> = { ...process.env as Record<string, string> };
  if (typeof input === 'object' && input !== null) {
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      env[`AGENT_INPUT_${key.toUpperCase()}`] = String(value);
    }
  }
  env['AGENT_INPUT'] = typeof input === 'string' ? input : JSON.stringify(input);

  const { stdout, stderr } = await execAsync(command, {
    timeout,
    env,
    shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
    cwd: (config.workDir as string) || process.cwd(),
  });

  return {
    success: true,
    output: { stdout: stdout.trim(), stderr: stderr.trim() },
    tokensUsed: 0,
    costUsd: 0,
  };
}

// ─── Claude Code CLI Agent ────────────────────────────────────────────────────

async function executeClaudeCodeAgent(config: Record<string, unknown>, input: unknown): Promise<ExecutionResult> {
  const model = (config.model as string) || 'claude-sonnet-4-6';
  const maxTurns = (config.maxTurns as number) || 5;
  const workDir = (config.workDir as string) || process.cwd();
  const prompt = typeof input === 'string' ? input : JSON.stringify(input);

  // Build command: claude -p "<prompt>" --output-format json --max-turns N --model M
  // Flags verified from official docs: https://code.claude.com/docs/en/cli-reference
  const args: string[] = [
    '-p', prompt,
    '--output-format', 'json',
    '--max-turns', String(maxTurns),
    '--model', model,
  ];
  if (config.systemPrompt) {
    args.push('--system-prompt', String(config.systemPrompt));
  }
  if (config.allowedTools) {
    // --allowedTools: tools that execute without prompting for permission
    const tools = Array.isArray(config.allowedTools) ? config.allowedTools : [config.allowedTools];
    for (const tool of tools) {
      args.push('--allowedTools', String(tool));
    }
  }
  if (config.maxBudgetUsd) {
    args.push('--max-budget-usd', String(config.maxBudgetUsd));
  }

  try {
    const { execFileSync } = require('child_process');
    const stdout = execFileSync('claude', args, { cwd: workDir, timeout: 120000, encoding: 'utf8' });
    const result = JSON.parse(stdout);
    return {
      success: true,
      output: result,
      tokensUsed: (result.usage?.input_tokens || 0) + (result.usage?.output_tokens || 0),
      costUsd: 0,
    };
  } catch (err: any) {
    return { success: false, output: null, tokensUsed: 0, costUsd: 0, error: err.message };
  }
}

// ─── OpenAI Codex CLI Agent ───────────────────────────────────────────────────

async function executeOpenAICodexAgent(config: Record<string, unknown>, input: unknown): Promise<ExecutionResult> {
  const workDir = (config.workDir as string) || process.cwd();
  const prompt = typeof input === 'string' ? input : JSON.stringify(input);

  const env = { ...process.env } as Record<string, string>;
  if (config.apiKeyOverride) env.CODEX_API_KEY = config.apiKeyOverride as string;

  // Build command: codex exec "<prompt>" --full-auto --json
  // Flags verified from official docs: https://developers.openai.com/codex/cli/reference
  const args: string[] = ['exec', prompt, '--full-auto', '--json'];

  try {
    const { execFileSync } = require('child_process');
    const stdout = execFileSync('codex', args, { cwd: workDir, timeout: 120000, encoding: 'utf8', env });
    // Codex --json outputs newline-delimited JSON events; parse last line for final result
    const lines = stdout.trim().split('\n').filter((l: string) => l.trim());
    const lastLine = lines[lines.length - 1];
    let result: any;
    try {
      result = JSON.parse(lastLine);
    } catch {
      result = { text: stdout.trim() };
    }
    return { success: true, output: result, tokensUsed: 0, costUsd: 0 };
  } catch (err: any) {
    return { success: false, output: null, tokensUsed: 0, costUsd: 0, error: err.message };
  }
}

// ─── Cursor Agent ─────────────────────────────────────────────────────────────

async function executeCursorAgent(config: Record<string, unknown>, input: unknown): Promise<ExecutionResult> {
  // NOTE: Cursor does not currently have an official headless/non-interactive CLI mode.
  // The `cursor` CLI is primarily for opening files/folders in the IDE.
  // This executor attempts to use Cursor's background agent API if configured,
  // otherwise falls back to HTTP API if a Cursor server URL is provided.
  const workDir = (config.workDir as string) || process.cwd();
  const prompt = typeof input === 'string' ? input : JSON.stringify(input);

  // If a Cursor server endpoint is configured, use HTTP API
  if (config.serverUrl) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey as string}`;
      const resp = await axios.post(config.serverUrl as string, { prompt, workDir }, { headers, timeout: 120000 });
      return { success: true, output: resp.data, tokensUsed: 0, costUsd: 0 };
    } catch (err: any) {
      return { success: false, output: null, tokensUsed: 0, costUsd: 0, error: err.response?.data?.error || err.message };
    }
  }

  // Fallback: try running cursor CLI (experimental, may not work in all setups)
  try {
    const { execFileSync } = require('child_process');
    const stdout = execFileSync('cursor', ['--goto', workDir], { cwd: workDir, timeout: 30000, encoding: 'utf8' });
    return {
      success: false,
      output: null,
      tokensUsed: 0,
      costUsd: 0,
      error: 'Cursor does not support headless CLI mode. Configure a serverUrl for HTTP-based integration, or use Claude Code or Codex CLI instead.',
    };
  } catch (err: any) {
    return {
      success: false,
      output: null,
      tokensUsed: 0,
      costUsd: 0,
      error: 'Cursor headless mode is not available. The Cursor CLI only supports opening files/folders. Configure serverUrl for HTTP integration.',
    };
  }
}

// ─── OpenClaw Agent ───────────────────────────────────────────────────────────

async function executeOpenClawAgent(config: Record<string, unknown>, input: unknown): Promise<ExecutionResult> {
  const host = (config.host as string) || 'localhost';
  const port = (config.port as number) || 18789;
  const model = (config.model as string) || 'openclaw:main';
  const baseURL = `http://${host}:${port}/v1`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.token) headers['Authorization'] = `Bearer ${config.token as string}`;

  const messages: { role: string; content: string }[] = [];
  if (config.systemPrompt) messages.push({ role: 'system', content: config.systemPrompt as string });
  messages.push({ role: 'user', content: typeof input === 'string' ? input : JSON.stringify(input) });

  try {
    const resp = await axios.post(`${baseURL}/chat/completions`, { model, messages }, { headers });
    const content = resp.data.choices?.[0]?.message?.content || '';
    const usage = resp.data.usage || {};
    return {
      success: true,
      output: content,
      tokensUsed: (usage.prompt_tokens || 0) + (usage.completion_tokens || 0),
      costUsd: 0,
    };
  } catch (err: any) {
    return {
      success: false,
      output: null,
      tokensUsed: 0,
      costUsd: 0,
      error: err.response?.data?.error?.message || err.message,
    };
  }
}

// ─── A2A Protocol Agent ───────────────────────────────────────────────────────

async function executeA2AAgent(config: Record<string, unknown>, input: unknown): Promise<ExecutionResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers['Authorization'] = `Bearer ${config.apiKey as string}`;

  const messageId = uuidv4();
  const taskId = uuidv4();

  const body = {
    jsonrpc: '2.0',
    id: messageId,
    method: 'a2a.sendMessage',
    params: {
      message: {
        messageId,
        taskId,
        role: 'user',
        parts: [{ kind: 'text', text: typeof input === 'string' ? input : JSON.stringify(input) }],
      },
    },
  };

  try {
    const resp = await axios.post(config.endpoint as string, body, { headers });
    const result = resp.data?.result;
    const text = result?.parts?.find((p: any) => p.kind === 'text')?.text || JSON.stringify(result);
    return { success: true, output: text, tokensUsed: 0, costUsd: 0 };
  } catch (err: any) {
    return { success: false, output: null, tokensUsed: 0, costUsd: 0, error: err.message };
  }
}

// ─── Internal Agent ───────────────────────────────────────────────────────────

async function executeInternalAgent(config: Record<string, unknown>, input: unknown, memoryContext: string): Promise<ExecutionResult> {
  const provider = (config.provider as string) || (process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'openai');

  if (provider === 'anthropic') {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });
    const model = (config.model as string) || 'claude-sonnet-4-6';
    const baseSystemPrompt = (config.systemPrompt as string) || 'You are a helpful AI assistant embedded in AgentHub.';
    const systemPrompt = baseSystemPrompt + memoryContext;
    const messages: any[] = [{ role: 'user', content: typeof input === 'string' ? input : JSON.stringify(input) }];
    const resp = await client.messages.create({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages,
    });
    const content = resp.content[0]?.type === 'text' ? resp.content[0].text : '';
    const tokensUsed = resp.usage.input_tokens + resp.usage.output_tokens;
    const modelCosts = CLAUDE_MODELS[model as keyof typeof CLAUDE_MODELS] || { inputCostPerMTok: 3, outputCostPerMTok: 15 };
    const costUsd =
      (resp.usage.input_tokens / 1_000_000) * modelCosts.inputCostPerMTok +
      (resp.usage.output_tokens / 1_000_000) * modelCosts.outputCostPerMTok;
    return { success: true, output: content, tokensUsed, costUsd };
  } else {
    const OpenAI = require('openai');
    const client = new OpenAI.default({ apiKey: process.env.OPENAI_API_KEY });
    const model = (config.model as string) || 'gpt-5.2';
    const baseSystemPrompt = (config.systemPrompt as string) || 'You are a helpful AI assistant embedded in AgentHub.';
    const systemPrompt = baseSystemPrompt + memoryContext;
    const resp = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: typeof input === 'string' ? input : JSON.stringify(input) },
      ],
    });
    const content = resp.choices[0]?.message?.content || '';
    const usage = resp.usage || { prompt_tokens: 0, completion_tokens: 0 };
    const tokensUsed = usage.prompt_tokens + usage.completion_tokens;
    return { success: true, output: content, tokensUsed, costUsd: 0 };
  }
}

// ─── Main executeAgent ────────────────────────────────────────────────────────

export async function executeAgent(
  agentId: string,
  input: unknown,
  triggeredBy: 'schedule' | 'manual' | 'telegram' | 'api'
): Promise<ExecutionResult> {
  // Create run record
  const runId = uuidv4();
  const startedAt = new Date().toISOString();
  const [agentRecord] = await db.select().from(agents).where(eq(agents.id, agentId));

  if (!agentRecord) {
    throw new Error(`Agent ${agentId} not found`);
  }

  // Load persistent memory context
  const memoryContext = await loadAgentMemoryContext(agentId);

  // Insert initial run record
  await db.insert(runs).values({
    id: runId,
    agentId,
    status: 'running',
    startedAt,
    input: input as Record<string, unknown>,
    triggeredBy,
    tokensUsed: 0,
    costUsd: 0,
    createdAt: startedAt,
  });

  // Log run start
  await db.insert(auditLogs).values({
    id: uuidv4(),
    runId,
    agentId,
    eventType: 'run_started',
    data: { triggeredBy, input },
    createdAt: new Date().toISOString(),
  });

  const config = agentRecord.config as Record<string, unknown>;
  let result: ExecutionResult;

  try {
    switch (agentRecord.type) {
      case 'http':
        result = await executeHttpAgent(config, input);
        break;
      case 'claude':
        result = await executeClaudeAgent(config, input, memoryContext);
        break;
      case 'openai':
        result = await executeOpenAIAgent(config, input, memoryContext);
        break;
      case 'bash':
        result = await executeBashAgent(config, input);
        break;
      case 'claude-code':
        result = await executeClaudeCodeAgent(config, input);
        break;
      case 'openai-codex':
        result = await executeOpenAICodexAgent(config, input);
        break;
      case 'cursor':
        result = await executeCursorAgent(config, input);
        break;
      case 'openclaw':
        result = await executeOpenClawAgent(config, input);
        break;
      case 'a2a':
        result = await executeA2AAgent(config, input);
        break;
      case 'internal':
        result = await executeInternalAgent(config, input, memoryContext);
        break;
      case 'mcp': {
        // config: { transport: 'http'|'stdio', endpoint?: string, command?: string, toolName?: string, arguments?: object, token?: string }
        if (config.transport === 'http' || !config.transport) {
          // Call MCP server via HTTP — MCP JSON-RPC
          const headers: Record<string, string> = { 'Content-Type': 'application/json' };
          if (config.token) headers['Authorization'] = `Bearer ${config.token as string}`;
          const body = {
            jsonrpc: '2.0',
            id: crypto.randomUUID(),
            method: 'tools/call',
            params: {
              name: config.toolName || 'run',
              arguments: typeof input === 'object' ? input : { input },
            },
          };
          try {
            const resp = await axios.post(config.endpoint as string, body, { headers });
            const mcpResult = resp.data?.result;
            const content = Array.isArray(mcpResult?.content)
              ? mcpResult.content.map((c: any) => c.text || JSON.stringify(c)).join('\n')
              : JSON.stringify(mcpResult);
            result = { success: true, output: content, tokensUsed: 0, costUsd: 0 };
          } catch (err: any) {
            result = { success: false, output: null, tokensUsed: 0, costUsd: 0, error: err.message };
          }
        } else {
          // stdio transport — spawn MCP server as subprocess
          const { execSync } = require('child_process');
          const inputJson = JSON.stringify({
            jsonrpc: '2.0',
            id: '1',
            method: 'tools/call',
            params: {
              name: config.toolName || 'run',
              arguments: typeof input === 'object' ? input : { input },
            },
          });
          try {
            const stdout = execSync(`echo '${inputJson}' | ${config.command as string}`, {
              timeout: 30000,
              encoding: 'utf8',
            });
            const mcpResult = JSON.parse(stdout);
            result = { success: true, output: mcpResult?.result || stdout, tokensUsed: 0, costUsd: 0 };
          } catch (err: any) {
            result = { success: false, output: null, tokensUsed: 0, costUsd: 0, error: err.message };
          }
        }
        break;
      }
      default:
        throw new Error(`Unknown agent type: ${agentRecord.type}`);
    }

    const completedAt = new Date().toISOString();

    // Update run as success
    await db
      .update(runs)
      .set({
        status: 'success',
        completedAt,
        output: result.output as Record<string, unknown>,
        tokensUsed: result.tokensUsed,
        costUsd: result.costUsd,
      })
      .where(eq(runs.id, runId));

    // Log success
    const agentCreatedAt = agentRecord.createdAt ? new Date(agentRecord.createdAt).getTime() : Date.now();
    await db.insert(auditLogs).values({
      id: uuidv4(),
      runId,
      agentId,
      eventType: 'run_completed',
      data: {
        tokensUsed: result.tokensUsed,
        costUsd: result.costUsd,
        durationMs: Date.now() - agentCreatedAt,
      },
      createdAt: new Date().toISOString(),
    });

    // If agent is CEO, parse output for proposal blocks and override actions
    const ceoContext = {
      id: agentRecord.id,
      organizationId: agentRecord.organizationId,
      role: agentRecord.role,
    };
    await parseCeoProposals(result.output, ceoContext);
    const ceoActions = await applyCeoActions(result.output, ceoContext);
    if (ceoActions.agentUpdates > 0 || ceoActions.scheduleUpdates > 0) {
      console.log(`[CEO] Applied ${ceoActions.agentUpdates} agent updates, ${ceoActions.scheduleUpdates} schedule updates`);
    }

    return result;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    const completedAt = new Date().toISOString();

    // Update run as failed
    await db
      .update(runs)
      .set({
        status: 'failed',
        completedAt,
        error: errorMessage,
      })
      .where(eq(runs.id, runId));

    // Log failure
    await db.insert(auditLogs).values({
      id: uuidv4(),
      runId,
      agentId,
      eventType: 'run_failed',
      data: { error: errorMessage },
      createdAt: new Date().toISOString(),
    });

    // Update agent status to error
    await db
      .update(agents)
      .set({ status: 'error', updatedAt: new Date().toISOString() })
      .where(eq(agents.id, agentId));

    return {
      success: false,
      output: null,
      tokensUsed: 0,
      costUsd: 0,
      error: errorMessage,
    };
  }
}
