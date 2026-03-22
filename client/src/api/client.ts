import axios from 'axios'

// Types
export type AgentType =
  | 'http'
  | 'claude'
  | 'openai'
  | 'bash'
  | 'claude-code'
  | 'openai-codex'
  | 'openclaw'
  | 'cursor'
  | 'a2a'
  | 'internal'
  | 'mcp'

export type AgentRole = 'ceo' | 'manager' | 'worker' | 'specialist'

export interface Agent {
  id: string
  name: string
  description: string | null
  type: AgentType
  config: Record<string, unknown>
  status: 'active' | 'paused' | 'error'
  role: AgentRole
  jobDescription: string | null
  parentAgentId: string | null
  parentAgentName?: string | null
  organizationId: string | null
  childrenCount?: number
  createdAt: string
  updatedAt: string
}

export interface Organization {
  id: string
  name: string
  description: string | null
  industry: string | null
  goals: string[] | null
  status?: 'active' | 'paused'
  createdAt: string
  updatedAt: string
}

export interface OrgChartNode {
  id: string
  name: string
  role: AgentRole
  status: string
  description: string | null
  jobDescription: string | null
  type: string
  children: OrgChartNode[]
}

export interface Proposal {
  id: string
  organizationId: string | null
  proposedByAgentId: string | null
  type: 'hire_agent' | 'restructure' | 'budget_increase' | 'strategy'
  title: string
  details: Record<string, unknown>
  reasoning: string | null
  estimatedCostUsd: number | null
  status: 'pending' | 'approved' | 'rejected'
  userNotes: string | null
  createdAt: string
  resolvedAt: string | null
}

export interface AgentMemoryEntry {
  id: string
  agentId: string
  key: string
  value: string
  updatedAt: string
}

export interface CostSummary {
  totalToday: number
  totalThisWeek: number
  totalThisMonth: number
  byAgent: { agentId: string; name: string; cost: number; runs: number }[]
  byDay: { date: string; cost: number }[]
}

export interface CostProjection {
  agentId: string
  name: string
  last30DayCost: number
  projectedNextMonthCost: number
}

export interface Run {
  id: string
  agentId: string
  agentName?: string
  agentType?: string
  agentRole?: string
  scheduleId: string | null
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled'
  startedAt: string | null
  completedAt: string | null
  input?: unknown
  output?: unknown
  tokensUsed: number
  inputTokens?: number
  outputTokens?: number
  costUsd: string | number
  model?: string
  durationMs?: number
  triggeredBy: string
  error: string | null
  createdAt: string
  toolCalls?: ToolCall[]
  auditLogs?: AuditLog[]
}

export interface ApiKeyEntry {
  id: string
  name: string
  provider: string
  keyHint: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface SharedMemoryEntry {
  id: string
  organizationId: string
  key: string
  value: string
  createdByAgentId: string | null
  updatedAt: string
}

export interface ToolCall {
  id: string
  runId: string
  toolName: string
  input: unknown
  output: unknown
  createdAt: string
}

export interface Schedule {
  id: string
  agentId: string
  agentName?: string
  agentStatus?: string
  cronExpression: string
  enabled: boolean
  lastRunAt: string | null
  nextRunAt: string | null
  createdAt: string
  updatedAt: string
}

export interface Budget {
  id: string
  agentId: string
  agentName?: string
  agentType?: string
  period: 'daily' | 'weekly' | 'monthly'
  limitUsd: string | number
  currentSpend: string | number
  periodStart: string
  createdAt: string
  updatedAt: string
  percentUsed?: number
  remaining?: number
}

export interface AuditLog {
  id: string
  agentId: string | null
  runId: string | null
  event: string
  data: unknown
  createdAt: string
}

export interface CreateAgentDto {
  name: string
  description?: string
  type: AgentType
  config: Record<string, unknown>
  status?: 'active' | 'paused' | 'error'
  role?: AgentRole
  jobDescription?: string
  parentAgentId?: string
  organizationId?: string
}

export interface AgentPreset {
  id: string
  name: string
  description: string
  type: string
  icon: string
  category: 'local' | 'ai-api' | 'http' | 'automation' | 'mcp' | 'bash'
  popular: boolean
  defaultConfig: Record<string, any>
  requiredSetup?: string
  docsUrl?: string
}

export interface CreateScheduleDto {
  agentId: string
  cronExpression: string
  enabled: boolean
}

export interface CreateBudgetDto {
  agentId: string
  period: 'daily' | 'weekly' | 'monthly'
  limitUsd: number
}

export interface BusinessAnalysisInput {
  name: string
  description: string
  industry?: string
  goals?: string[]
  availableConnections?: string[]
}

export interface CreateBusinessDto {
  organizationData: {
    name: string
    description?: string
    industry?: string
    goals?: string[]
  }
  ceoConfig: {
    name: string
    description?: string
    type: AgentType
    config: Record<string, unknown>
    jobDescription?: string
  }
  teamConfigs?: Array<{
    name: string
    description?: string
    type: AgentType
    config: Record<string, unknown>
    role?: AgentRole
    jobDescription?: string
    reportsTo?: string
  }>
}

export interface TelegramRoutes {
  defaultAgentId: string | null
  commandRoutes: Record<string, string>
}

// Axios instance
const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
})

