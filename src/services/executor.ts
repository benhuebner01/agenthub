import 'dotenv/config';
import { exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import { db } from '../db';
import { runs, auditLogs, agents, agentMemory, proposals } from '../db/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

const execAsync = promisify(exec);

// ─── Model Pricing ────────────────────────────────────────────────────────────

const CLAUDE_MODELS = {
  'claude-opus-4-6': { inputCostPerMTok: 5, outputCostPerMTok: 25 },
  'claude-sonnet-4-6': { inputCostPerMTok: 3, outputCostPerMTok: 15 },
  'claude-haiku-4-5-20251001': { inputCostPerMTok: 1, outputCostPerMTok: 5 },
};

const OPENAI_MODELS = {
  'gpt-5.4': { inputCostPerMTok: 2.0, outputCostPerMTok: 10 },
  'gpt-5.4-pro': { inputCostPerMTok: 2.5, outputCostPerMTok: 15 },
  'gpt-5.4-mini': { inputCostPerMTok: 0.2, outputCostPerMTok: 1.25 },
  'gpt-5.4-nano': { inputCostPerMTok: 0.1, outputCostPerMTok: 0.5 },
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
  const model = (config.model as string) || 'gpt-5.4';
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
  const { execSync } = require('child_process');
  const model = (config.model as string) || 'claude-sonnet-4-6';
  const maxTurns = (config.maxTurns as number) || 5;
  const workDir = (config.workDir as string) || process.cwd();
  const prompt = typeof input === 'string' ? input : JSON.stringify(input);

  let cmd = `claude -p ${JSON.stringify(prompt)} --output-format json --max-turns ${maxTurns} --model ${model}`;
  if (config.systemPrompt) cmd += ` --system-prompt ${JSON.stringify(config.systemPrompt)}`;
  if (config.tools) cmd += ` --tools ${config.tools}`;

  try {
    const stdout = execSync(cmd, { cwd: workDir, timeout: 120000, encoding: 'utf8' });
    const result = JSON.parse(stdout);
    return {
      success: true,
      output: result,
      tokensUsed: result.usage?.input_tokens + result.usage?.output_tokens || 0,
      costUsd: 0,
    };
  } catch (err: any) {
    return { success: false, output: null, tokensUsed: 0, costUsd: 0, error: err.message };
  }
}

// ─── OpenAI Codex CLI Agent ───────────────────────────────────────────────────

async function executeOpenAICodexAgent(config: Record<string, unknown>, input: unknown): Promise<ExecutionResult> {
  const { execSync } = require('child_process');
  const workDir = (config.workDir as string) || process.cwd();
  const mode = (config.mode as string) || 'full-auto';
  const prompt = typeof input === 'string' ? input : JSON.stringify(input);

  const env = { ...process.env };
  if (config.apiKeyOverride) (env as any).OPENAI_API_KEY = config.apiKeyOverride;

  let cmd = `codex --${mode} --output-format json ${JSON.stringify(prompt)}`;

  try {
    const stdout = execSync(cmd, { cwd: workDir, timeout: 120000, encoding: 'utf8', env });
    return { success: true, output: JSON.parse(stdout), tokensUsed: 0, costUsd: 0 };
  } catch (err: any) {
    return { success: false, output: null, tokensUsed: 0, costUsd: 0, error: err.message };
  }
}

// ─── Cursor Agent ─────────────────────────────────────────────────────────────

async function executeCursorAgent(config: Record<string, unknown>, input: unknown): Promise<ExecutionResult> {
  const { execSync } = require('child_process');
  const workDir = (config.workDir as string) || process.cwd();
  const fmt = (config.outputFormat as string) || 'text';
  const prompt = typeof input === 'string' ? input : JSON.stringify(input);

  const env = { ...process.env };
  if (config.apiKey) (env as any).CURSOR_API_KEY = config.apiKey;

  const cmd = `cursor --print ${JSON.stringify(prompt)} --output-format ${fmt}`;

  try {
    const stdout = execSync(cmd, { cwd: workDir, timeout: 120000, encoding: 'utf8', env });
    return {
      success: true,
      output: fmt === 'json' ? JSON.parse(stdout) : stdout,
      tokensUsed: 0,
      costUsd: 0,
    };
  } catch (err: any) {
    return { success: false, output: null, tokensUsed: 0, costUsd: 0, error: err.message };
  }
}

// ─── OpenClaw Agent ───────────────────────────────────────────────────────────
// OpenClaw real API: POST /api/agent/run  { prompt, model? }
// Response:          { result, success, error?, tokens? }

async function executeOpenClawAgent(config: Record<string, unknown>, input: unknown): Promise<ExecutionResult> {
  const host = (config.host as string) || 'localhost';
  const port = (config.port as number) || 18789;
  const baseURL = `http://${host}:${port}`;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.token) headers['Authorization'] = `Bearer ${config.token as string}`;

  // Build the prompt — prepend system prompt if configured
  const promptText = typeof input === 'string' ? input : JSON.stringify(input);
  const fullPrompt = config.systemPrompt
    ? `${config.systemPrompt as string}\n\n${promptText}`
    : promptText;

  const body: Record<string, unknown> = { prompt: fullPrompt };
  // model is optional — 'gpt' | 'claude' | 'gemini' | undefined (OpenClaw picks default)
  if (config.model && config.model !== 'auto') body.model = config.model;

  try {
    const resp = await axios.post(`${baseURL}/api/agent/run`, body, { headers, timeout: 120_000 });
    // OpenClaw returns: { result, success, error?, tokens? }
    const data = resp.data as { result?: string; output?: string; success?: boolean; error?: string; tokens?: number };
    const content = data.result ?? data.output ?? JSON.stringify(data);
    return {
      success: data.success !== false,
      output: content,
      tokensUsed: data.tokens ?? 0,
      costUsd: 0,
    };
  } catch (err: any) {
    const msg =
      err.response?.data?.error ??
      err.response?.data?.message ??
      err.message ??
      'OpenClaw unreachable';
    return { success: false, output: null, tokensUsed: 0, costUsd: 0, error: msg };
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
    const model = (config.model as string) || 'gpt-5.4';
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

    // If agent is CEO, parse output for proposal blocks
    await parseCeoProposals(result.output, {
      id: agentRecord.id,
      organizationId: agentRecord.organizationId,
      role: agentRecord.role,
    });

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
