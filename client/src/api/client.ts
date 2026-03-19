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

export interface Agent {
  id: string
  name: string
  description: string | null
  type: AgentType
  config: Record<string, unknown>
  status: 'active' | 'paused' | 'error'
  createdAt: string
  updatedAt: string
}

export interface Run {
  id: string
  agentId: string
  agentName?: string
  agentType?: string
  scheduleId: string | null
  status: 'pending' | 'running' | 'success' | 'failed' | 'cancelled'
  startedAt: string | null
  completedAt: string | null
  input?: unknown
  output?: unknown
  tokensUsed: number
  costUsd: string | number
  triggeredBy: string
  error: string | null
  createdAt: string
  toolCalls?: ToolCall[]
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
}

export interface AgentPreset {
  id: string
  name: string
  description: string
  type: string
  icon: string
  category: 'local-cli' | 'ai-api' | 'automation' | 'protocol' | 'custom'
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

// Agents
export const getAgents = () =>
  api.get<{ data: Agent[]; total: number }>('/agents').then((r) => r.data)

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

// Runs
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

// Schedules
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

// Budgets
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

// Audit logs (via run logs - global logs endpoint)
export const getAuditLogs = (params?: { limit?: number; offset?: number }) =>
  api
    .get<{ data: AuditLog[]; total: number }>('/runs', {
      params: { ...params, limit: params?.limit ?? 100 },
    })
    .then((r) => r.data)

// Setup / Onboarding
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

// Presets
export const getPresets = () =>
  api.get<{ data: AgentPreset[]; total: number }>('/presets').then((r) => r.data)

export const getPreset = (id: string) =>
  api.get<{ data: AgentPreset }>(`/presets/${id}`).then((r) => r.data)

// Internal Agent Chat
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

// OpenClaw Discovery
export const discoverOpenclaw = (host: string, port: number) =>
  api
    .get<{ connected: boolean; host: string; port: number; models?: any[]; version?: string | null; error?: string }>(
      `/setup/discover-openclaw?host=${encodeURIComponent(host)}&port=${port}`
    )
    .then((r) => r.data)

// A2A Card Fetch
export const fetchA2ACard = (endpoint: string) =>
  api
    .post<{ found: boolean; cardUrl?: string; card?: any; error?: string }>(
      '/setup/fetch-a2a-card',
      { endpoint }
    )
    .then((r) => r.data)

export default api