// Add API key to all requests
api.interceptors.request.use((config) => {
  const apiKey =
    localStorage.getItem('agenthub_api_key') ||
    (import.meta.env.VITE_API_KEY as string | undefined) ||
    ''
  if (apiKey) {
    config.headers['X-API-Key'] = apiKey
  }
  return config
})

// Response interceptor for error handling
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const message =
      error.response?.data?.error ||
      error.response?.data?.message ||
      error.message ||
      'An unexpected error occurred'
    return Promise.reject(new Error(message))
  }
)

// ─── Agents ───────────────────────────────────────────────────────────────────

export const getAgents = (params?: { organizationId?: string; role?: string }) =>
  api.get<{ data: Agent[]; total: number }>('/agents', { params }).then((r) => r.data)

export const getAgent = (id: string) =>
  api.get<{ data: Agent }>(`/agents/${id}`).then((r) => r.data)

export const createAgent = (data: CreateAgentDto) =>
  api.post<{ data: Agent }>('/agents', data).then((r) => r.data)

export const updateAgent = (id: string, data: Partial<CreateAgentDto>) =>
  api.put<{ data: Agent }>(`/agents/${id}`, data).then((r) => r.data)

export const deleteAgent = (id: string) =>
  api.delete<{ message: string }>(`/agents/${id}`).then((r) => r.data)

export const runAgent = (id: string, input?: unknown) =>
  api.post<{ data: Run }>(`/agents/${id}/run`, { input }).then((r) => r.data)

export const getAgentRuns = (id: string, limit = 50, offset = 0) =>
  api
    .get<{ data: Run[]; total: number; limit: number; offset: number }>(
      `/agents/${id}/runs`,
      { params: { limit, offset } }
    )
    .then((r) => r.data)

// Agent delegation
export const delegateTask = (agentId: string, targetAgentId: string, input: unknown, context?: unknown) =>
  api.post(`/agents/${agentId}/delegate`, { targetAgentId, input, context }).then((r) => r.data)

// ─── Agent Memory ─────────────────────────────────────────────────────────────

export const getAgentMemory = (agentId: string) =>
  api.get<{ data: AgentMemoryEntry[]; total: number }>(`/agents/${agentId}/memory`).then((r) => r.data)

export const setAgentMemory = (agentId: string, key: string, value: string) =>
  api.post<{ data: AgentMemoryEntry }>(`/agents/${agentId}/memory`, { key, value }).then((r) => r.data)

export const deleteAgentMemory = (agentId: string, key: string) =>
  api.delete<{ message: string }>(`/agents/${agentId}/memory/${key}`).then((r) => r.data)

export const getAgentSoulMd = (agentId: string) =>
  api.get<{ data: { agentId: string; agentName: string; soulMd: string; heartbeatMd: string; bootstrapMd: string } }>(
    `/agents/${agentId}/soul-md`
  ).then((r) => r.data)

export const getAgentHubPrompt = (agentId: string) =>
  api.get<{ data: { agentId: string; agentName: string; prompt: string } }>(
    `/agents/${agentId}/hub-prompt`
  ).then((r) => r.data)

export const getAgentConnectorScript = (agentId: string) =>
  api.get<{ data: { agentId: string; agentName: string; script: string } }>(
    `/agents/${agentId}/connector-script`
  ).then((r) => r.data)

// Onboarding helpers — Paperclip-style connection checks
export const testCli = (type: 'claude-code' | 'openai-codex' | 'cursor') =>
  api.post<{ installed: boolean; version?: string; error?: string; hint?: string }>(
    '/agents/test-cli',
    { type }
  ).then((r) => r.data)

