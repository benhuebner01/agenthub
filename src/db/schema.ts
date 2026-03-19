import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

// Agents table
export const agents = sqliteTable('agents', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  description: text('description'),
  type: text('type').notNull(), // 'http' | 'claude' | 'openai' | 'bash'
  config: text('config', { mode: 'json' }).notNull().default('{}'),
  status: text('status').notNull().default('active'), // 'active' | 'paused' | 'error'
  createdAt: text('created_at').$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').$defaultFn(() => new Date().toISOString()),
});

// Schedules table
export const schedules = sqliteTable('schedules', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  cronExpression: text('cron_expression').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  lastRunAt: text('last_run_at'),
  nextRunAt: text('next_run_at'),
  createdAt: text('created_at').$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').$defaultFn(() => new Date().toISOString()),
});

// Runs table
export const runs = sqliteTable('runs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  scheduleId: text('schedule_id').references(() => schedules.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('pending'), // 'pending'|'running'|'success'|'failed'|'cancelled'
  startedAt: text('started_at').$defaultFn(() => new Date().toISOString()),
  completedAt: text('completed_at'),
  input: text('input', { mode: 'json' }),
  output: text('output', { mode: 'json' }),
  error: text('error'),
  tokensUsed: integer('tokens_used').notNull().default(0),
  costUsd: real('cost_usd').notNull().default(0),
  triggeredBy: text('triggered_by').notNull().default('manual'), // 'schedule'|'manual'|'telegram'|'api'
  createdAt: text('created_at').$defaultFn(() => new Date().toISOString()),
});

// Budgets table
export const budgets = sqliteTable('budgets', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  agentId: text('agent_id').notNull().unique().references(() => agents.id, { onDelete: 'cascade' }),
  period: text('period').notNull().default('monthly'), // 'daily'|'weekly'|'monthly'
  limitUsd: real('limit_usd').notNull(),
  currentSpend: real('current_spend').notNull().default(0),
  periodStart: text('period_start').$defaultFn(() => new Date().toISOString()),
  createdAt: text('created_at').$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').$defaultFn(() => new Date().toISOString()),
});

// Audit logs table
export const auditLogs = sqliteTable('audit_logs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  runId: text('run_id').references(() => runs.id, { onDelete: 'set null' }),
  agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  data: text('data', { mode: 'json' }),
  createdAt: text('created_at').$defaultFn(() => new Date().toISOString()),
});

// Tool calls table
export const toolCalls = sqliteTable('tool_calls', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  runId: text('run_id').notNull().references(() => runs.id, { onDelete: 'cascade' }),
  toolName: text('tool_name').notNull(),
  input: text('input', { mode: 'json' }),
  output: text('output', { mode: 'json' }),
  durationMs: integer('duration_ms').notNull().default(0),
  createdAt: text('created_at').$defaultFn(() => new Date().toISOString()),
});

// Telegram users table
export const telegramUsers = sqliteTable('telegram_users', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  telegramId: integer('telegram_id').notNull().unique(),
  username: text('username'),
  firstName: text('first_name'),
  authorized: integer('authorized', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').$defaultFn(() => new Date().toISOString()),
});

// Relations
export const agentsRelations = relations(agents, ({ many, one }) => ({
  schedules: many(schedules),
  runs: many(runs),
  budget: one(budgets, { fields: [agents.id], references: [budgets.agentId] }),
  auditLogs: many(auditLogs),
}));

export const schedulesRelations = relations(schedules, ({ one, many }) => ({
  agent: one(agents, { fields: [schedules.agentId], references: [agents.id] }),
  runs: many(runs),
}));

export const runsRelations = relations(runs, ({ one, many }) => ({
  agent: one(agents, { fields: [runs.agentId], references: [agents.id] }),
  schedule: one(schedules, { fields: [runs.scheduleId], references: [schedules.id] }),
  toolCalls: many(toolCalls),
  auditLogs: many(auditLogs),
}));

export const budgetsRelations = relations(budgets, ({ one }) => ({
  agent: one(agents, { fields: [budgets.agentId], references: [agents.id] }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  run: one(runs, { fields: [auditLogs.runId], references: [runs.id] }),
  agent: one(agents, { fields: [auditLogs.agentId], references: [agents.id] }),
}));

export const toolCallsRelations = relations(toolCalls, ({ one }) => ({
  run: one(runs, { fields: [toolCalls.runId], references: [runs.id] }),
}));

// Type exports
export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type Schedule = typeof schedules.$inferSelect;
export type NewSchedule = typeof schedules.$inferInsert;
export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
export type Budget = typeof budgets.$inferSelect;
export type NewBudget = typeof budgets.$inferInsert;
export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;
export type ToolCall = typeof toolCalls.$inferSelect;
export type NewToolCall = typeof toolCalls.$inferInsert;
export type TelegramUser = typeof telegramUsers.$inferSelect;
export type NewTelegramUser = typeof telegramUsers.$inferInsert;
