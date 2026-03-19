import 'dotenv/config';
import { exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import { db } from '../db';
import { runs, auditLogs, agents } from '../db/schema';
import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

const execAsync = promisify(exec);

export interface ExecutionResult {
  success: boolean;
  output: unknown;
  tokensUsed: number;
  costUsd: number;
  error?: string;
}

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

async function executeClaudeAgent(config: Record<string, unknown>, input: unknown): Promise<ExecutionResult> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;

  const apiKey = (config.api_key_override as string) || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('Claude agent requires ANTHROPIC_API_KEY or config.api_key_override');
  }

  const client = new Anthropic({ apiKey });
  const model = (config.model as string) || 'claude-3-5-sonnet-20241022';
  const systemPrompt = (config.system_prompt as string) || 'You are a helpful assistant.';

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

  // claude-3-5-sonnet pricing: $3/M input, $15/M output
  const costUsd = (inputTokens / 1_000_000) * 3 + (outputTokens / 1_000_000) * 15;

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

async function executeOpenAIAgent(config: Record<string, unknown>, input: unknown): Promise<ExecutionResult> {
  const OpenAI = (await import('openai')).default;

  const apiKey = (config.api_key_override as string) || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OpenAI agent requires OPENAI_API_KEY or config.api_key_override');
  }

  const client = new OpenAI({ apiKey });
  const model = (config.model as string) || 'gpt-4o';
  const systemPrompt = (config.system_prompt as string) || 'You are a helpful assistant.';

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

  // gpt-4o pricing: $2.50/M input, $10/M output
  const costUsd = (inputTokens / 1_000_000) * 2.5 + (outputTokens / 1_000_000) * 10;

  const outputText = response.choices[0]?.message?.content || '';

  return {
    success: true,
    output: { text: outputText, finish_reason: response.choices[0]?.finish_reason },
    tokensUsed,
    costUsd,
  };
}

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
  });

  return {
    success: true,
    output: { stdout: stdout.trim(), stderr: stderr.trim() },
    tokensUsed: 0,
    costUsd: 0,
  };
}

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
        result = await executeClaudeAgent(config, input);
        break;
      case 'openai':
        result = await executeOpenAIAgent(config, input);
        break;
      case 'bash':
        result = await executeBashAgent(config, input);
        break;
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
