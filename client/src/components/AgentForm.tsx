import { useState, useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  createAgent,
  updateAgent,
  Agent,
  CreateAgentDto,
  AgentType,
  AgentPreset,
  getPresets,
  discoverOpenclaw,
  fetchA2ACard,
} from '../api/client'
import { useToast } from './Toaster'
import {
  X,
  Search,
  ChevronRight,
  Info,
  CheckCircle,
  AlertCircle,
  Loader2,
  ExternalLink,
} from 'lucide-react'

// ─── Styles ───────────────────────────────────────────────────────────────────

const INPUT_CLASS =
  'w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent-purple transition-colors'

const LABEL_CLASS = 'block text-xs font-medium text-slate-400 mb-1.5'

// ─── Agent Type Options ───────────────────────────────────────────────────────

const AGENT_TYPE_OPTIONS: {
  value: AgentType
  icon: string
  label: string
  desc: string
}[] = [
  { value: 'http', icon: '🌐', label: 'HTTP', desc: 'Call any web endpoint' },
  { value: 'claude', icon: '🧠', label: 'Claude API', desc: 'Anthropic Claude' },
  { value: 'openai', icon: '🤖', label: 'OpenAI API', desc: 'OpenAI GPT / reasoning' },
  { value: 'bash', icon: '💻', label: 'Bash', desc: 'Run shell commands' },
  { value: 'claude-code', icon: '🤖', label: 'Claude Code CLI', desc: 'Claude Code on this machine' },
  { value: 'openai-codex', icon: '⚡', label: 'Codex CLI', desc: 'OpenAI Codex on this machine' },
  { value: 'cursor', icon: '🖱️', label: 'Cursor', desc: 'Cursor IDE headless' },
  { value: 'openclaw', icon: '🦞', label: 'OpenClaw', desc: 'OpenClaw agent' },
  { value: 'a2a', icon: '🔗', label: 'A2A Protocol', desc: 'Any A2A agent' },
  { value: 'internal', icon: '🎯', label: 'Internal', desc: 'Built-in assistant' },
]

const CATEGORY_LABELS: Record<string, string> = {
  'local-cli': 'Local CLI',
  'ai-api': 'AI APIs',
  automation: 'Automation',
  protocol: 'Protocol',
  custom: 'Custom',
}

// ─── Preset Picker Modal ──────────────────────────────────────────────────────

