import 'dotenv/config';
import { db } from './index';
import { agents, schedules, budgets } from './schema';
import { v4 as uuidv4 } from 'uuid';

async function seed() {
  console.log('Seeding database with example data...');

  // Create example agents
  const httpAgentId = uuidv4();
  const claudeAgentId = uuidv4();
  const bashAgentId = uuidv4();
  const now = new Date().toISOString();

  console.log('Creating example agents...');

  await db.insert(agents).values([
    {
      id: httpAgentId,
      name: 'example-http-agent',
      description: 'Example HTTP agent that calls a webhook',
      type: 'http',
      config: {
        endpoint: 'https://httpbin.org/post',
        headers: { 'X-Custom-Header': 'agenthub' },
        timeout: 10000,
      },
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: claudeAgentId,
      name: 'example-claude-agent',
      description: 'Example Claude AI agent for text analysis',
      type: 'claude',
      config: {
        model: 'claude-3-5-sonnet-20241022',
        system_prompt: 'You are a helpful data analyst. Analyze the input and provide a brief summary.',
        max_tokens: 512,
      },
      status: 'paused',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: bashAgentId,
      name: 'example-bash-agent',
      description: 'Example Bash agent that runs a shell script',
      type: 'bash',
      config: {
        command: 'echo "Agent ran at $(date)" && echo "Input: $AGENT_INPUT"',
        timeout: 5000,
      },
      status: 'active',
      createdAt: now,
      updatedAt: now,
    },
  ]).onConflictDoNothing();

  console.log('Creating example schedules...');

  await db.insert(schedules).values([
    {
      id: uuidv4(),
      agentId: httpAgentId,
      cronExpression: '0 * * * *',
      enabled: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uuidv4(),
      agentId: bashAgentId,
      cronExpression: '*/30 * * * *',
      enabled: false,
      createdAt: now,
      updatedAt: now,
    },
  ]).onConflictDoNothing();

  console.log('Creating example budgets...');

  await db.insert(budgets).values([
    {
      id: uuidv4(),
      agentId: claudeAgentId,
      period: 'monthly',
      limitUsd: 10.00,
      currentSpend: 0.5421,
      periodStart: now,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: uuidv4(),
      agentId: httpAgentId,
      period: 'daily',
      limitUsd: 1.00,
      currentSpend: 0,
      periodStart: now,
      createdAt: now,
      updatedAt: now,
    },
  ]).onConflictDoNothing();

  console.log('Seed completed successfully!');
  console.log('');
  console.log('Example agents created:');
  console.log('  - example-http-agent (active, scheduled hourly)');
  console.log('  - example-claude-agent (paused, needs ANTHROPIC_API_KEY)');
  console.log('  - example-bash-agent (active, schedule disabled)');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