export const testApiKey = (provider: 'anthropic' | 'openai', apiKey: string) =>
  api.post<{ valid: boolean; model?: string; modelCount?: number; error?: string }>(
    '/agents/test-api-key',
    { provider, apiKey }
  ).then((r) => r.data)

export const testHttpEndpoint = (url: string, headers?: Record<string, string>) =>
  api.post<{ reachable: boolean; status?: number; statusText?: string; error?: string }>(
    '/agents/test-http-endpoint',
    { url, headers }
  ).then((r) => r.data)

// ─── Runs ─────────────────────────────────────────────────────────────────────

export const getRuns = (params?: {
  limit?: number
  offset?: number
  agentId?: string
  status?: string
}) =>
  api
    .get<{ data: Run[]; total: number; limit: number; offset: number }>('/runs', { params })
    .then((r) => r.data)

export const getRun = (id: string) =>
  api.get<{ data: Run }>(`/runs/${id}`).then((r) => r.data)

export const cancelRun = (id: string) =>
  api.delete<{ message: string }>(`/runs/${id}`).then((r) => r.data)

export const getRunLogs = (id: string) =>
  api
    .get<{ data: AuditLog[]; total: number }>(`/runs/${id}/logs`)
    .then((r) => r.data)

// ─── Schedules ────────────────────────────────────────────────────────────────

export const getSchedules = () =>
  api
    .get<{ data: Schedule[]; total: number }>('/schedules')
    .then((r) => r.data)

export const getSchedule = (id: string) =>
  api.get<{ data: Schedule }>(`/schedules/${id}`).then((r) => r.data)

export const createSchedule = (data: CreateScheduleDto) =>
  api.post<{ data: Schedule }>('/schedules', data).then((r) => r.data)

export const updateSchedule = (id: string, data: Partial<CreateScheduleDto>) =>
  api.put<{ data: Schedule }>(`/schedules/${id}`, data).then((r) => r.data)

export const deleteSchedule = (id: string) =>
  api.delete<{ message: string }>(`/schedules/${id}`).then((r) => r.data)

export const enableSchedule = (id: string) =>
  api
    .post<{ data: Schedule; message: string }>(`/schedules/${id}/enable`)
    .then((r) => r.data)

export const disableSchedule = (id: string) =>
  api
    .post<{ data: Schedule; message: string }>(`/schedules/${id}/disable`)
    .then((r) => r.data)

// ─── Budgets ──────────────────────────────────────────────────────────────────

export const getBudgets = () =>
  api
    .get<{ data: Budget[]; total: number }>('/budgets')
    .then((r) => r.data)

export const createBudget = (data: CreateBudgetDto) =>
  api.post<{ data: Budget }>('/budgets', data).then((r) => r.data)

export const deleteBudget = (id: string) =>
  api.delete<{ message: string }>(`/budgets/${id}`).then((r) => r.data)

export const resetBudget = (agentId: string) =>
  api
    .post<{ data: Budget; message: string }>(`/budgets/${agentId}/reset`)
    .then((r) => r.data)

// ─── Audit logs ───────────────────────────────────────────────────────────────

export const getAuditLogs = (params?: { limit?: number; offset?: number }) =>
  api
    .get<{ data: AuditLog[]; total: number }>('/runs', {
      params: { ...params, limit: params?.limit ?? 100 },
    })
    .then((r) => r.data)

// ─── Setup / Onboarding ───────────────────────────────────────────────────────

export const getSetupStatus = () =>
  api.get<{
    complete: boolean
    dbMode: 'sqlite' | 'postgres'
    schedulerMode: 'cron' | 'bullmq'
    steps: { apiKeys: boolean; telegram: boolean; firstAgent: boolean }
  }>('/setup/status').then((r) => r.data)

export const completeSetup = () =>
  api.post<{ success: boolean; message: string }>('/setup/complete').then((r) => r.data)

export const saveApiKeys = (keys: {
  anthropicKey?: string
  openaiKey?: string
  apiSecret?: string
}) => api.post<{ success: boolean; message: string }>('/setup/api-keys', keys).then((r) => r.data)

export const saveTelegramConfig = (config: { botToken: string; authorizedUsers: string }) =>
  api.post<{ success: boolean; message: string; botName?: string; botId?: number }>(
    '/setup/telegram',
    config
  ).then((r) => r.data)

