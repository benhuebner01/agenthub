import { Bot, Context, session } from 'grammy';
import { db } from '../db';
import { agents, runs, budgets, schedules, telegramUsers, auditLogs } from '../db/schema';
import { eq, desc, and, like, or } from 'drizzle-orm';
import { executeAgent } from './executor';
import { checkBudget, recordSpend } from './budget';
import { scheduleAgent, removeSchedule } from './scheduler';
import { v4 as uuidv4 } from 'uuid';

let bot: Bot | null = null;
let authorizedUserIds: Set<number> = new Set();

function parseAuthorizedUsers(): Set<number> {
  const envUsers = process.env.TELEGRAM_AUTHORIZED_USERS || '';
  const ids = envUsers.split(',').map((id) => parseInt(id.trim(), 10)).filter((id) => !isNaN(id));
  return new Set(ids);
}

async function isAuthorized(ctx: Context): Promise<boolean> {
  const userId = ctx.from?.id;
  if (!userId) return false;

  // Check env whitelist
  if (authorizedUserIds.has(userId)) return true;

  // Check database
  const [dbUser] = await db
    .select()
    .from(telegramUsers)
    .where(and(eq(telegramUsers.telegramId, userId), eq(telegramUsers.authorized, true)));

  return !!dbUser;
}

async function upsertTelegramUser(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const existing = await db
    .select()
    .from(telegramUsers)
    .where(eq(telegramUsers.telegramId, userId));

  if (existing.length === 0) {
    await db.insert(telegramUsers).values({
      id: uuidv4(),
      telegramId: userId,
      username: ctx.from?.username || null,
      firstName: ctx.from?.first_name || null,
      authorized: authorizedUserIds.has(userId),
      createdAt: new Date().toISOString(),
    });
  }
}

function formatStatus(status: string): string {
  const icons: Record<string, string> = {
    active: '✅',
    paused: '⏸️',
    error: '❌',
    running: '🔄',
    success: '✅',
    failed: '❌',
    pending: '⏳',
    cancelled: '🚫',
  };
  return `${icons[status] || '❓'} ${status}`;
}

