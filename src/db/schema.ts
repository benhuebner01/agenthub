import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  jsonb,
  integer,
  numeric,
  bigint,
  pgEnum,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Enums
export const agentTypeEnum = pgEnum('agent_type', ['http', 'claude', 'openai', 'bash']);
export const agentStatusEnum = pgEnum('agent_status', ['active', 'paused', 'error']);
export const runStatusEnum = pgEnum('run_status', ['pending', 'running', 'success', 'failed', 'cancelled']);
export const triggeredByEnum = pgEnum('triggered_by', ['schedule', 'manual', 'telegram', 'api']);
export const budgetPeriodEnum = pgEnum('budget_period', ['daily', 'weekly', 'monthly']);

// Agents table
export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  type: agentTypeEnum('type').notNull(),
  config: jsonb('config').notNull().default({}),
  status: agentStatusEnum('status').notNull().default('active'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Schedules table
export const schedules = pgTable('schedules', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  cronExpression: varchar('cron_expression', { length: 255 }).notNull(),
  enabled: boolean('enabled').notNull().default(true),
  lastRunAt: timestamp('last_run_at'),
  nextRunAt: timestamp('next_run_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Runs table
export const runs = pgTable('runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  scheduleId: uuid('schedule_id').references(() => schedules.id, { onDelete: 'set null' }),
  status: runStatusEnum('status').notNull().default('pending'),
  startedAt: timestamp('started_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
  input: jsonb('input'),
  output: jsonb('output'),
  error: text('error'),
  tokensUsed: integer('tokens_used').notNull().default(0),
  costUsd: numeric('cost_usd', { precision: 10, scale: 6 }).notNull().default('0'),
  triggeredBy: triggeredByEnum('triggered_by').notNull().default('manual'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Budgets table
export const budgets = pgTable('budgets', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id')
    .notNull()
    .unique()
    .references(() => agents.id, { onDelete: 'cascade' }),
  period: budgetPeriodEnum('period').notNull().default('monthly'),
  limitUsd: numeric('limit_usd', { precision: 10, scale: 2 }).notNull(),
  currentSpend: numeric('current_spend', { precision: 10, scale: 6 }).notNull().default('0'),
  periodStart: timestamp('period_start').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Audit logs table
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').references(() => runs.id, { onDelete: 'set null' }),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  eventType: varchar('event_type', { length: 255 }).notNull(),
  data: jsonb('data').notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Tool calls table
export const toolCalls = pgTable('tool_calls', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id')
    .notNull()
    .references(() => runs.id, { onDelete: 'cascade' }),
  toolName: varchar('tool_name', { length: 255 }).notNull(),
  input: jsonb('input'),
  output: jsonb('output'),
  durationMs: integer('duration_ms').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// Telegram users table
export const telegramUsers = pgTable('telegram_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  telegramId: bigint('telegram_id', { mode: 'number' }).notNull().unique(),
  username: varchar('username', { length: 255 }),
  firstName: varchar('first_name', { length: 255 }),
  authorized: boolean('authorized').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
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
