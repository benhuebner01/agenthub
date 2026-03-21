import { sqliteTable, text, integer, real, unique } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

// Organizations table
export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  description: text('description'),
  industry: text('industry'),
  goals: text('goals', { mode: 'json' }), // string[]
  status: text('status').notNull().default('active'), // 'active' | 'paused'
  createdAt: text('created_at').$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').$defaultFn(() => new Date().toISOString()),
});

// Agents table
export const agents = sqliteTable('agents', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  description: text('description'),
  type: text('type').notNull(), // 'http' | 'claude' | 'openai' | 'bash'
  config: text('config', { mode: 'json' }).notNull().default('{}'),
  status: text('status').notNull().default('active'), // 'active' | 'paused' | 'error'
  // Hierarchy fields
  parentAgentId: text('parent_agent_id'), // self-reference, no FK to avoid circular
  role: text('role').notNull().default('worker'), // 'ceo' | 'manager' | 'worker' | 'specialist'
  jobDescription: text('job_description'),
  organizationId: text('organization_id'),
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
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  costUsd: real('cost_usd').notNull().default(0),
  model: text('model'),
  durationMs: integer('duration_ms'),
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

// Settings table
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').$defaultFn(() => new Date().toISOString()),
});

// Agent Memory table — persistent key-value per agent
export const agentMemory = sqliteTable('agent_memory', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').$defaultFn(() => new Date().toISOString()),
}, (t) => ({ unq: unique().on(t.agentId, t.key) }));

// Agent Calls table — agent-to-agent delegation
export const agentCalls = sqliteTable('agent_calls', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  callerAgentId: text('caller_agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  calleeAgentId: text('callee_agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  runId: text('run_id').references(() => runs.id, { onDelete: 'set null' }),
  input: text('input', { mode: 'json' }),
  output: text('output', { mode: 'json' }),
  status: text('status').notNull().default('pending'), // pending | running | success | failed
  costUsd: real('cost_usd').notNull().default(0),
  createdAt: text('created_at').$defaultFn(() => new Date().toISOString()),
  completedAt: text('completed_at'),
});

// Proposals table — CEO proposes new agents/strategy changes
export const proposals = sqliteTable('proposals', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  proposedByAgentId: text('proposed_by_agent_id').references(() => agents.id, { onDelete: 'set null' }),
  type: text('type').notNull(), // 'hire_agent' | 'restructure' | 'budget_increase' | 'strategy'
  title: text('title').notNull(),
  details: text('details', { mode: 'json' }).notNull(),
  reasoning: text('reasoning'),
  estimatedCostUsd: real('estimated_cost_usd'),
  status: text('status').notNull().default('pending'), // pending | approved | rejected
  userNotes: text('user_notes'),
  createdAt: text('created_at').$defaultFn(() => new Date().toISOString()),
  resolvedAt: text('resolved_at'),
});

// Shared Memory — organization-wide key-value store (Paperclip-style centralized hub)
export const sharedMemory = sqliteTable('shared_memory', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  key: text('key').notNull(),
  value: text('value').notNull(),
  createdByAgentId: text('created_by_agent_id').references(() => agents.id, { onDelete: 'set null' }),
  updatedAt: text('updated_at').$defaultFn(() => new Date().toISOString()),
}, (t) => ({ unq: unique().on(t.organizationId, t.key) }));

