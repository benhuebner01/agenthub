import 'dotenv/config';
import { exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import { db } from '../db';
import { runs, auditLogs, agents, agentMemory, proposals, sharedMemory } from '../db/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getApiKeyForProvider } from '../routes/settings';

const execAsync = promisify(exec);

// ─── Model Pricing ────────────────────────────────────────────────────────────

const CLAUDE_MODELS = {
  'claude-opus-4-6': { inputCostPerMTok: 5, outputCostPerMTok: 25 },
  'claude-sonnet-4-6': { inputCostPerMTok: 3, outputCostPerMTok: 15 },
  'claude-haiku-4-5-20251001': { inputCostPerMTok: 1, outputCostPerMTok: 5 },
};

const OPENAI_MODELS = {
  'gpt-5.4': { inputCostPerMTok: 2.5, outputCostPerMTok: 15 },
  'gpt-5.4-pro': { inputCostPerMTok: 2.5, outputCostPerMTok: 15 },
  'gpt-5.4-mini': { inputCostPerMTok: 0.75, outputCostPerMTok: 3.0 },
  'gpt-5.4-nano': { inputCostPerMTok: 0.1, outputCostPerMTok: 0.5 },
  'gpt-4o': { inputCostPerMTok: 2.5, outputCostPerMTok: 10 },
  'gpt-4o-mini': { inputCostPerMTok: 0.15, outputCostPerMTok: 0.6 },
  'o3': { inputCostPerMTok: 2, outputCostPerMTok: 8 },
  'o3-mini': { inputCostPerMTok: 1.1, outputCostPerMTok: 4.4 },
  'o4-mini': { inputCostPerMTok: 1.1, outputCostPerMTok: 4.4 },
};

// ─── Model Specifications (context windows + output limits) ──────────────────

export const MODEL_SPECS: Record<string, {
  provider: 'anthropic' | 'openai';
  contextWindow: number;
  maxOutput: number;
  suggestedOutput: number; // 80% of maxOutput
}> = {
  'claude-opus-4-6':            { provider: 'anthropic', contextWindow: 200000, maxOutput: 32000,  suggestedOutput: 25600 },
  'claude-sonnet-4-6':          { provider: 'anthropic', contextWindow: 200000, maxOutput: 16000,  suggestedOutput: 12800 },
  'claude-haiku-4-5-20251001':  { provider: 'anthropic', contextWindow: 200000, maxOutput: 8192,   suggestedOutput: 6554 },
  'gpt-5.4':                    { provider: 'openai',    contextWindow: 1048576, maxOutput: 32768,  suggestedOutput: 26214 },
  'gpt-5.4-pro':                { provider: 'openai',    contextWindow: 1048576, maxOutput: 32768,  suggestedOutput: 26214 },
  'gpt-5.4-mini':               { provider: 'openai',    contextWindow: 1048576, maxOutput: 16384,  suggestedOutput: 13107 },
  'gpt-5.4-nano':               { provider: 'openai',    contextWindow: 128000,  maxOutput: 8192,   suggestedOutput: 6554 },
  'gpt-4o':                     { provider: 'openai',    contextWindow: 128000,  maxOutput: 16384,  suggestedOutput: 13107 },
  'gpt-4o-mini':                { provider: 'openai',    contextWindow: 128000,  maxOutput: 16384,  suggestedOutput: 13107 },
  'o3':                         { provider: 'openai',    contextWindow: 200000,  maxOutput: 100000, suggestedOutput: 80000 },
  'o3-mini':                    { provider: 'openai',    contextWindow: 200000,  maxOutput: 65536,  suggestedOutput: 52429 },
  'o4-mini':                    { provider: 'openai',    contextWindow: 200000,  maxOutput: 100000, suggestedOutput: 80000 },
};

/**
 * Models that require max_completion_tokens instead of max_tokens.
 * GPT-5 family, o-series reasoning models reject max_tokens with a 400 error.
 */
const MODELS_REQUIRING_MAX_COMPLETION_TOKENS = new Set([
  'gpt-5', 'gpt-5-mini', 'gpt-5-nano',
  'gpt-5.1', 'gpt-5.1-mini', 'gpt-5.1-nano',
  'gpt-5.4', 'gpt-5.4-pro', 'gpt-5.4-mini', 'gpt-5.4-nano',
  'o1', 'o1-mini', 'o1-preview',
  'o3', 'o3-mini', 'o3-pro',
  'o4-mini',
]);

function modelRequiresMaxCompletionTokens(model: string): boolean {
  if (MODELS_REQUIRING_MAX_COMPLETION_TOKENS.has(model)) return true;
  // Catch future gpt-5.x, o5, etc.
  if (/^(gpt-5|o\d)/.test(model)) return true;
  return false;
}

function getMaxTokens(config: Record<string, unknown>, model: string): number {
  // Accept both parameter names from user config
  const userVal = (config.max_completion_tokens as number) || (config.max_tokens as number);
  if (userVal && userVal > 0) return userVal;
  const spec = MODEL_SPECS[model];
  return spec ? spec.suggestedOutput : 8192;
}

/**
 * Build the correct token-limit parameter for an OpenAI API call.
 * Returns { max_completion_tokens: N } or { max_tokens: N } depending on model.
 */
function buildTokenLimitParam(config: Record<string, unknown>, model: string): Record<string, number> {
  const value = getMaxTokens(config, model);
  if (modelRequiresMaxCompletionTokens(model)) {
    return { max_completion_tokens: value };
  }
  return { max_tokens: value };
}

// ─── Result Type ──────────────────────────────────────────────────────────────

export interface ExecutionResult {
  success: boolean;
  output: unknown;
  tokensUsed: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd: number;
  model?: string;
  error?: string;
  runId?: string;
}

// ─── Memory Helpers ───────────────────────────────────────────────────────────

async function loadAgentMemoryContext(agentId: string): Promise<string> {
  try {
    const memories = await db.select().from(agentMemory).where(eq(agentMemory.agentId, agentId));
    if (memories.length === 0) return '';
    return '\n\nYour persistent memory:\n' + memories.map((m: typeof memories[number]) => `${m.key}: ${m.value}`).join('\n');
  } catch {
    return '';
  }
}

async function loadSharedMemoryContext(organizationId: string | null | undefined): Promise<string> {
  if (!organizationId) return '';
  try {
    const memories = await db.select().from(sharedMemory).where(eq(sharedMemory.organizationId, organizationId));
    if (memories.length === 0) return '';
    return '\n\nShared organization memory:\n' + memories.map((m: typeof memories[number]) => `${m.key}: ${m.value}`).join('\n');
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

  const apiKey = (config.api_key_override as string) || await getApiKeyForProvider('anthropic');
  if (!apiKey) {
    throw new Error('Claude agent requires ANTHROPIC_API_KEY — add it in Settings or .env');
  }

  const client = new Anthropic({ apiKey });
  const model = (config.model as string) || 'claude-sonnet-4-6';
  const baseSystemPrompt = (config.system_prompt as string) || (config.systemPrompt as string) || 'You are a helpful assistant.';
  const systemPrompt = baseSystemPrompt + memoryContext;

  const userMessage = typeof input === 'string' ? input : JSON.stringify(input);

  const response = await client.messages.create({
    model,
    max_tokens: getMaxTokens(config, model),
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
    inputTokens,
    outputTokens,
    costUsd,
    model,
  };
}

// ─── OpenAI Agent ─────────────────────────────────────────────────────────────

async function executeOpenAIAgent(config: Record<string, unknown>, input: unknown, memoryContext: string): Promise<ExecutionResult> {
  const OpenAI = (await import('openai')).default;

  const apiKey = (config.api_key_override as string) || await getApiKeyForProvider('openai');
  if (!apiKey) {
    throw new Error('OpenAI agent requires OPENAI_API_KEY — add it in Settings or .env');
  }

  const client = new OpenAI({ apiKey });
  const model = (config.model as string) || 'gpt-5.4';
  const baseSystemPrompt = (config.system_prompt as string) || (config.systemPrompt as string) || 'You are a helpful assistant.';
  const systemPrompt = baseSystemPrompt + memoryContext;

  const userMessage = typeof input === 'string' ? input : JSON.stringify(input);

  const response = await client.chat.completions.create({
    model,
    ...buildTokenLimitParam(config, model),
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
    inputTokens,
    outputTokens,
    costUsd,
    model,
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
// Reference: https://developers.openai.com/codex/cli/reference
//
// `codex exec` (alias `codex e`) — non-interactive mode for scripting/CI.
//   Global flags: --full-auto, --model/-m, --sandbox/-s, --cd/-C, --image/-i
//   Exec-specific: --json (NDJSON events), --output-last-message/-o <path>,
//                  --ephemeral, --skip-git-repo-check, --color
//   Approval: --full-auto = workspace-write + on-request approval
//             --dangerously-bypass-approvals-and-sandbox / --yolo
//             -a untrusted|on-request|never

async function executeOpenAICodexAgent(config: Record<string, unknown>, input: unknown): Promise<ExecutionResult> {
  const { execSync } = require('child_process');
  const workDir = (config.workDir as string) || process.cwd();
  const prompt = typeof input === 'string' ? input : JSON.stringify(input);

  const env = { ...process.env };
  if (config.apiKeyOverride) (env as any).OPENAI_API_KEY = config.apiKeyOverride;

  // Build command using `codex exec` for non-interactive programmatic execution
  const parts: string[] = ['codex', 'exec'];

  // Approval mode
  const mode = (config.mode as string) || 'full-auto';
  if (mode === 'full-auto') {
    parts.push('--full-auto');
  } else if (mode === 'yolo') {
    parts.push('--dangerously-bypass-approvals-and-sandbox');
  } else if (mode === 'on-request' || mode === 'untrusted' || mode === 'never') {
    parts.push('-a', mode);
  }

  // Model override
  const model = (config.model as string) || '';
  if (model) parts.push('-m', model);

  // Sandbox policy
  const sandbox = config.sandbox as string;
  if (sandbox) parts.push('-s', sandbox);

  // Working directory — use -C to set workspace root
  parts.push('-C', workDir);

  // Allow running outside git repos (workDir may not be a git repo)
  parts.push('--skip-git-repo-check');

  // JSON output for structured parsing
  parts.push('--json');

  // The prompt
  parts.push(JSON.stringify(prompt));

  // Write last assistant message to temp file for clean output capture
  const tmpOut = require('path').join(require('os').tmpdir(), `codex-out-${Date.now()}.txt`);
  parts.push('-o', tmpOut);

  const cmd = parts.join(' ');

  try {
    const stdout = execSync(cmd, {
      cwd: workDir,
      timeout: (config.timeoutMs as number) || 300000,
      encoding: 'utf8',
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Try reading the -o output file first (clean last message)
    let output: unknown;
    try {
      const fs = require('fs');
      if (fs.existsSync(tmpOut)) {
        const lastMsg = fs.readFileSync(tmpOut, 'utf8').trim();
        fs.unlinkSync(tmpOut);
        // Try JSON parse, fall back to raw text
        try { output = JSON.parse(lastMsg); } catch { output = lastMsg; }
      } else {
        // Fall back to parsing NDJSON stdout (last message event)
        output = parseCodexNdjson(stdout);
      }
    } catch {
      output = stdout.trim();
    }

    return { success: true, output, tokensUsed: 0, costUsd: 0 };
  } catch (err: any) {
    // Clean up temp file on error
    try { require('fs').unlinkSync(tmpOut); } catch { /* ignore */ }
    const stderr = err.stderr ? String(err.stderr).trim() : '';
    const errMsg = stderr || err.message || 'Codex execution failed';
    return { success: false, output: null, tokensUsed: 0, costUsd: 0, error: errMsg };
  }
}

/** Parse NDJSON from `codex exec --json` and extract the final assistant message */
function parseCodexNdjson(ndjson: string): unknown {
  const lines = ndjson.trim().split('\n').filter(Boolean);
  let lastMessage: unknown = ndjson.trim();
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      // Codex NDJSON events have a type field; look for message events
      if (event.type === 'message' && event.role === 'assistant') {
        lastMessage = event.content || event;
      }
    } catch { /* skip non-JSON lines */ }
  }
  return lastMessage;
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
//
// OpenClaw supports 4 connection modes (docs.openclaw.ai):
//
//  'responses'    POST /v1/responses          — full agent run, OpenAI Responses API
//                                               format; gateway.auth.token required;
//                                               disabled by default, must be enabled
//  'tools-invoke' POST /tools/invoke          — single tool call; always active
//  'webhook'      POST /hooks/<path>          — event-driven trigger; hooks.enabled=true
//                                               + hooks.token required
//  'cli'          openclaw agent --agent <id> — local CLI; same machine only
//
// Default: 'responses'

async function executeOpenClawAgent(config: Record<string, unknown>, input: unknown): Promise<ExecutionResult> {
  const host             = (config.host as string)   || 'localhost';
  const port             = (config.port as number)   || 18789;
  const baseURL          = `http://${host}:${port}`;
  const connectionType   = (config.connectionType as string) || 'responses';
  const gatewayToken     = config.token as string | undefined;
  const promptText       = typeof input === 'string' ? input : JSON.stringify(input);
  const fullPrompt       = config.systemPrompt
    ? `${config.systemPrompt as string}\n\n${promptText}`
    : promptText;

  // ── 1. Local CLI ────────────────────────────────────────────────────────────
  if (connectionType === 'cli') {
    const ocAgentId = config.ocAgentId as string | undefined;
    const cmd = ocAgentId
      ? `openclaw agent --agent ${JSON.stringify(ocAgentId)} --prompt ${JSON.stringify(fullPrompt)}`
      : `openclaw --prompt ${JSON.stringify(fullPrompt)}`;
    try {
      const { stdout, stderr } = await execAsync(cmd, { timeout: 120_000 });
      return { success: true, output: (stdout || stderr).trim(), tokensUsed: 0, costUsd: 0 };
    } catch (err: any) {
      return { success: false, output: null, tokensUsed: 0, costUsd: 0, error: err.message };
    }
  }

  const apiHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  if (gatewayToken) apiHeaders['Authorization'] = `Bearer ${gatewayToken}`;

  // ── 2. Webhook Trigger  POST /hooks/<path> ──────────────────────────────────
  if (connectionType === 'webhook') {
    const hookPath    = ((config.webhookPath as string) || '/hooks/agenthub').replace(/^([^/])/, '/$1');
    const hookToken   = (config.webhookToken as string) || gatewayToken;
    const hookHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
    if (hookToken) hookHeaders['Authorization'] = `Bearer ${hookToken}`;

    try {
      const resp = await axios.post(
        `${baseURL}${hookPath}`,
        { prompt: fullPrompt, input: typeof input === 'object' ? input : { prompt: fullPrompt } },
        { headers: hookHeaders, timeout: 120_000 },
      );
      const data = resp.data as any;
      const output = data.result ?? data.output ?? data.response ?? JSON.stringify(data);
      return { success: true, output, tokensUsed: 0, costUsd: 0 };
    } catch (err: any) {
      const msg = err.response?.data?.error ?? err.response?.data?.message ?? err.message ?? 'Webhook error';
      return { success: false, output: null, tokensUsed: 0, costUsd: 0, error: msg };
    }
  }

  // ── 3. Tools Invoke  POST /tools/invoke ─────────────────────────────────────
  if (connectionType === 'tools-invoke') {
    const toolName = (config.toolName as string) || 'run';
    try {
      const resp = await axios.post(
        `${baseURL}/tools/invoke`,
        { tool: toolName, input: { prompt: fullPrompt } },
        { headers: apiHeaders, timeout: 120_000 },
      );
      const data = resp.data as any;
      const output = data.result ?? data.output ?? JSON.stringify(data);
      const tokensUsed = data.usage ? ((data.usage.input_tokens || 0) + (data.usage.output_tokens || 0)) : 0;
      return { success: true, output, tokensUsed, costUsd: 0 };
    } catch (err: any) {
      const msg = err.response?.data?.error ?? err.message ?? 'Tools-invoke error';
      return { success: false, output: null, tokensUsed: 0, costUsd: 0, error: msg };
    }
  }

  // ── 4. OpenResponses API  POST /v1/responses  (default) ─────────────────────
  // Must be enabled in OpenClaw config (gateway.openResponses.enabled = true).
  // Uses the OpenAI Responses API wire format.
  const model = (config.model as string) && config.model !== 'auto' ? config.model as string : undefined;
  const body: Record<string, unknown> = { input: fullPrompt };
  if (model) body.model = model;

  try {
    const resp = await axios.post(`${baseURL}/v1/responses`, body, { headers: apiHeaders, timeout: 120_000 });
    const data = resp.data as any;

    // Parse OpenAI Responses API format: output[].content[].text
    let output: string;
    if (Array.isArray(data.output)) {
      output = (data.output as any[])
        .flatMap((o: any) => (o.content as any[]) || [])
        .filter((c: any) => c.type === 'output_text' || c.type === 'text')
        .map((c: any) => c.text ?? c.output_text ?? '')
        .join('') || JSON.stringify(data);
    } else {
      output = data.result ?? data.output ?? data.response ?? data.text ?? JSON.stringify(data);
    }

    const tokensUsed = data.usage
      ? ((data.usage.input_tokens || 0) + (data.usage.output_tokens || 0))
      : 0;

    return { success: true, output, tokensUsed, costUsd: 0 };
  } catch (err: any) {
    const msg = err.response?.data?.error ?? err.response?.data?.message ?? err.message ?? 'OpenClaw /v1/responses error';
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
  const anthropicKey = await getApiKeyForProvider('anthropic');
  const openaiKey = await getApiKeyForProvider('openai');
  const provider = (config.provider as string) || (anthropicKey ? 'anthropic' : 'openai');

  if (provider === 'anthropic') {
    const Anthropic = require('@anthropic-ai/sdk');
    if (!anthropicKey) throw new Error('Internal agent needs ANTHROPIC_API_KEY — add it in Settings or .env');
    const client = new Anthropic.default({ apiKey: anthropicKey });
    const model = (config.model as string) || 'claude-sonnet-4-6';
    const baseSystemPrompt = (config.systemPrompt as string) || 'You are a helpful AI assistant embedded in AgentHub.';
    const systemPrompt = baseSystemPrompt + memoryContext;
    const resp = await client.messages.create({
      model,
      max_tokens: getMaxTokens(config, model),
      system: systemPrompt,
      messages: [{ role: 'user', content: typeof input === 'string' ? input : JSON.stringify(input) }],
    });
    const inTok = resp.usage.input_tokens;
    const outTok = resp.usage.output_tokens;
    const content = resp.content[0]?.type === 'text' ? resp.content[0].text : '';
    const modelCosts = CLAUDE_MODELS[model as keyof typeof CLAUDE_MODELS] || { inputCostPerMTok: 3, outputCostPerMTok: 15 };
    const costUsd = (inTok / 1_000_000) * modelCosts.inputCostPerMTok + (outTok / 1_000_000) * modelCosts.outputCostPerMTok;
    return { success: true, output: content, tokensUsed: inTok + outTok, inputTokens: inTok, outputTokens: outTok, costUsd, model };
  } else {
    const OpenAI = require('openai');
    if (!openaiKey) throw new Error('Internal agent needs OPENAI_API_KEY — add it in Settings or .env');
    const client = new OpenAI.default({ apiKey: openaiKey });
    const model = (config.model as string) || 'gpt-5.4';
    const baseSystemPrompt = (config.systemPrompt as string) || 'You are a helpful AI assistant embedded in AgentHub.';
    const systemPrompt = baseSystemPrompt + memoryContext;
    const resp = await client.chat.completions.create({
      model,
      ...buildTokenLimitParam(config, model),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: typeof input === 'string' ? input : JSON.stringify(input) },
      ],
    });
    const content = resp.choices[0]?.message?.content || '';
    const inTok = resp.usage?.prompt_tokens || 0;
    const outTok = resp.usage?.completion_tokens || 0;
    const modelCosts = OPENAI_MODELS[model as keyof typeof OPENAI_MODELS] || { inputCostPerMTok: 2.5, outputCostPerMTok: 10 };
    const costUsd = (inTok / 1_000_000) * modelCosts.inputCostPerMTok + (outTok / 1_000_000) * modelCosts.outputCostPerMTok;
    return { success: true, output: content, tokensUsed: inTok + outTok, inputTokens: inTok, outputTokens: outTok, costUsd, model };
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

  // Load persistent memory context + shared org memory
  const agentMem = await loadAgentMemoryContext(agentId);
  const sharedMem = await loadSharedMemoryContext(agentRecord.organizationId);
  const memoryContext = agentMem + sharedMem;

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

    const durationMs = Date.now() - new Date(startedAt).getTime();

    // Update run as success with detailed fields
    await db
      .update(runs)
      .set({
        status: 'success',
        completedAt,
        output: result.output as Record<string, unknown>,
        tokensUsed: result.tokensUsed,
        inputTokens: result.inputTokens || 0,
        outputTokens: result.outputTokens || 0,
        costUsd: result.costUsd,
        model: result.model || null,
        durationMs,
      })
      .where(eq(runs.id, runId));

    // Log success
    await db.insert(auditLogs).values({
      id: uuidv4(),
      runId,
      agentId,
      eventType: 'run_completed',
      data: {
        tokensUsed: result.tokensUsed,
        inputTokens: result.inputTokens || 0,
        outputTokens: result.outputTokens || 0,
        costUsd: result.costUsd,
        model: result.model || null,
        durationMs,
      },
      createdAt: new Date().toISOString(),
    });

    // If agent is CEO, parse output for proposal blocks
    await parseCeoProposals(result.output, {
      id: agentRecord.id,
      organizationId: agentRecord.organizationId,
      role: agentRecord.role,
    });

    result.runId = runId;
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
      runId,
    };
  }
}
