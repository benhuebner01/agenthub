import { Bot, Context } from 'grammy';
import { db } from '../db';
import { agents, runs, budgets, schedules, telegramUsers, settings } from '../db/schema';
import { eq, desc, and, like } from 'drizzle-orm';
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

  if (authorizedUserIds.has(userId)) return true;

  const [dbUser] = await db
    .select()
    .from(telegramUsers)
    .where(and(eq(telegramUsers.telegramId, userId), eq(telegramUsers.authorized, true)));

  return !!dbUser;
}

async function upsertTelegramUser(ctx: Context): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  const existing = await db.select().from(telegramUsers).where(eq(telegramUsers.telegramId, userId));

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

// ─── Settings Helpers ─────────────────────────────────────────────────────────

async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  return row?.value ?? null;
}

async function setSetting(key: string, value: string): Promise<void> {
  const existing = await db.select().from(settings).where(eq(settings.key, key));
  const now = new Date().toISOString();
  if (existing.length > 0) {
    await db.update(settings).set({ value, updatedAt: now }).where(eq(settings.key, key));
  } else {
    await db.insert(settings).values({ key, value, updatedAt: now });
  }
}

// ─── Format Helpers ───────────────────────────────────────────────────────────

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

// ─── Run Agent Helper ─────────────────────────────────────────────────────────

async function runAgentWithFeedback(ctx: Context, agentRef: string, inputText: string): Promise<void> {
  const allAgents = await db.select().from(agents);
  const agent = allAgents.find(
    (a) => a.id === agentRef || a.name.toLowerCase() === agentRef.toLowerCase()
  );

  if (!agent) {
    await ctx.reply(`❌ Agent "${agentRef}" not found`);
    return;
  }

  const budgetCheck = await checkBudget(agent.id);
  if (!budgetCheck.allowed) {
    await ctx.reply(
      `⛔ Budget exceeded for *${agent.name}*\nSpent: $${budgetCheck.currentSpend.toFixed(4)} / $${budgetCheck.limit.toFixed(2)}`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const thinking = await ctx.reply('⏳ Running agent...');

  let input: unknown = {};
  if (inputText) {
    try {
      input = JSON.parse(inputText);
    } catch {
      input = { message: inputText };
    }
  }

  const result = await executeAgent(agent.id, input, 'telegram');

  if (result.costUsd > 0) {
    await recordSpend(agent.id, result.costUsd);
  }

  const outputStr = typeof result.output === 'object'
    ? JSON.stringify(result.output, null, 2)
    : String(result.output ?? '');

  if (result.success) {
    try {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        thinking.message_id,
        `✅ *${agent.name}* completed\n\n${outputStr.slice(0, 3500)}\n\n_Cost: $${result.costUsd.toFixed(4)} | Tokens: ${result.tokensUsed}_`,
        { parse_mode: 'Markdown' }
      );
    } catch {
      await ctx.reply(`✅ *${agent.name}* completed\n\n${outputStr.slice(0, 3500)}`, { parse_mode: 'Markdown' });
    }
  } else {
    try {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        thinking.message_id,
        `❌ *${agent.name}* failed\n\nError: ${result.error}`
      );
    } catch {
      await ctx.reply(`❌ *${agent.name}* failed\n\nError: ${result.error}`);
    }
  }
}