// Daily Notes — journal entries per agent, created each heartbeat/run
export const dailyNotes = sqliteTable('daily_notes', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  organizationId: text('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  date: text('date').notNull(), // YYYY-MM-DD
  content: text('content').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// Knowledge Base — structured knowledge files per agent or org
export const knowledgeBase = sqliteTable('knowledge_base', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').references(() => agents.id, { onDelete: 'cascade' }),
  organizationId: text('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  category: text('category').notNull(), // 'projects' | 'areas' | 'resources' | 'archives' (PARA)
  title: text('title').notNull(),
  content: text('content').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// Tacit Knowledge — accumulated operational wisdom per agent
export const tacitKnowledge = sqliteTable('tacit_knowledge', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  topic: text('topic').notNull(),
  insight: text('insight').notNull(),
  confidence: real('confidence').default(0.5), // 0-1 confidence score
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

// API Keys — encrypted storage for provider keys (managed via UI)
export const apiKeys = sqliteTable('api_keys', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  provider: text('provider').notNull(), // 'anthropic' | 'openai' | 'custom'
  encryptedKey: text('encrypted_key').notNull(),
  keyHint: text('key_hint').notNull(), // last 4 chars, e.g. "abcd"
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').$defaultFn(() => new Date().toISOString()),
  updatedAt: text('updated_at').$defaultFn(() => new Date().toISOString()),
});

// Type exports for settings
export type Setting = typeof settings.$inferSelect;
export type NewSetting = typeof settings.$inferInsert;

// Relations
export const organizationsRelations = relations(organizations, ({ many }) => ({
  agents: many(agents),
  proposals: many(proposals),
  sharedMemory: many(sharedMemory),
}));

export const sharedMemoryRelations = relations(sharedMemory, ({ one }) => ({
  organization: one(organizations, { fields: [sharedMemory.organizationId], references: [organizations.id] }),
  createdByAgent: one(agents, { fields: [sharedMemory.createdByAgentId], references: [agents.id] }),
}));

export const agentsRelations = relations(agents, ({ many, one }) => ({
  schedules: many(schedules),
  runs: many(runs),
  budget: one(budgets, { fields: [agents.id], references: [budgets.agentId] }),
  auditLogs: many(auditLogs),
  organization: one(organizations, { fields: [agents.organizationId], references: [organizations.id] }),
  memory: many(agentMemory),
  callerCalls: many(agentCalls, { relationName: 'callerAgent' }),
  calleeCalls: many(agentCalls, { relationName: 'calleeAgent' }),
  proposals: many(proposals),
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

export const agentMemoryRelations = relations(agentMemory, ({ one }) => ({
  agent: one(agents, { fields: [agentMemory.agentId], references: [agents.id] }),
}));

export const agentCallsRelations = relations(agentCalls, ({ one }) => ({
  callerAgent: one(agents, { fields: [agentCalls.callerAgentId], references: [agents.id], relationName: 'callerAgent' }),
  calleeAgent: one(agents, { fields: [agentCalls.calleeAgentId], references: [agents.id], relationName: 'calleeAgent' }),
  run: one(runs, { fields: [agentCalls.runId], references: [runs.id] }),
}));

export const proposalsRelations = relations(proposals, ({ one }) => ({
  organization: one(organizations, { fields: [proposals.organizationId], references: [organizations.id] }),
  proposedByAgent: one(agents, { fields: [proposals.proposedByAgentId], references: [agents.id] }),
}));

export const dailyNotesRelations = relations(dailyNotes, ({ one }) => ({
  agent: one(agents, { fields: [dailyNotes.agentId], references: [agents.id] }),
  organization: one(organizations, { fields: [dailyNotes.organizationId], references: [organizations.id] }),
}));

export const knowledgeBaseRelations = relations(knowledgeBase, ({ one }) => ({
  agent: one(agents, { fields: [knowledgeBase.agentId], references: [agents.id] }),
  organization: one(organizations, { fields: [knowledgeBase.organizationId], references: [organizations.id] }),
}));

export const tacitKnowledgeRelations = relations(tacitKnowledge, ({ one }) => ({
  agent: one(agents, { fields: [tacitKnowledge.agentId], references: [agents.id] }),
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
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type AgentMemory = typeof agentMemory.$inferSelect;
export type NewAgentMemory = typeof agentMemory.$inferInsert;
export type AgentCall = typeof agentCalls.$inferSelect;
export type NewAgentCall = typeof agentCalls.$inferInsert;
export type Proposal = typeof proposals.$inferSelect;
export type NewProposal = typeof proposals.$inferInsert;
export type SharedMemory = typeof sharedMemory.$inferSelect;
export type NewSharedMemory = typeof sharedMemory.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
export type DailyNote = typeof dailyNotes.$inferSelect;
export type NewDailyNote = typeof dailyNotes.$inferInsert;
export type KnowledgeBase = typeof knowledgeBase.$inferSelect;
export type NewKnowledgeBase = typeof knowledgeBase.$inferInsert;
export type TacitKnowledge = typeof tacitKnowledge.$inferSelect;
export type NewTacitKnowledge = typeof tacitKnowledge.$inferInsert;