function formatDuration(startedAt: string | null, completedAt: string | null): string {
  if (!completedAt || !startedAt) return 'running...';
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

export async function startTelegramBot(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log('[Telegram] No TELEGRAM_BOT_TOKEN set, skipping bot startup');
    return;
  }

  authorizedUserIds = parseAuthorizedUsers();
  bot = new Bot(token);

  // /start command
  bot.command('start', async (ctx) => {
    await upsertTelegramUser(ctx);
    const authorized = await isAuthorized(ctx);

    if (authorized) {
      await ctx.reply(
        `⚡ *Welcome to AgentHub!*\n\nYou are authorized to use this bot.\n\nType /help to see available commands.`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await ctx.reply(
        `⚡ *AgentHub Bot*\n\n⛔ You are not authorized to use this bot.\nYour Telegram ID: \`${ctx.from?.id}\`\n\nContact the administrator to get access.`,
        { parse_mode: 'Markdown' }
      );
    }
  });

  // /help command
  bot.command('help', async (ctx) => {
    if (!(await isAuthorized(ctx))) {
      await ctx.reply('⛔ Unauthorized');
      return;
    }

    await ctx.reply(
      `⚡ *AgentHub Commands*\n\n` +
      `/agents - List all agents\n` +
      `/run <name_or_id> [input] - Trigger an agent\n` +
      `/status [agent] - Show agent status\n` +
      `/budget [agent] - Show budget usage\n` +
      `/logs [agent] [limit] - Show recent runs\n` +
      `/pause <agent> - Pause agent schedules\n` +
      `/resume <agent> - Resume agent schedules\n` +
      `/help - Show this message`,
      { parse_mode: 'Markdown' }
    );
  });

  // /agents command
  bot.command('agents', async (ctx) => {
    if (!(await isAuthorized(ctx))) {
      await ctx.reply('⛔ Unauthorized');
      return;
    }

    const allAgents = await db.select().from(agents).orderBy(agents.name);

    if (allAgents.length === 0) {
      await ctx.reply('No agents found. Create one via the web dashboard.');
      return;
    }

    const lines = allAgents.map(
      (a) => `• *${a.name}* (${a.type})\n  ${formatStatus(a.status)}`
    );

    await ctx.reply(
      `⚡ *Agents* (${allAgents.length} total)\n\n${lines.join('\n\n')}`,
      { parse_mode: 'Markdown' }
    );
  });

  // /run command
  bot.command('run', async (ctx) => {
    if (!(await isAuthorized(ctx))) {
      await ctx.reply('⛔ Unauthorized');
      return;
    }

    const args = ctx.match?.trim() || '';
    if (!args) {
      await ctx.reply('Usage: /run <agent_name_or_id> [input_json]');
      return;
    }

    const parts = args.split(' ');
    const agentRef = parts[0];
    const inputStr = parts.slice(1).join(' ');

    let input: unknown = {};
    if (inputStr) {
      try {
        input = JSON.parse(inputStr);
      } catch {
        input = { message: inputStr };
      }
    }

    // Find agent by name or id
    const allAgents = await db.select().from(agents);
    const agent = allAgents.find(
      (a) => a.id === agentRef || a.name.toLowerCase() === agentRef.toLowerCase()
    );

    if (!agent) {
      await ctx.reply(`❌ Agent "${agentRef}" not found`);
      return;
    }

    // Check budget
    const budgetCheck = await checkBudget(agent.id);
    if (!budgetCheck.allowed) {
      await ctx.reply(
        `⛔ Budget exceeded for *${agent.name}*\n` +
        `Spent: $${budgetCheck.currentSpend.toFixed(4)} / $${budgetCheck.limit.toFixed(2)}`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    await ctx.reply(`🚀 Starting agent *${agent.name}*...`, { parse_mode: 'Markdown' });

    const result = await executeAgent(agent.id, input, 'telegram');

    if (result.costUsd > 0) {
      await recordSpend(agent.id, result.costUsd);
    }

    if (result.success) {
      const outputStr = typeof result.output === 'object'
        ? JSON.stringify(result.output, null, 2)
        : String(result.output);

      await ctx.reply(
        `✅ *${agent.name}* completed\n\n` +
        `Tokens: ${result.tokensUsed}\n` +
        `Cost: $${result.costUsd.toFixed(6)}\n\n` +
        `Output:\n\`\`\`\n${outputStr.slice(0, 1000)}\n\`\`\``,
        { parse_mode: 'Markdown' }
      );
    } else {
      await ctx.reply(
        `❌ *${agent.name}* failed\n\nError: ${result.error}`,
        { parse_mode: 'Markdown' }
      );
    }
  });

  // /status command
  bot.command('status', async (ctx) => {
    if (!(await isAuthorized(ctx))) {
      await ctx.reply('⛔ Unauthorized');
      return;
    }

    const agentRef = ctx.match?.trim();

    if (agentRef) {
      const allAgents = await db.select().from(agents);
      const agent = allAgents.find(
        (a) => a.id === agentRef || a.name.toLowerCase() === agentRef.toLowerCase()
      );

      if (!agent) {
        await ctx.reply(`❌ Agent "${agentRef}" not found`);
        return;
      }

      const recentRuns = await db
        .select()
        .from(runs)
        .where(eq(runs.agentId, agent.id))
        .orderBy(desc(runs.createdAt))
        .limit(5);

      const runLines = recentRuns.map(
        (r) => `• ${formatStatus(r.status)} - ${r.triggeredBy} - ${formatDuration(r.startedAt, r.completedAt)}`
      );

      await ctx.reply(
        `*${agent.name}*\n` +
        `Type: ${agent.type}\n` +
        `Status: ${formatStatus(agent.status)}\n\n` +
        `*Recent Runs:*\n${runLines.join('\n') || 'No runs yet'}`,
        { parse_mode: 'Markdown' }
      );
    } else {
      const allAgents = await db.select().from(agents);
      const lines = allAgents.map((a) => `• *${a.name}*: ${formatStatus(a.status)}`);
      await ctx.reply(
        `*Agent Status*\n\n${lines.join('\n') || 'No agents found'}`,
        { parse_mode: 'Markdown' }
      );
    }
  });

  // /budget command
  bot.command('budget', async (ctx) => {
    if (!(await isAuthorized(ctx))) {
      await ctx.reply('⛔ Unauthorized');
      return;
    }

    const agentRef = ctx.match?.trim();
    const allBudgets = await db
      .select({
        agentName: agents.name,
        agentId: agents.id,
        period: budgets.period,
        limitUsd: budgets.limitUsd,
        currentSpend: budgets.currentSpend,
        periodStart: budgets.periodStart,
      })
      .from(budgets)
      .innerJoin(agents, eq(budgets.agentId, agents.id));

    const filteredBudgets = agentRef
      ? allBudgets.filter(
          (b) => b.agentId === agentRef || b.agentName.toLowerCase() === agentRef.toLowerCase()
        )
      : allBudgets;

    if (filteredBudgets.length === 0) {
      await ctx.reply('No budgets found.');
      return;
    }

    const lines = filteredBudgets.map((b) => {
      const limit = b.limitUsd as number;
      const spend = b.currentSpend as number;
      const pct = limit > 0 ? ((spend / limit) * 100).toFixed(1) : '0';
      const bar = '█'.repeat(Math.min(10, Math.round((spend / limit) * 10))) + '░'.repeat(Math.max(0, 10 - Math.round((spend / limit) * 10)));
      return `*${b.agentName}* (${b.period})\n${bar} ${pct}%\n$${spend.toFixed(4)} / $${limit.toFixed(2)}`;
    });

    await ctx.reply(
      `💰 *Budget Usage*\n\n${lines.join('\n\n')}`,
      { parse_mode: 'Markdown' }
    );
  });

  // /logs command
  bot.command('logs', async (ctx) => {
    if (!(await isAuthorized(ctx))) {
      await ctx.reply('⛔ Unauthorized');
      return;
    }

    const args = ctx.match?.trim().split(' ') || [];
    const agentRef = args[0];
    const limit = parseInt(args[1] || '10', 10);

    let query = db
      .select({
        id: runs.id,
        agentName: agents.name,
        status: runs.status,
        triggeredBy: runs.triggeredBy,
        startedAt: runs.startedAt,
        completedAt: runs.completedAt,
        costUsd: runs.costUsd,
      })
      .from(runs)
      .innerJoin(agents, eq(runs.agentId, agents.id))
      .orderBy(desc(runs.createdAt))
      .limit(Math.min(limit, 20));

    const recentRuns = agentRef
      ? await db
          .select({
            id: runs.id,
            agentName: agents.name,
            status: runs.status,
            triggeredBy: runs.triggeredBy,
            startedAt: runs.startedAt,
            completedAt: runs.completedAt,
            costUsd: runs.costUsd,
          })
          .from(runs)
          .innerJoin(agents, eq(runs.agentId, agents.id))
          .where(like(agents.name, `%${agentRef}%`))
          .orderBy(desc(runs.createdAt))
          .limit(Math.min(limit, 20))
      : await query;

    if (recentRuns.length === 0) {
      await ctx.reply('No runs found.');
      return;
    }

    const lines = recentRuns.map(
      (r) =>
        `${formatStatus(r.status)} *${r.agentName}*\n` +
        `  ${r.triggeredBy} | ${formatDuration(r.startedAt, r.completedAt)} | $${(r.costUsd as number).toFixed(4)}`
    );

    await ctx.reply(
      `📋 *Recent Runs*\n\n${lines.join('\n\n')}`,
      { parse_mode: 'Markdown' }
    );
  });

  // /pause command
  bot.command('pause', async (ctx) => {
    if (!(await isAuthorized(ctx))) {
      await ctx.reply('⛔ Unauthorized');
      return;
    }

    const agentRef = ctx.match?.trim();
    if (!agentRef) {
      await ctx.reply('Usage: /pause <agent_name_or_id>');
      return;
    }

    const allAgents = await db.select().from(agents);
    const agent = allAgents.find(
      (a) => a.id === agentRef || a.name.toLowerCase() === agentRef.toLowerCase()
    );

    if (!agent) {
      await ctx.reply(`❌ Agent "${agentRef}" not found`);
      return;
    }

    // Update agent status
    await db
      .update(agents)
      .set({ status: 'paused', updatedAt: new Date().toISOString() })
      .where(eq(agents.id, agent.id));

    // Disable all schedules
    const agentSchedules = await db
      .select()
      .from(schedules)
      .where(eq(schedules.agentId, agent.id));

    for (const schedule of agentSchedules) {
      await removeSchedule(schedule.id);
    }

    await ctx.reply(`⏸️ Agent *${agent.name}* paused`, { parse_mode: 'Markdown' });
  });

  // /resume command
  bot.command('resume', async (ctx) => {
    if (!(await isAuthorized(ctx))) {
      await ctx.reply('⛔ Unauthorized');
      return;
    }

    const agentRef = ctx.match?.trim();
    if (!agentRef) {
      await ctx.reply('Usage: /resume <agent_name_or_id>');
      return;
    }

    const allAgents = await db.select().from(agents);
    const agent = allAgents.find(
      (a) => a.id === agentRef || a.name.toLowerCase() === agentRef.toLowerCase()
    );

    if (!agent) {
      await ctx.reply(`❌ Agent "${agentRef}" not found`);
      return;
    }

    // Update agent status
    await db
      .update(agents)
      .set({ status: 'active', updatedAt: new Date().toISOString() })
      .where(eq(agents.id, agent.id));

    // Re-enable schedules
    const agentSchedules = await db
      .select()
      .from(schedules)
      .where(and(eq(schedules.agentId, agent.id), eq(schedules.enabled, true)));

    for (const schedule of agentSchedules) {
      await scheduleAgent({
        id: schedule.id,
        agentId: schedule.agentId,
        cronExpression: schedule.cronExpression,
        enabled: true,
      });
    }

    await ctx.reply(`▶️ Agent *${agent.name}* resumed`, { parse_mode: 'Markdown' });
  });

  // Handle unknown commands
  bot.on('message', async (ctx) => {
    if (!(await isAuthorized(ctx))) {
      await ctx.reply('⛔ Unauthorized. Use /start to see your ID.');
      return;
    }
    await ctx.reply('Unknown command. Type /help to see available commands.');
  });

  // Error handler
  bot.catch((err) => {
    console.error('[Telegram] Bot error:', err);
  });

  // Start polling
  bot.start({
    onStart: (info) => {
      console.log(`[Telegram] Bot started as @${info.username}`);
    },
  });
}

export async function sendTelegramNotification(message: string): Promise<void> {
  if (!bot) return;

  const authorizedIds = Array.from(authorizedUserIds);

  for (const userId of authorizedIds) {
    try {
      await bot.api.sendMessage(userId, message, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error(`[Telegram] Failed to send notification to ${userId}:`, err);
    }
  }
}

export function getTelegramBot(): Bot | null {
  return bot;
}