export const testTelegram = (token: string) =>
  api
    .get<{ valid: boolean; botName?: string; botId?: number; firstName?: string; error?: string }>(
      `/setup/test-telegram?token=${encodeURIComponent(token)}`
    )
    .then((r) => r.data)

// ─── Presets ──────────────────────────────────────────────────────────────────

export const getPresets = () =>
  api.get<{ data: AgentPreset[]; total: number }>('/presets').then((r) => r.data)

export const getPreset = (id: string) =>
  api.get<{ data: AgentPreset }>(`/presets/${id}`).then((r) => r.data)

// ─── Internal Agent Chat ──────────────────────────────────────────────────────

export const chatWithInternalAgent = (
  message: string,
  history?: { role: string; content: string }[]
) =>
  api
    .post<{ success: boolean; message: string; provider: 'anthropic' | 'openai'; model: string }>(
      '/internal-agent/chat',
      { message, history }
    )
    .then((r) => r.data)

// ─── Assistant Settings ──────────────────────────────────────────────────────

export const getAssistantSettings = () =>
  api.get<{ data: { provider: string; model: string } }>('/internal-agent/settings').then((r) => r.data)

export const setAssistantSettings = (provider: string, model: string) =>
  api.post<{ success: boolean }>('/internal-agent/settings', { provider, model }).then((r) => r.data)

// ─── Telegram Token Management ───────────────────────────────────────────────

export const getTelegramStatus = () =>
  api.get<{ data: { connected: boolean; botUsername?: string; token?: string } }>('/settings/telegram-status').then((r) => r.data)

export const setTelegramToken = (token: string) =>
  api.post<{ success: boolean; message: string }>('/settings/telegram-token', { token }).then((r) => r.data)

// ─── OpenClaw Discovery ───────────────────────────────────────────────────────

export const discoverOpenclaw = (host: string, port: number) =>
  api
    .get<{ connected: boolean; host: string; port: number; models?: any[]; version?: string | null; error?: string }>(
      `/setup/discover-openclaw?host=${encodeURIComponent(host)}&port=${port}`
    )
    .then((r) => r.data)

// ─── A2A Card Fetch ───────────────────────────────────────────────────────────

export const fetchA2ACard = (endpoint: string) =>
  api
    .post<{ found: boolean; cardUrl?: string; card?: any; error?: string }>(
      '/setup/fetch-a2a-card',
      { endpoint }
    )
    .then((r) => r.data)

// ─── CEO-First Workflow Types ────────────────────────────────────────────────

export interface TeamPlan {
  ceoAgent: { name: string; description: string; type: AgentType; config: Record<string, unknown>; jobDescription: string }
  proposedTeam: Array<{
    name: string; role: AgentRole; description: string; type: AgentType;
    config: Record<string, unknown>; jobDescription: string; reportsTo: string
  }>
  costBreakdown?: Array<{ agentName: string; model: string; estimatedMonthlyTokens: number; estimatedMonthlyCostUsd: number }>
  reasoning: string
  estimatedMonthlyCostUsd: number
  recommendation: string
}