function PresetPicker({
  onSelect,
  onClose,
}: {
  onSelect: (preset: AgentPreset) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('all')

  const { data: presetsData, isLoading } = useQuery({
    queryKey: ['presets'],
    queryFn: getPresets,
  })

  const presets = presetsData?.data || []
  const categories = ['all', ...Array.from(new Set(presets.map((p) => p.category)))]

  const filtered = presets.filter((p) => {
    const matchesSearch =
      !search ||
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase())
    const matchesCategory = activeCategory === 'all' || p.category === activeCategory
    return matchesSearch && matchesCategory
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-dark-card border border-dark-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-dark-border">
          <div>
            <h2 className="text-lg font-bold text-white">Choose a Preset</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Start from a ready-made configuration
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Search */}
        <div className="p-4 border-b border-dark-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search presets..."
              autoFocus
              className="w-full bg-dark-bg border border-dark-border rounded-lg pl-9 pr-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent-purple transition-colors"
            />
          </div>
        </div>

        {/* Category tabs */}
        <div className="flex gap-1 px-4 pt-3 pb-2 flex-wrap">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                activeCategory === cat
                  ? 'bg-accent-purple text-white'
                  : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200'
              }`}
            >
              {cat === 'all' ? 'All' : CATEGORY_LABELS[cat] || cat}
            </button>
          ))}
        </div>

        {/* Preset grid */}
        <div className="overflow-y-auto flex-1 p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-accent-purple" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-sm">
              No presets match your search
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {filtered.map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => onSelect(preset)}
                  className="group flex items-start gap-3 p-3.5 rounded-xl border border-dark-border bg-dark-bg hover:border-accent-purple/60 hover:bg-accent-purple/5 transition-all text-left"
                >
                  <span className="text-2xl leading-none mt-0.5 shrink-0">{preset.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-semibold text-slate-200 group-hover:text-white transition-colors truncate">
                        {preset.name}
                      </p>
                      <span className="shrink-0 text-xs text-slate-600 bg-white/5 px-1.5 py-0.5 rounded font-mono">
                        {preset.type}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 leading-relaxed line-clamp-2">
                      {preset.description}
                    </p>
                    {preset.requiredSetup && (
                      <p className="text-xs text-amber-400/70 mt-1.5 flex items-start gap-1">
                        <Info className="w-3 h-3 shrink-0 mt-0.5" />
                        <span className="truncate">{preset.requiredSetup}</span>
                      </p>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-accent-purple shrink-0 mt-1 transition-colors" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Info Box ─────────────────────────────────────────────────────────────────

function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300">
      <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      <span>{children}</span>
    </div>
  )
}

// ─── HTTP Config ──────────────────────────────────────────────────────────────

interface HeaderRow {
  key: string
  value: string
}

function HttpConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
}) {
  const [endpoint, setEndpoint] = useState((config.endpoint as string) || '')
  const [method, setMethod] = useState((config.method as string) || 'POST')
  const [headers, setHeaders] = useState<HeaderRow[]>(() => {
    const h = config.headers as Record<string, string> | undefined
    if (!h || Object.keys(h).length === 0) return [{ key: '', value: '' }]
    return Object.entries(h).map(([key, value]) => ({ key, value }))
  })
  const [authType, setAuthType] = useState<'none' | 'bearer' | 'basic'>(
    (config.authType as any) || 'none'
  )
  const [authValue, setAuthValue] = useState((config.authValue as string) || '')

  useEffect(() => {
    const headersObj: Record<string, string> = {}
    for (const row of headers) {
      if (row.key.trim()) headersObj[row.key.trim()] = row.value
    }
    if (authType === 'bearer' && authValue) {
      headersObj['Authorization'] = `Bearer ${authValue}`
    } else if (authType === 'basic' && authValue) {
      headersObj['Authorization'] = `Basic ${authValue}`
    }
    onChange({ endpoint, method, headers: headersObj, authType, authValue })
  }, [endpoint, method, headers, authType, authValue])

  const updateHeader = (i: number, field: 'key' | 'value', val: string) => {
    const next = [...headers]
    next[i] = { ...next[i], [field]: val }
    setHeaders(next)
  }

  return (
    <div className="space-y-3">
      <div>
        <label className={LABEL_CLASS}>Endpoint URL</label>
        <input
          type="url"
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          placeholder="https://example.com/webhook"
          className={INPUT_CLASS}
        />
      </div>
      <div>
        <label className={LABEL_CLASS}>HTTP Method</label>
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          className={INPUT_CLASS}
        >
          <option value="POST">POST</option>
          <option value="GET">GET</option>
          <option value="PUT">PUT</option>
        </select>
      </div>
      <div>
        <label className={LABEL_CLASS}>Auth Type</label>
        <select
          value={authType}
          onChange={(e) => setAuthType(e.target.value as any)}
          className={INPUT_CLASS}
        >
          <option value="none">None</option>
          <option value="bearer">Bearer Token</option>
          <option value="basic">Basic Auth (base64)</option>
        </select>
      </div>
      {authType !== 'none' && (
        <div>
          <label className={LABEL_CLASS}>
            {authType === 'bearer' ? 'Bearer Token' : 'Base64 Credentials'}
          </label>
          <input
            type="password"
            value={authValue}
            onChange={(e) => setAuthValue(e.target.value)}
            placeholder={authType === 'bearer' ? 'your-token' : 'dXNlcjpwYXNz'}
            className={INPUT_CLASS}
          />
        </div>
      )}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className={LABEL_CLASS + ' mb-0'}>Headers</label>
          <button
            type="button"
            onClick={() => setHeaders([...headers, { key: '', value: '' }])}
            className="text-xs text-accent-purple hover:text-purple-400 transition-colors"
          >
            + Add row
          </button>
        </div>
        <div className="space-y-1.5">
          {headers.map((row, i) => (
            <div key={i} className="flex gap-2">
              <input
                type="text"
                value={row.key}
                onChange={(e) => updateHeader(i, 'key', e.target.value)}
                placeholder="Header-Name"
                className={INPUT_CLASS + ' font-mono text-xs'}
              />
              <input
                type="text"
                value={row.value}
                onChange={(e) => updateHeader(i, 'value', e.target.value)}
                placeholder="value"
                className={INPUT_CLASS + ' font-mono text-xs'}
              />
              <button
                type="button"
                onClick={() => setHeaders(headers.filter((_, j) => j !== i))}
                className="px-2 text-slate-500 hover:text-red-400 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Claude Config ────────────────────────────────────────────────────────────

function ClaudeConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
}) {
  const [model, setModel] = useState((config.model as string) || 'claude-sonnet-4-6')
  const [systemPrompt, setSystemPrompt] = useState(
    (config.systemPrompt as string) || (config.system_prompt as string) || ''
  )
  const [maxTokens, setMaxTokens] = useState(String((config.max_tokens as number) || 4096))
  const [apiKey, setApiKey] = useState((config.api_key_override as string) || '')

  useEffect(() => {
    const c: Record<string, unknown> = { model, systemPrompt, max_tokens: parseInt(maxTokens) || 4096 }
    if (apiKey) c.api_key_override = apiKey
    onChange(c)
  }, [model, systemPrompt, maxTokens, apiKey])

  return (
    <div className="space-y-3">
      <div>
        <label className={LABEL_CLASS}>Model</label>
        <select value={model} onChange={(e) => setModel(e.target.value)} className={INPUT_CLASS}>
          <option value="claude-opus-4-6">claude-opus-4-6 — most capable</option>
          <option value="claude-sonnet-4-6">claude-sonnet-4-6 — balanced (recommended)</option>
          <option value="claude-haiku-4-5-20251001">claude-haiku-4-5 — fastest & cheapest</option>
        </select>
      </div>
      <div>
        <label className={LABEL_CLASS}>System Prompt</label>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={4}
          className={INPUT_CLASS + ' resize-y'}
          placeholder="You are a helpful assistant..."
        />
      </div>
      <div>
        <label className={LABEL_CLASS}>Max Tokens</label>
        <input
          type="number"
          value={maxTokens}
          onChange={(e) => setMaxTokens(e.target.value)}
          min={1}
          max={200000}
          className={INPUT_CLASS}
        />
      </div>
      <div>
        <label className={LABEL_CLASS}>API Key Override (optional)</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-ant-... (uses env var if empty)"
          className={INPUT_CLASS}
        />
      </div>
    </div>
  )
}

// ─── OpenAI Config ────────────────────────────────────────────────────────────

function OpenAIConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
}) {
  const [model, setModel] = useState((config.model as string) || 'gpt-4o')
  const [systemPrompt, setSystemPrompt] = useState(
    (config.systemPrompt as string) || (config.system_prompt as string) || ''
  )
  const [apiKey, setApiKey] = useState((config.api_key_override as string) || '')

  useEffect(() => {
    const c: Record<string, unknown> = { model, systemPrompt }
    if (apiKey) c.api_key_override = apiKey
    onChange(c)
  }, [model, systemPrompt, apiKey])

  return (
    <div className="space-y-3">
      <div>
        <label className={LABEL_CLASS}>Model</label>
        <select value={model} onChange={(e) => setModel(e.target.value)} className={INPUT_CLASS}>
          <option value="gpt-5.4-pro">gpt-5.4-pro — state-of-the-art</option>
          <option value="gpt-5.4-nano">gpt-5.4-nano — very fast & cheap</option>
          <option value="gpt-5.4-mini">gpt-5.4-mini — fast & cheap</option>
          <option value="gpt-4o">gpt-4o — great balance</option>
          <option value="gpt-4o-mini">gpt-4o-mini — budget friendly</option>
          <option value="o3">o3 — advanced reasoning</option>
          <option value="o3-mini">o3-mini — fast reasoning</option>
          <option value="o4-mini">o4-mini — fast reasoning</option>
        </select>
      </div>
      <div>
        <label className={LABEL_CLASS}>System Prompt</label>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={4}
          className={INPUT_CLASS + ' resize-y'}
          placeholder="You are a helpful assistant..."
        />
      </div>
      <div>
        <label className={LABEL_CLASS}>API Key Override (optional)</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-... (uses env var if empty)"
          className={INPUT_CLASS}
        />
      </div>
    </div>
  )
}

// ─── Bash Config ──────────────────────────────────────────────────────────────

function BashConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
}) {
  const [command, setCommand] = useState((config.command as string) || '')
  const [timeout, setTimeout_] = useState(String((config.timeout as number) || 30000))
  const [workDir, setWorkDir] = useState((config.workDir as string) || '')

  useEffect(() => {
    const c: Record<string, unknown> = { command, timeout: parseInt(timeout) || 30000 }
    if (workDir) c.workDir = workDir
    onChange(c)
  }, [command, timeout, workDir])

  return (
    <div className="space-y-3">
      <div>
        <label className={LABEL_CLASS}>Command</label>
        <textarea
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          rows={3}
          className={INPUT_CLASS + ' font-mono text-xs resize-y'}
          placeholder="echo 'Hello from agent!'"
        />
      </div>
      <div>
        <label className={LABEL_CLASS}>Timeout (ms)</label>
        <input
          type="number"
          value={timeout}
          onChange={(e) => setTimeout_(e.target.value)}
          min={1000}
          max={600000}
          className={INPUT_CLASS}
        />
      </div>
      <div>
        <label className={LABEL_CLASS}>Working Directory (optional)</label>
        <input
          type="text"
          value={workDir}
          onChange={(e) => setWorkDir(e.target.value)}
          placeholder="/home/user/project"
          className={INPUT_CLASS + ' font-mono text-xs'}
        />
      </div>
    </div>
  )
}

// ─── Claude Code CLI Config ───────────────────────────────────────────────────

function ClaudeCodeConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
}) {
  const [model, setModel] = useState((config.model as string) || 'claude-sonnet-4-6')
  const [systemPrompt, setSystemPrompt] = useState((config.systemPrompt as string) || '')
  const [maxTurns, setMaxTurns] = useState(String((config.maxTurns as number) || 5))
  const [workDir, setWorkDir] = useState((config.workDir as string) || '/tmp')
  const [tools, setTools] = useState((config.tools as string) || '')

  useEffect(() => {
    const c: Record<string, unknown> = {
      model,
      maxTurns: parseInt(maxTurns) || 5,
      workDir,
    }
    if (systemPrompt) c.systemPrompt = systemPrompt
    if (tools) c.tools = tools
    onChange(c)
  }, [model, systemPrompt, maxTurns, workDir, tools])

  return (
    <div className="space-y-3">
      <InfoBox>
        Requires <code className="font-mono bg-white/10 px-1 rounded">claude</code> CLI installed:{' '}
        <code className="font-mono bg-white/10 px-1 rounded">
          npm install -g @anthropic-ai/claude-code
        </code>
      </InfoBox>
      <div>
        <label className={LABEL_CLASS}>Model</label>
        <select value={model} onChange={(e) => setModel(e.target.value)} className={INPUT_CLASS}>
          <option value="claude-sonnet-4-6">claude-sonnet-4-6 (recommended)</option>
          <option value="claude-opus-4-6">claude-opus-4-6</option>
          <option value="claude-haiku-4-5-20251001">claude-haiku-4-5</option>
        </select>
      </div>
      <div>
        <label className={LABEL_CLASS}>System Prompt (optional)</label>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={3}
          className={INPUT_CLASS + ' resize-y'}
          placeholder="You are a coding assistant..."
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL_CLASS}>Max Turns</label>
          <input
            type="number"
            value={maxTurns}
            onChange={(e) => setMaxTurns(e.target.value)}
            min={1}
            max={20}
            className={INPUT_CLASS}
          />
        </div>
        <div>
          <label className={LABEL_CLASS}>Working Directory</label>
          <input
            type="text"
            value={workDir}
            onChange={(e) => setWorkDir(e.target.value)}
            placeholder="/tmp"
            className={INPUT_CLASS + ' font-mono text-xs'}
          />
        </div>
      </div>
      <div>
        <label className={LABEL_CLASS}>Allowed Tools (optional)</label>
        <input
          type="text"
          value={tools}
          onChange={(e) => setTools(e.target.value)}
          placeholder="Bash,Edit,Read"
          className={INPUT_CLASS + ' font-mono text-xs'}
        />
      </div>
    </div>
  )
}

// ─── OpenAI Codex CLI Config ──────────────────────────────────────────────────

function OpenAICodexConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
}) {
  const [mode, setMode] = useState((config.mode as string) || 'full-auto')
  const [workDir, setWorkDir] = useState((config.workDir as string) || '/tmp')
  const [apiKey, setApiKey] = useState((config.apiKeyOverride as string) || '')

  useEffect(() => {
    const c: Record<string, unknown> = { mode, workDir }
    if (apiKey) c.apiKeyOverride = apiKey
    onChange(c)
  }, [mode, workDir, apiKey])

  return (
    <div className="space-y-3">
      <InfoBox>
        Requires <code className="font-mono bg-white/10 px-1 rounded">codex</code> CLI installed:{' '}
        <code className="font-mono bg-white/10 px-1 rounded">npm install -g @openai/codex</code>
      </InfoBox>
      <div>
        <label className={LABEL_CLASS}>Mode</label>
        <select value={mode} onChange={(e) => setMode(e.target.value)} className={INPUT_CLASS}>
          <option value="full-auto">full-auto — autonomous</option>
          <option value="auto-edit">auto-edit — edit files automatically</option>
          <option value="suggest">suggest — suggest only</option>
        </select>
      </div>
      <div>
        <label className={LABEL_CLASS}>Working Directory</label>
        <input
          type="text"
          value={workDir}
          onChange={(e) => setWorkDir(e.target.value)}
          placeholder="/tmp"
          className={INPUT_CLASS + ' font-mono text-xs'}
        />
      </div>
      <div>
        <label className={LABEL_CLASS}>API Key Override (optional)</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-... (uses OPENAI_API_KEY if empty)"
          className={INPUT_CLASS}
        />
      </div>
    </div>
  )
}

// ─── Cursor Config ────────────────────────────────────────────────────────────

function CursorConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
}) {
  const [workDir, setWorkDir] = useState((config.workDir as string) || '/tmp')
  const [outputFormat, setOutputFormat] = useState((config.outputFormat as string) || 'text')
  const [apiKey, setApiKey] = useState((config.apiKey as string) || '')

  useEffect(() => {
    const c: Record<string, unknown> = { workDir, outputFormat }
    if (apiKey) c.apiKey = apiKey
    onChange(c)
  }, [workDir, outputFormat, apiKey])

  return (
    <div className="space-y-3">
      <InfoBox>
        Requires Cursor installed with CLI access. Visit{' '}
        <a
          href="https://cursor.com"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-blue-200"
        >
          cursor.com
        </a>{' '}
        for installation instructions.
      </InfoBox>
      <div>
        <label className={LABEL_CLASS}>Working Directory</label>
        <input
          type="text"
          value={workDir}
          onChange={(e) => setWorkDir(e.target.value)}
          placeholder="/tmp"
          className={INPUT_CLASS + ' font-mono text-xs'}
        />
      </div>
      <div>
        <label className={LABEL_CLASS}>Output Format</label>
        <select
          value={outputFormat}
          onChange={(e) => setOutputFormat(e.target.value)}
          className={INPUT_CLASS}
        >
          <option value="text">text</option>
          <option value="json">json</option>
          <option value="stream-json">stream-json</option>
        </select>
      </div>
      <div>
        <label className={LABEL_CLASS}>Cursor API Key (optional)</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="cursor-..."
          className={INPUT_CLASS}
        />
      </div>
    </div>
  )
}

// ─── OpenClaw Config ──────────────────────────────────────────────────────────

function OpenClawConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
}) {
  const [host, setHost] = useState((config.host as string) || 'localhost')
  const [port, setPort] = useState(String((config.port as number) || 18789))
  const [model, setModel] = useState((config.model as string) || 'openclaw:main')
  const [token, setToken] = useState((config.token as string) || '')
  const [systemPrompt, setSystemPrompt] = useState((config.systemPrompt as string) || '')
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle')
  const [testMsg, setTestMsg] = useState('')

  useEffect(() => {
    const c: Record<string, unknown> = { host, port: parseInt(port) || 18789, model }
    if (token) c.token = token
    if (systemPrompt) c.systemPrompt = systemPrompt
    onChange(c)
  }, [host, port, model, token, systemPrompt])

  const handleTest = async () => {
    setTestStatus('testing')
    try {
      const result = await discoverOpenclaw(host, parseInt(port) || 18789)
      if (result.connected) {
        setTestStatus('ok')
        const modelCount = result.models?.length || 0
        setTestMsg(
          `Connected${result.version ? ` — OpenClaw v${result.version}` : ''} (${modelCount} model${modelCount !== 1 ? 's' : ''})`
        )
      } else {
        setTestStatus('error')
        setTestMsg(result.error || 'Not reachable')
      }
    } catch {
      setTestStatus('error')
      setTestMsg('Connection failed')
    }
  }

  return (
    <div className="space-y-3">
      <InfoBox>
        OpenClaw listens on port 18789 with an OpenAI-compatible API.{' '}
        <a
          href="https://docs.openclaw.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-blue-200"
        >
          docs.openclaw.ai
        </a>
      </InfoBox>
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2">
          <label className={LABEL_CLASS}>Host</label>
          <input
            type="text"
            value={host}
            onChange={(e) => setHost(e.target.value)}
            placeholder="localhost"
            className={INPUT_CLASS + ' font-mono text-xs'}
          />
        </div>
        <div>
          <label className={LABEL_CLASS}>Port</label>
          <input
            type="number"
            value={port}
            onChange={(e) => setPort(e.target.value)}
            placeholder="18789"
            className={INPUT_CLASS}
          />
        </div>
      </div>
      <div>
        <label className={LABEL_CLASS}>Model</label>
        <input
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="openclaw:main"
          className={INPUT_CLASS + ' font-mono text-xs'}
        />
      </div>
      <div>
        <label className={LABEL_CLASS}>Bearer Token (optional)</label>
        <input
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="your-token"
          className={INPUT_CLASS}
        />
      </div>
      <div>
        <label className={LABEL_CLASS}>System Prompt (optional)</label>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={2}
          className={INPUT_CLASS + ' resize-y'}
          placeholder="You are a helpful assistant..."
        />
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleTest}
          disabled={testStatus === 'testing'}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white/5 hover:bg-white/10 border border-dark-border text-slate-300 rounded-lg transition-colors disabled:opacity-50"
        >
          {testStatus === 'testing' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : null}
          Test Connection
        </button>
        {testStatus === 'ok' && (
          <span className="flex items-center gap-1 text-xs text-green-400">
            <CheckCircle className="w-3.5 h-3.5" />
            {testMsg}
          </span>
        )}
        {testStatus === 'error' && (
          <span className="flex items-center gap-1 text-xs text-red-400">
            <AlertCircle className="w-3.5 h-3.5" />
            {testMsg}
          </span>
        )}
      </div>
    </div>
  )
}

// ─── A2A Config ───────────────────────────────────────────────────────────────

function A2AConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
}) {
  const [endpoint, setEndpoint] = useState((config.endpoint as string) || '')
  const [apiKey, setApiKey] = useState((config.apiKey as string) || '')
  const [cardStatus, setCardStatus] = useState<'idle' | 'fetching' | 'ok' | 'error'>('idle')
  const [cardInfo, setCardInfo] = useState<{
    name?: string
    description?: string
    capabilities?: string[]
  } | null>(null)
  const [cardError, setCardError] = useState('')

  useEffect(() => {
    const c: Record<string, unknown> = { endpoint }
    if (apiKey) c.apiKey = apiKey
    onChange(c)
  }, [endpoint, apiKey])

  const handleFetchCard = async () => {
    if (!endpoint.trim()) return
    setCardStatus('fetching')
    setCardInfo(null)
    setCardError('')
    try {
      const result = await fetchA2ACard(endpoint.trim())
      if (result.found && result.card) {
        setCardStatus('ok')
        setCardInfo({
          name: result.card.name || result.card.agentName,
          description: result.card.description,
          capabilities: result.card.capabilities || [],
        })
      } else {
        setCardStatus('error')
        setCardError(result.error || 'Agent card not found')
      }
    } catch {
      setCardStatus('error')
      setCardError('Failed to fetch agent card')
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <label className={LABEL_CLASS}>Agent Endpoint URL</label>
        <input
          type="url"
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          placeholder="https://agent.example.com/a2a"
          className={INPUT_CLASS}
        />
      </div>
      <div>
        <label className={LABEL_CLASS}>API Key (optional)</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="your-api-key"
          className={INPUT_CLASS}
        />
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleFetchCard}
          disabled={!endpoint.trim() || cardStatus === 'fetching'}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white/5 hover:bg-white/10 border border-dark-border text-slate-300 rounded-lg transition-colors disabled:opacity-50"
        >
          {cardStatus === 'fetching' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <ExternalLink className="w-3.5 h-3.5" />
          )}
          Fetch Agent Card
        </button>
      </div>
      {cardStatus === 'ok' && cardInfo && (
        <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 space-y-1">
          <p className="text-xs font-semibold text-green-300 flex items-center gap-1.5">
            <CheckCircle className="w-3.5 h-3.5" />
            Agent found: {cardInfo.name || 'Unknown'}
          </p>
          {cardInfo.description && (
            <p className="text-xs text-green-300/70">{cardInfo.description}</p>
          )}
          {cardInfo.capabilities && cardInfo.capabilities.length > 0 && (
            <p className="text-xs text-green-300/70">
              Capabilities: {cardInfo.capabilities.join(', ')}
            </p>
          )}
        </div>
      )}
      {cardStatus === 'error' && (
        <p className="text-xs text-red-400 flex items-center gap-1">
          <AlertCircle className="w-3.5 h-3.5" />
          {cardError}
        </p>
      )}
    </div>
  )
}

// ─── Internal Config ──────────────────────────────────────────────────────────

function InternalConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
}) {
  const [provider, setProvider] = useState((config.provider as string) || 'auto')
  const [model, setModel] = useState((config.model as string) || '')
  const [systemPrompt, setSystemPrompt] = useState((config.systemPrompt as string) || '')

  useEffect(() => {
    const c: Record<string, unknown> = { systemPrompt }
    if (provider !== 'auto') c.provider = provider
    if (model) c.model = model
    onChange(c)
  }, [provider, model, systemPrompt])

  const claudeModels = ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5-20251001']
  const openaiModels = ['gpt-4o', 'gpt-4o-mini', 'gpt-5.4-pro', 'gpt-5.4-nano', 'o3']

  return (
    <div className="space-y-3">
      <div className="p-3 rounded-lg bg-accent-purple/10 border border-accent-purple/20 text-xs text-slate-300">
        Uses whichever API key is configured in your environment. No extra setup needed.
      </div>
      <div>
        <label className={LABEL_CLASS}>Provider</label>
        <select
          value={provider}
          onChange={(e) => { setProvider(e.target.value); setModel('') }}
          className={INPUT_CLASS}
        >
          <option value="auto">Auto-detect (use whichever key is set)</option>
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="openai">OpenAI</option>
        </select>
      </div>
      {(provider === 'anthropic' || provider === 'auto') && (
        <div>
          <label className={LABEL_CLASS}>Model (optional)</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className={INPUT_CLASS}
          >
            <option value="">Default (claude-sonnet-4-6)</option>
            {claudeModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      )}
      {provider === 'openai' && (
        <div>
          <label className={LABEL_CLASS}>Model (optional)</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className={INPUT_CLASS}
          >
            <option value="">Default (gpt-4o)</option>
            {openaiModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label className={LABEL_CLASS}>System Prompt</label>
        <textarea
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={3}
          className={INPUT_CLASS + ' resize-y'}
          placeholder="You are a helpful assistant..."
        />
      </div>
    </div>
  )
}

// ─── Main AgentForm ───────────────────────────────────────────────────────────

interface AgentFormProps {
  agent?: Agent
  onClose: () => void
}

export default function AgentForm({ agent, onClose }: AgentFormProps) {
  const qc = useQueryClient()
  const toast = useToast()

  const [name, setName] = useState(agent?.name ?? '')
  const [description, setDescription] = useState(agent?.description ?? '')
  const [type, setType] = useState<AgentType>(agent?.type ?? 'claude')
  const [typeConfig, setTypeConfig] = useState<Record<string, unknown>>(agent?.config ?? {})
  const [showPresets, setShowPresets] = useState(false)

  const handlePresetSelect = (preset: AgentPreset) => {
    setType(preset.type as AgentType)
    setTypeConfig(preset.defaultConfig)
    if (!name) setName(preset.name)
    if (!description) setDescription(preset.description)
    setShowPresets(false)
  }

  const createMutation = useMutation({
    mutationFn: (data: CreateAgentDto) => createAgent(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] })
      toast.success('Agent created successfully')
      onClose()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const updateMutation = useMutation({
    mutationFn: (data: Partial<CreateAgentDto>) => updateAgent(agent!.id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] })
      toast.success('Agent updated successfully')
      onClose()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      toast.error('Name is required')
      return
    }
    const payload: CreateAgentDto = {
      name: name.trim(),
      description: description.trim() || undefined,
      type,
      config: typeConfig,
    }
    if (agent) {
      updateMutation.mutate(payload)
    } else {
      createMutation.mutate(payload)
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending

  const renderTypeConfig = () => {
    switch (type) {
      case 'http':
        return <HttpConfig config={typeConfig} onChange={setTypeConfig} />
      case 'claude':
        return <ClaudeConfig config={typeConfig} onChange={setTypeConfig} />
      case 'openai':
        return <OpenAIConfig config={typeConfig} onChange={setTypeConfig} />
      case 'bash':
        return <BashConfig config={typeConfig} onChange={setTypeConfig} />
      case 'claude-code':
        return <ClaudeCodeConfig config={typeConfig} onChange={setTypeConfig} />
      case 'openai-codex':
        return <OpenAICodexConfig config={typeConfig} onChange={setTypeConfig} />
      case 'cursor':
        return <CursorConfig config={typeConfig} onChange={setTypeConfig} />
      case 'openclaw':
        return <OpenClawConfig config={typeConfig} onChange={setTypeConfig} />
      case 'a2a':
        return <A2AConfig config={typeConfig} onChange={setTypeConfig} />
      case 'internal':
        return <InternalConfig config={typeConfig} onChange={setTypeConfig} />
      default:
        return null
    }
  }

  return (
    <>
      {showPresets && (
        <PresetPicker onSelect={handlePresetSelect} onClose={() => setShowPresets(false)} />
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Use Preset button */}
        {!agent && (
          <button
            type="button"
            onClick={() => setShowPresets(true)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 border border-dashed border-accent-purple/40 rounded-lg text-sm text-accent-purple hover:border-accent-purple hover:bg-accent-purple/5 transition-all"
          >
            <span className="text-base">⚡</span>
            Use a Preset
          </button>
        )}

        {/* Name */}
        <div>
          <label className={LABEL_CLASS}>Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="My Agent"
            className={INPUT_CLASS}
            required
          />
        </div>

        {/* Description */}
        <div>
          <label className={LABEL_CLASS}>Description</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this agent does..."
            className={INPUT_CLASS}
          />
        </div>

        {/* Type */}
        <div>
          <label className={LABEL_CLASS}>Type *</label>
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value as AgentType)
              setTypeConfig({})
            }}
            className={INPUT_CLASS}
          >
            {AGENT_TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.icon} {opt.label} — {opt.desc}
              </option>
            ))}
          </select>
        </div>

        {/* Divider */}
        <div className="border-t border-dark-border pt-1" />

        {/* Type-specific config */}
        {renderTypeConfig()}

        {/* Actions */}
        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={isPending}
            className="flex-1 px-4 py-2.5 bg-accent-purple hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
          >
            {isPending ? 'Saving...' : agent ? 'Update Agent' : 'Create Agent'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 bg-white/5 hover:bg-white/10 text-slate-300 text-sm font-medium rounded-lg border border-dark-border transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </>
  )
}