// ─── Bot Startup ──────────────────────────────────────────────────────────────

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
        `⚡ *Welcome to AgentHub!*\n\nYou are authorized.\n\nType /help to see available commands.`,
        { parse_mode: 'Markdown' }
      );
    } else {
      await ctx.reply(
        `⚡ *AgentHub Bot*\n\n⛔ You are not authorized.\nYour Telegram ID: \`${ctx.from?.id}\`\n\nContact the administrator to get access.`,
        { parse_mode: 'Markdown' }
      );
    }
  });

  // /help command
  bot.command('help', async (ctx) => {
    if (!(await isAuthorized(ctx))) { await ctx.reply('⛔ Unauthorized'); return; }

    await ctx.reply(
      `⚡ *AgentHub Commands*\n\n` +
      `/agents - List all agents\n` +
      `/run <name_or_id> [input] - Trigger an agent\n` +
      `/status [agent] - Show agent status\n` +
      `/budget [agent] - Show budget usage\n` +
      `/logs [agent] [limit] - Show recent runs\n` +
      `/pause <agent> - Pause agent schedules\n` +
      `/resume <agent> - Resume agent schedules\n` +
      `/route - Manage message routing\n` +
      `/routes - Show all command routes\n` +
      `/bind <command> <agent> - Bind a command to an agent\n` +
      `/settings - Show routing settings\n` +
      `/help - Show this message`,
      { parse_mode: 'Markdown' }
    );
  });

  // /settings command — show current routing config
  bot.command('settings', async (ctx) => {
    if (!(await isAuthorized(ctx))) { await ctx.reply('⛔ Unauthorized'); return; }

    const defaultAgentId = await getSetting('telegram_default_agent_id');
    const commandRoutesStr = await getSetting('telegram_command_routes');
    const commandRoutes: Record<string, string> = commandRoutesStr ? JSON.parse(commandRoutesStr) : {};

    let defaultAgentName = 'None configured';
    if (defaultAgentId) {
      const [agent] = await db.select().from(agents).where(eq(agents.id, defaultAgentId));
      defaultAgentName = agent?.name || defaultAgentId;
    }

    const routeLines = Object.entries(commandRoutes).map(async ([cmd, agentId]) => {
      const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
      return `  ${cmd} → ${agent?.name || agentId}`;
    });

    const resolvedRouteLines = await Promise.all(routeLines);

    await ctx.reply(
      `⚙️ *AgentHub Settings*\n\n` +
      `*Default message route:* ${defaultAgentName}\n\n` +
      `*Command routes:*\n${resolvedRouteLines.length > 0 ? resolvedRouteLines.join('\n') : '  None configured'}\n\n` +
      `Use /route to change routing, /bind to add command routes.`,
      { parse_mode: 'Markdown' }
    );
  });

  // /route command — manage default routing
  bot.command('route', async (ctx) => {
    if (!(await isAuthorized(ctx))) { await ctx.reply('⛔ Unauthorized'); return; }

    const args = ctx.match?.trim().split(' ') || [];
    const subCmd = args[0];

    if (!subCmd || subCmd === 'list') {
      const allAgents = await db.select().from(agents).where(eq(agents.status, 'active'));
      const lines = allAgents.map((a) => `• *${a.name}* (${a.type}) - ID: \`${a.id}\``);
      await ctx.reply(
        `🤖 *Available agents:*\n\n${lines.join('\n')}\n\nUse: /route set <agent_name_or_id>`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (subCmd === 'set') {
      const agentRef = args[1];
      if (!agentRef) {
        await ctx.reply('Usage: /route set <agent_name_or_id>');
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

      await setSetting('telegram_default_agent_id', agent.id);
      await ctx.reply(`✅ Default route set to *${agent.name}*\n\nNow all free-text messages will be sent to this agent.`, { parse_mode: 'Markdown' });
      return;
    }

    if (subCmd === 'clear') {
      await setSetting('telegram_default_agent_id', '');
      await ctx.reply('✅ Default route cleared. Free-text messages will not be routed to any agent.');
      return;
    }

    await ctx.reply('Usage: /route list | /route set <agent> | /route clear');
  });

  // /routes command — show all command → agent mappings
  bot.command('routes', async (ctx) => {
    if (!(await isAuthorized(ctx))) { await ctx.reply('⛔ Unauthorized'); return; }

    const commandRoutesStr = await getSetting('telegram_command_routes');
    const commandRoutes: Record<string, string> = commandRoutesStr ? JSON.parse(commandRoutesStr) : {};

    if (Object.keys(commandRoutes).length === 0) {
      await ctx.reply('No command routes configured.\n\nUse /bind <command> <agent_name> to add one.');
      return;
    }

    const lines = await Promise.all(
      Object.entries(commandRoutes).map(async ([cmd, agentId]) => {
        const [agent] = await db.select().from(agents).where(eq(agents.id, agentId));
        return `• ${cmd} → *${agent?.name || agentId}*`;
      })
    );

    await ctx.reply(
      `🗺️ *Command Routes*\n\n${lines.join('\n')}\n\nUse /bind <command> <agent> to add, /bind remove <command> to remove.`,
      { parse_mode: 'Markdown' }
    );
  });

  // /bind command — bind a command to an agent
  bot.command('bind', async (ctx) => {
    if (!(await isAuthorized(ctx))) { await ctx.reply('⛔ Unauthorized'); return; }

    const args = ctx.match?.trim().split(' ') || [];

    if (args[0] === 'remove' && args[1]) {
      const command = args[1].startsWith('/') ? args[1] : `/${args[1]}`;
      const commandRoutesStr = await getSetting('telegram_command_routes');
      const commandRoutes: Record<string, string> = commandRoutesStr ? JSON.parse(commandRoutesStr) : {};
      delete commandRoutes[command];
      await setSetting('telegram_command_routes', JSON.stringify(commandRoutes));
      await ctx.reply(`✅ Command route ${command} removed.`);
      return;
    }

    if (args.length < 2) {
      await ctx.reply('Usage: /bind <command> <agent_name_or_id>\nExample: /bind research Research-Agent\nOr: /bind remove <command>');
      return;
    }

    const command = args[0].startsWith('/') ? args[0] : `/${args[0]}`;
    const agentRef = args.slice(1).join(' ');

    const allAgents = await db.select().from(agents);
    const agent = allAgents.find(
      (a) => a.id === agentRef || a.name.toLowerCase() === agentRef.toLowerCase()
    );

    if (!agent) {
      await ctx.reply(`❌ Agent "${agentRef}" not found. Use /route list to see available agents.`);
      return;
    }

    const commandRoutesStr = await getSetting('telegram_command_routes');
    const commandRoutes: Record<string, string> = commandRoutesStr ? JSON.parse(commandRoutesStr) : {};
    commandRoutes[command] = agent.id;
    await setSetting('telegram_command_routes', JSON.stringify(commandRoutes));

    await ctx.reply(
      `✅ Command *${command}* bound to *${agent.name}*\n\nNow send "${command} your task here" to route to this agent.`,
      { parse_mode: 'Markdown' }
    );
  });

  // /agents command
  bot.command('agents', async (ctx) => {
    if (!(await isAuthorized(ctx))) { await ctx.reply('⛔ Unauthorized'); return; }

    const allAgents = await db.select().from(agents).orderBy(agents.name);

    if (allAgents.length === 0) {
      await ctx.reply('No agents found. Create one via the web dashboard.');
      return;
    }

    const lines = allAgents.map(
      (a) => `• *${a.name}* (${a.type}) [${a.role || 'worker'}]\n  ${formatStatus(a.status)}`
    );

    await ctx.reply(
      `⚡ *Agents* (${allAgents.length} total)\n\n${lines.join('\n\n')}`,
      { parse_mode: 'Markdown' }
    );
  });

  // /run command
  bot.command('run', async (ctx) => {
    if (!(await isAuthorized(ctx))) { await ctx.reply('⛔ Unauthorized'); return; }

    const args = ctx.match?.trim() || '';
    if (!args) {
      await ctx.reply('Usage: /run <agent_name_or_id> [input]');
      return;
    }

    const parts = args.split(' ');
    const agentRef = parts[0];
    const inputStr = parts.slice(1).join(' ');

    await runAgentWithFeedback(ctx, agentRef, inputStr);
  });

  // /status command
  bot.command('status', async (ctx) => {
    if (!(await isAuthorized(ctx))) { await ctx.reply('⛔ Unauthorized'); return; }

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
        `*${agent.name}*\nType: ${agent.type}\nRole: ${agent.role || 'worker'}\nStatus: ${formatStatus(agent.status)}\n\n*Recent Runs:*\n${runLines.join('\n') || 'No runs yet'}`,
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
    if (!(await isAuthorized(ctx))) { await ctx.reply('⛔ Unauthorized'); return; }

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
      const filled = Math.min(10, Math.round((spend / limit) * 10));
      const bar = '█'.repeat(filled) + '░'.repeat(Math.max(0, 10 - filled));
      return `*${b.agentName}* (${b.period})\n${bar} ${pct}%\n$${spend.toFixed(4)} / $${limit.toFixed(2)}`;
    });

    await ctx.reply(`💰 *Budget Usage*\n\n${lines.join('\n\n')}`, { parse_mode: 'Markdown' });
  });

  // /logs command
  bot.command('logs', async (ctx) => {
    if (!(await isAuthorized(ctx))) { await ctx.reply('⛔ Unauthorized'); return; }

    const args = ctx.match?.trim().split(' ') || [];
    const agentRef = args[0];
    const limit = parseInt(args[1] || '10', 10);

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
      : await db
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

    if (recentRuns.length === 0) {
      await ctx.reply('No runs found.');
      return;
    }

    const lines = recentRuns.map(
      (r) =>
        `${formatStatus(r.status)} *${r.agentName}*\n  ${r.triggeredBy} | ${formatDuration(r.startedAt, r.completedAt)} | $${(r.costUsd as number).toFixed(4)}`
    );

    await ctx.reply(`📋 *Recent Runs*\n\n${lines.join('\n\n')}`, { parse_mode: 'Markdown' });
  });

  // /pause command
  bot.command('pause', async (ctx) => {
    if (!(await isAuthorized(ctx))) { await ctx.reply('⛔ Unauthorized'); return; }

    const agentRef = ctx.match?.trim();
    if (!agentRef) { await ctx.reply('Usage: /pause <agent_name_or_id>'); return; }

    const allAgents = await db.select().from(agents);
    const agent = allAgents.find(
      (a) => a.id === agentRef || a.name.toLowerCase() === agentRef.toLowerCase()
    );

    if (!agent) { await ctx.reply(`❌ Agent "${agentRef}" not found`); return; }

    await db.update(agents).set({ status: 'paused', updatedAt: new Date().toISOString() }).where(eq(agents.id, agent.id));

    const agentSchedules = await db.select().from(schedules).where(eq(schedules.agentId, agent.id));
    for (const schedule of agentSchedules) {
      await removeSchedule(schedule.id);
    }

    await ctx.reply(`⏸️ Agent *${agent.name}* paused`, { parse_mode: 'Markdown' });
  });

  // /resume command
  bot.command('resume', async (ctx) => {
    if (!(await isAuthorized(ctx))) { await ctx.reply('⛔ Unauthorized'); return; }

    const agentRef = ctx.match?.trim();
    if (!agentRef) { await ctx.reply('Usage: /resume <agent_name_or_id>'); return; }

    const allAgents = await db.select().from(agents);
    const agent = allAgents.find(
      (a) => a.id === agentRef || a.name.toLowerCase() === agentRef.toLowerCase()
    );

    if (!agent) { await ctx.reply(`❌ Agent "${agentRef}" not found`); return; }

    await db.update(agents).set({ status: 'active', updatedAt: new Date().toISOString() }).where(eq(agents.id, agent.id));

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

  // Handle all other messages (free text + command routing)
  bot.on('message', async (ctx) => {
    if (!(await isAuthorized(ctx))) {
      await ctx.reply('⛔ Unauthorized. Use /start to see your ID.');
      return;
    }

    const text = (ctx.message as any)?.text as string | undefined;
    if (!text) return;

    // Check for custom command routes first
    if (text.startsWith('/')) {
      const parts = text.split(' ');
      const command = parts[0].toLowerCase();
      const inputText = parts.slice(1).join(' ');

      const commandRoutesStr = await getSetting('telegram_command_routes');
      const commandRoutes: Record<string, string> = commandRoutesStr ? JSON.parse(commandRoutesStr) : {};

      if (commandRoutes[command]) {
        const targetAgentId = commandRoutes[command];
        const [agent] = await db.select().from(agents).where(eq(agents.id, targetAgentId));
        if (agent) {
          await runAgentWithFeedback(ctx, agent.name, inputText);
          return;
        }
      }

      // Unknown command — show hint
      await ctx.reply('Unknown command. Type /help to see available commands.');
      return;
    }

    // Free-text message — route to default agent
    const defaultAgentId = await getSetting('telegram_default_agent_id');
    if (!defaultAgentId) {
      await ctx.reply(
        '⚠️ No default agent set. Use /route set <agent_name> to configure one, or /run <agent_name> <message> to run a specific agent.'
      );
      return;
    }

    const [defaultAgent] = await db.select().from(agents).where(eq(agents.id, defaultAgentId));
    if (!defaultAgent) {
      await ctx.reply('⚠️ Default agent not found. Use /route set <agent_name> to reconfigure.');
      return;
    }

    await runAgentWithFeedback(ctx, defaultAgent.name, text);
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