export interface PrelaunchMessage {
  id: string
  organizationId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

// ─── CEO-First Workflow API ─────────────────────────────────────────────────

export const createCeo = (data: BusinessAnalysisInput) =>
  api.post<{ data: { organization: Organization; ceoAgent: Agent; teamPlan: TeamPlan } }>('/business/create-ceo', data).then(r => r.data)

export const getTeamPlan = (orgId: string) =>
  api.get<{ data: TeamPlan; launchState: string }>(`/business/organizations/${orgId}/team-plan`).then(r => r.data)

export const ceoPrelaunchChat = (orgId: string, message: string) =>
  api.post<{ data: { message: string; planUpdated: boolean; updatedPlan?: TeamPlan } }>(`/business/organizations/${orgId}/ceo-prelaunch-chat`, { message }).then(r => r.data)

export const getPrelaunchMessages = (orgId: string) =>
  api.get<{ data: PrelaunchMessage[] }>(`/business/organizations/${orgId}/prelaunch-messages`).then(r => r.data)

export const launchBusiness = (orgId: string, teamOverrides?: any[]) =>
  api.post<{ data: { organization: Organization; ceoAgent: Agent; teamAgents: Agent[]; filesGenerated: number } }>(`/business/organizations/${orgId}/launch`, { teamOverrides }).then(r => r.data)

export const batchProcessProposals = (actions: Array<{ proposalId: string; action: 'approve' | 'reject'; reason?: string }>) =>
  api.post<{ data: Proposal[] }>('/business/proposals/batch', { actions }).then(r => r.data)

// ─── Business / Organizations ─────────────────────────────────────────────────

export const analyzeBusiness = (data: BusinessAnalysisInput) =>
  api.post<{ data: any }>('/business/analyze', data).then((r) => r.data)

export const createBusiness = (data: CreateBusinessDto) =>
  api.post<{ data: { organization: Organization; ceoAgent: Agent; teamAgents: Agent[] } }>('/business/create', data).then((r) => r.data)

export const getOrganizations = () =>
  api.get<{ data: Organization[]; total: number }>('/business/organizations').then((r) => r.data)

export const getOrganization = (id: string) =>
  api.get<{ data: Organization & { agents: Agent[] } }>(`/business/organizations/${id}`).then((r) => r.data)

export const getOrgChart = (id: string) =>
  api.get<{ data: { organization: Organization; chart: OrgChartNode[] } }>(`/business/organizations/${id}/chart`).then((r) => r.data)

export const runCeo = (orgId: string, input: string) =>
  api.post<{ data: any }>(`/business/organizations/${orgId}/ceo-run`, { input }).then((r) => r.data)

// ─── Proposals ────────────────────────────────────────────────────────────────

export const getProposals = (status?: string) =>
  api.get<{ data: Proposal[]; total: number }>(`/business/proposals${status ? `?status=${status}` : ''}`).then((r) => r.data)

export const approveProposal = (id: string) =>
  api.post<{ data: Proposal; newAgent?: Agent }>(`/business/proposals/${id}/approve`).then((r) => r.data)

export const rejectProposal = (id: string, reason?: string) =>
  api.post<{ data: Proposal }>(`/business/proposals/${id}/reject`, { reason }).then((r) => r.data)

// ─── Costs ────────────────────────────────────────────────────────────────────

export const getCostSummary = () =>
  api.get<{ data: CostSummary }>('/costs/summary').then((r) => r.data)

export const getCostsByAgent = (period?: string) =>
  api.get<{ data: any[]; total: number; period: string }>(`/costs/by-agent${period ? `?period=${period}` : ''}`).then((r) => r.data)

export const getCostTimeline = (agentId?: string, from?: string, to?: string) =>
  api.get<{ data: { date: string; cost: number }[] }>('/costs/timeline', { params: { agentId, from, to } }).then((r) => r.data)

export const getCostProjections = () =>
  api.get<{ data: CostProjection[]; totalProjectedNextMonth: number }>('/costs/projections').then((r) => r.data)

// ─── Settings / Telegram Routes ───────────────────────────────────────────────

export const getSettings = () =>
  api.get<{ data: { key: string; value: string }[] }>('/settings').then((r) => r.data)

export const setTelegramRoute = (agentId: string) =>
  api.post<{ success: boolean; agentId: string }>('/settings/telegram-route', { agentId }).then((r) => r.data)

export const getTelegramRoutes = () =>
  api.get<{ data: TelegramRoutes }>('/settings/telegram-routes').then((r) => r.data)

export const addTelegramCommandRoute = (command: string, agentId: string) =>
  api.post<{ success: boolean; commandRoutes: Record<string, string> }>('/settings/telegram-routes', { command, agentId }).then((r) => r.data)

export const removeTelegramCommandRoute = (command: string) =>
  api.delete<{ success: boolean; commandRoutes: Record<string, string> }>(`/settings/telegram-routes/${encodeURIComponent(command)}`).then((r) => r.data)

// ─── API Keys (Settings) ─────────────────────────────────────────────────────

export const getApiKeys = () =>
  api.get<{ data: ApiKeyEntry[] }>('/settings/api-keys').then((r) => r.data)

export const addApiKey = (name: string, provider: string, key: string) =>
  api.post<{ data: ApiKeyEntry }>('/settings/api-keys', { name, provider, key }).then((r) => r.data)

export const deleteApiKey = (id: string) =>
  api.delete<{ success: boolean }>(`/settings/api-keys/${id}`).then((r) => r.data)

export const testApiKeyById = (id: string) =>
  api.post<{ valid: boolean; model?: string; modelCount?: number; error?: string }>(`/settings/api-keys/${id}/test`).then((r) => r.data)

export const toggleApiKey = (id: string, isActive: boolean) =>
  api.patch<{ success: boolean }>(`/settings/api-keys/${id}`, { isActive }).then((r) => r.data)

// ─── Heartbeat ───────────────────────────────────────────────────────────────

export const getHeartbeat = (sinceMin = 5, orgId?: string) =>
  api.get<{ data: Run[] }>('/runs/heartbeat', { params: { sinceMin, orgId } }).then((r) => r.data)

// ─── Organization Status ─────────────────────────────────────────────────────

export const updateOrganization = (orgId: string, data: Partial<{ name: string; description: string; industry: string; goals: string[] }>) =>
  api.put<{ data: Organization }>(`/business/organizations/${orgId}`, data).then((r) => r.data)

export const updateOrgStatus = (orgId: string, status: 'active' | 'paused') =>
  api.patch<{ data: Organization }>(`/business/organizations/${orgId}/status`, { status }).then((r) => r.data)

export const deleteOrganization = (orgId: string) =>
  api.delete<{ success: boolean; message: string }>(`/business/organizations/${orgId}`).then((r) => r.data)

// ─── Shared Memory (Organization) ────────────────────────────────────────────

export const getOrgMemory = (orgId: string) =>
  api.get<{ data: SharedMemoryEntry[]; total: number }>(`/business/organizations/${orgId}/memory`).then((r) => r.data)

export const setOrgMemory = (orgId: string, key: string, value: string) =>
  api.post<{ data: SharedMemoryEntry }>(`/business/organizations/${orgId}/memory`, { key, value }).then((r) => r.data)

export const deleteOrgMemory = (orgId: string, key: string) =>
  api.delete<{ success: boolean }>(`/business/organizations/${orgId}/memory/${encodeURIComponent(key)}`).then((r) => r.data)

// ─── Daily Notes ─────────────────────────────────────────────────────────────

export interface DailyNote {
  id: string
  agentId: string
  organizationId: string | null
  date: string
  content: string
  createdAt: string
  updatedAt: string
}

export const getAgentDailyNotes = (agentId: string) =>
  api.get<{ data: DailyNote[] }>(`/agents/${agentId}/daily-notes`).then((r) => r.data)

export const setAgentDailyNote = (agentId: string, date: string, content: string) =>
  api.post<{ data: DailyNote }>(`/agents/${agentId}/daily-notes`, { date, content }).then((r) => r.data)

export const deleteAgentDailyNote = (agentId: string, date: string) =>
  api.delete<{ message: string }>(`/agents/${agentId}/daily-notes/${date}`).then((r) => r.data)

// ─── Knowledge Base ──────────────────────────────────────────────────────────

export interface KnowledgeEntry {
  id: string
  agentId: string | null
  organizationId: string | null
  category: 'projects' | 'areas' | 'resources' | 'archives'
  title: string
  content: string
  createdAt: string
  updatedAt: string
}

export const getAgentKnowledge = (agentId: string) =>
  api.get<{ data: KnowledgeEntry[] }>(`/agents/${agentId}/knowledge`).then((r) => r.data)

export const createAgentKnowledge = (agentId: string, data: { category: string; title: string; content: string }) =>
  api.post<{ data: KnowledgeEntry }>(`/agents/${agentId}/knowledge`, data).then((r) => r.data)

export const updateAgentKnowledge = (agentId: string, kbId: string, data: Partial<{ category: string; title: string; content: string }>) =>
  api.put<{ data: KnowledgeEntry }>(`/agents/${agentId}/knowledge/${kbId}`, data).then((r) => r.data)

export const deleteAgentKnowledge = (agentId: string, kbId: string) =>
  api.delete<{ message: string }>(`/agents/${agentId}/knowledge/${kbId}`).then((r) => r.data)

export const getOrgKnowledge = (orgId: string) =>
  api.get<{ data: KnowledgeEntry[] }>(`/business/organizations/${orgId}/knowledge`).then((r) => r.data)

export const createOrgKnowledge = (orgId: string, data: { category: string; title: string; content: string }) =>
  api.post<{ data: KnowledgeEntry }>(`/business/organizations/${orgId}/knowledge`, data).then((r) => r.data)

export const updateOrgKnowledge = (orgId: string, kbId: string, data: Partial<{ category: string; title: string; content: string }>) =>
  api.put<{ data: KnowledgeEntry }>(`/business/organizations/${orgId}/knowledge/${kbId}`, data).then((r) => r.data)

export const deleteOrgKnowledge = (orgId: string, kbId: string) =>
  api.delete<{ message: string }>(`/business/organizations/${orgId}/knowledge/${kbId}`).then((r) => r.data)

// ─── Tacit Knowledge ─────────────────────────────────────────────────────────

export interface TacitEntry {
  id: string
  agentId: string
  topic: string
  insight: string
  confidence: number
  createdAt: string
  updatedAt: string
}

export const getAgentTacit = (agentId: string) =>
  api.get<{ data: TacitEntry[] }>(`/agents/${agentId}/tacit`).then((r) => r.data)

export const createAgentTacit = (agentId: string, data: { topic: string; insight: string; confidence?: number }) =>
  api.post<{ data: TacitEntry }>(`/agents/${agentId}/tacit`, data).then((r) => r.data)

export const updateAgentTacit = (agentId: string, tacitId: string, data: Partial<{ topic: string; insight: string; confidence: number }>) =>
  api.put<{ data: TacitEntry }>(`/agents/${agentId}/tacit/${tacitId}`, data).then((r) => r.data)

export const deleteAgentTacit = (agentId: string, tacitId: string) =>
  api.delete<{ message: string }>(`/agents/${agentId}/tacit/${tacitId}`).then((r) => r.data)

// ─── Goals & Plans ─────────────────────────────────────────────────────────

export interface Goal {
  id: string;
  organizationId: string | null;
  agentId: string | null;
  title: string;
  description: string | null;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'draft' | 'active' | 'in_progress' | 'blocked' | 'achieved' | 'abandoned';
  successCriteria: string[] | null;
  constraints: string[] | null;
  deadline: string | null;
  measurableTarget: string | null;
  progress: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  steps?: PlanStep[];
}

export interface PlanStep {
  id: string;
  goalId: string;
  assignedAgentId: string | null;
  title: string;
  description: string | null;
  type: 'research' | 'reasoning' | 'generation' | 'validation' | 'approval' | 'action';
  order: number;
  status: 'pending' | 'ready' | 'running' | 'blocked' | 'failed' | 'verified' | 'completed' | 'skipped';
  dependsOn: string[] | null;
  input: any;
  output: any;
  artifacts: any;
  verification: any;
  verificationResult: any;
  retries: number;
  maxRetries: number;
  runId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const getGoals = (params?: { organizationId?: string; agentId?: string; status?: string }) =>
  api.get<Goal[]>('/goals', { params }).then(r => r.data);

export const getGoal = (id: string) =>
  api.get<Goal & { steps: PlanStep[] }>(`/goals/${id}`).then(r => r.data);

export const createGoal = (data: Partial<Goal>) =>
  api.post<Goal>('/goals', data).then(r => r.data);

export const updateGoal = (id: string, data: Partial<Goal>) =>
  api.put<Goal>(`/goals/${id}`, data).then(r => r.data);

export const deleteGoal = (id: string) =>
  api.delete(`/goals/${id}`).then(r => r.data);

export const createPlanStep = (goalId: string, data: Partial<PlanStep>) =>
  api.post<PlanStep>(`/goals/${goalId}/steps`, data).then(r => r.data);

export const updatePlanStep = (goalId: string, stepId: string, data: Partial<PlanStep>) =>
  api.put<PlanStep>(`/goals/${goalId}/steps/${stepId}`, data).then(r => r.data);

export const deletePlanStep = (goalId: string, stepId: string) =>
  api.delete(`/goals/${goalId}/steps/${stepId}`).then(r => r.data);

export const activateGoal = (id: string) =>
  api.post(`/goals/${id}/activate`).then(r => r.data);

export const advanceGoal = (id: string) =>
  api.post(`/goals/${id}/advance`).then(r => r.data);

// ─── Tool Policies ─────────────────────────────────────────────────────────

export interface ToolPolicy {
  id: string;
  organizationId: string | null;
  toolName: string;
  toolClass: string | null;
  allowedAgentIds: string[] | null;
  deniedAgentIds: string[] | null;
  mode: 'read_only' | 'draft_only' | 'execute' | 'execute_with_approval' | 'sandbox_only';
  approvalRequired: boolean;
  maxCallsPerRun: number | null;
  maxCallsPerDay: number | null;
  maxCostPerCallUsd: number | null;
  requiredConditions: string[] | null;
  forbiddenConditions: string[] | null;
  postconditions: string[] | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ToolCheckResult {
  allowed: boolean;
  mode: string;
  approvalRequired: boolean;
  reason?: string;
  policyId?: string;
}

export const getToolPolicies = (params?: { organizationId?: string }) =>
  api.get<ToolPolicy[]>('/tool-policies', { params }).then(r => r.data);

export const getToolPolicy = (id: string) =>
  api.get<ToolPolicy>(`/tool-policies/${id}`).then(r => r.data);

export const createToolPolicy = (data: Partial<ToolPolicy>) =>
  api.post<ToolPolicy>('/tool-policies', data).then(r => r.data);

export const updateToolPolicy = (id: string, data: Partial<ToolPolicy>) =>
  api.put<ToolPolicy>(`/tool-policies/${id}`, data).then(r => r.data);

export const deleteToolPolicy = (id: string) =>
  api.delete(`/tool-policies/${id}`).then(r => r.data);

export const checkToolPermissionApi = (data: { agentId: string; toolName: string; organizationId?: string; runId?: string }) =>
  api.post<ToolCheckResult>('/tool-policies/check', data).then(r => r.data);

// ─── Verifications ─────────────────────────────────────────────────────────
export interface Verification {
  id: string;
  planStepId: string | null;
  runId: string | null;
  agentId: string | null;
  type: 'schema_check' | 'rule_check' | 'second_pass' | 'human_approval' | 'custom';
  checkName: string;
  status: 'pending' | 'passed' | 'failed' | 'skipped' | 'awaiting_approval';
  input: any;
  result: any;
  severity: 'error' | 'warning' | 'info';
  resolvedBy: string | null;
  notes: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export const getVerifications = (params?: { stepId?: string; status?: string }) =>
  api.get<Verification[]>('/verifications', { params }).then(r => r.data);

export const getAvailableChecks = () =>
  api.get<string[]>('/verifications/checks').then(r => r.data);

export const runVerification = (data: { stepId: string; output: any; checks: string[]; runId?: string; agentId?: string }) =>
  api.post('/verifications/verify', data).then(r => r.data);

export const requestApproval = (data: { stepId: string; content: any; notes?: string }) =>
  api.post('/verifications/request-approval', data).then(r => r.data);

export const resolveVerification = (id: string, data: { approved: boolean; notes?: string }) =>
  api.post(`/verifications/${id}/resolve`, data).then(r => r.data);

export const getPendingApprovals = () =>
  api.get<Verification[]>('/verifications/pending').then(r => r.data);

// ─── Workflows ─────────────────────────────────────────────────────────────

export interface WorkflowStepDef {
  id: string;
  agentId: string;
  action: string;
  payloadFields?: string[];
  payloadTransform?: string;
  onSuccess?: string;
  onFailure?: string;
  maxRetries?: number;
  timeoutMs?: number;
  approvalRequired?: boolean;
}

export interface Workflow {
  id: string;
  organizationId: string | null;
  name: string;
  description: string | null;
  trigger: 'manual' | 'schedule' | 'event' | 'goal_activated';
  status: 'draft' | 'active' | 'paused' | 'archived';
  steps: WorkflowStepDef[] | null;
  createdAt: string;
  updatedAt: string;
  runs?: WorkflowRun[];
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  goalId: string | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  currentStepId: string | null;
  stepResults: Record<string, any> | null;
  input: any;
  output: any;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export const getWorkflows = (params?: { organizationId?: string }) =>
  api.get<Workflow[]>('/workflows', { params }).then(r => r.data);

export const getWorkflow = (id: string) =>
  api.get<Workflow & { runs: WorkflowRun[] }>(`/workflows/${id}`).then(r => r.data);

export const createWorkflow = (data: Partial<Workflow>) =>
  api.post<Workflow>('/workflows', data).then(r => r.data);

export const updateWorkflow = (id: string, data: Partial<Workflow>) =>
  api.put<Workflow>(`/workflows/${id}`, data).then(r => r.data);

export const deleteWorkflow = (id: string) =>
  api.delete(`/workflows/${id}`).then(r => r.data);

export const startWorkflowRun = (workflowId: string, data?: { goalId?: string; input?: any }) =>
  api.post<WorkflowRun>(`/workflows/${workflowId}/run`, data || {}).then(r => r.data);

export const getWorkflowRuns = () =>
  api.get<WorkflowRun[]>('/workflows/runs/all').then(r => r.data);

export const updateWorkflowRun = (runId: string, data: Partial<WorkflowRun>) =>
  api.put<WorkflowRun>(`/workflows/runs/${runId}`, data).then(r => r.data);

export default api
