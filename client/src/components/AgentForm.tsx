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
  getAgentSoulMd,
  getAgentHubPrompt,
  getAgentConnectorScript,
  testCli,
  testApiKey,
  testHttpEndpoint,
} from '../api/client'
import { useToast } from './Toaster'
import {
  X,
  Search,
  ChevronRight,
  ChevronDown,
  Info,
  CheckCircle,
  AlertCircle,
  Loader2,
  ExternalLink,
  Plug,
  Copy,
  FileText,
  Download,
  Terminal,
  Key,
  Globe,
} from 'lucide-react'

// ─── Styles ───────────────────────────────────────────────────────────────────

const INPUT_CLASS =
  'w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent-purple transition-colors'

const LABEL_CLASS = 'block text-xs font-medium text-slate-400 mb-1.5'

// ─── Category definitions (client-side mirror of backend CATEGORY_LABELS) ─────

type PresetCategory = 'local' | 'ai-api' | 'http' | 'automation' | 'mcp' | 'bash'

const CATEGORY_META: Record<PresetCategory, { label: string; icon: string; description: string }> = {
  local:      { label: 'Coding Agents',        icon: '🖥️', description: 'CLI tools running on this machine' },
  'ai-api':   { label: 'Internal Agents',      icon: '🧠', description: 'Cloud AI providers via API' },
  http:       { label: 'HTTP & Protocols',     icon: '🌐', description: 'Webhooks, REST APIs, A2A protocol' },
  automation: { label: 'Automation Platforms', icon: '⚙️', description: 'n8n, Zapier, Make and similar' },
  mcp:        { label: 'MCP Servers',          icon: '🔌', description: 'Model Context Protocol tools' },
  bash:       { label: 'Scripts & Shell',      icon: '💻', description: 'Bash, Python, Node.js scripts' },
}

const CATEGORY_ORDER: PresetCategory[] = ['local', 'ai-api', 'http', 'automation', 'mcp', 'bash']

// ─── Model Specs (mirrors backend MODEL_SPECS) ──────────────────────────────

const MODEL_SPECS: Record<string, {
  provider: 'anthropic' | 'openai'
  contextWindow: number
  maxOutput: number
  suggestedOutput: number
}> = {
  'claude-opus-4-6':            { provider: 'anthropic', contextWindow: 200000, maxOutput: 32000,  suggestedOutput: 25600 },
  'claude-sonnet-4-6':          { provider: 'anthropic', contextWindow: 200000, maxOutput: 16000,  suggestedOutput: 12800 },
  'claude-haiku-4-5-20251001':  { provider: 'anthropic', contextWindow: 200000, maxOutput: 8192,   suggestedOutput: 6554 },
  'gpt-5.4':                    { provider: 'openai',    contextWindow: 1048576, maxOutput: 32768,  suggestedOutput: 26214 },
  'gpt-5.4-pro':                { provider: 'openai',    contextWindow: 1048576, maxOutput: 32768,  suggestedOutput: 26214 },
  'gpt-5.4-mini':               { provider: 'openai',    contextWindow: 1048576, maxOutput: 16384,  suggestedOutput: 13107 },
  'gpt-5.4-nano':               { provider: 'openai',    contextWindow: 128000,  maxOutput: 8192,   suggestedOutput: 6554 },
  'gpt-4o':                     { provider: 'openai',    contextWindow: 128000,  maxOutput: 16384,  suggestedOutput: 13107 },
  'gpt-4o-mini':                { provider: 'openai',    contextWindow: 128000,  maxOutput: 16384,  suggestedOutput: 13107 },
  'o3':                         { provider: 'openai',    contextWindow: 200000,  maxOutput: 100000, suggestedOutput: 80000 },
  'o3-mini':                    { provider: 'openai',    contextWindow: 200000,  maxOutput: 65536,  suggestedOutput: 52429 },
  'o4-mini':                    { provider: 'openai',    contextWindow: 200000,  maxOutput: 100000, suggestedOutput: 80000 },
}

function formatK(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}K` : String(n)
}

// ─── Grouped type picker data ─────────────────────────────────────────────────

interface TypeOption {
  value: AgentType
  icon: string
  label: string
  desc: string
  category: PresetCategory
}

const TYPE_OPTIONS: TypeOption[] = [
  // Local
  { value: 'claude-code',  icon: '🤖', label: 'Claude Code',       desc: 'Anthropic Claude Code agent', category: 'local' },
  { value: 'openai-codex', icon: '⚡', label: 'Codex',            desc: 'OpenAI Codex agent', category: 'local' },
  { value: 'openclaw',     icon: '🦞', label: 'OpenClaw',         desc: 'OpenClaw agent', category: 'local' },
  { value: 'cursor',       icon: '🖱️', label: 'Cursor IDE',       desc: 'Cursor in headless mode', category: 'local' },
  // AI APIs
  { value: 'claude',    icon: '🧠', label: 'Claude API',    desc: 'Anthropic Claude models', category: 'ai-api' },
  { value: 'openai',    icon: '🤖', label: 'OpenAI API',    desc: 'OpenAI GPT / reasoning', category: 'ai-api' },
  { value: 'internal',  icon: '🎯', label: 'Internal',      desc: 'Built-in assistant', category: 'ai-api' },
  // HTTP & Protocols
  { value: 'http', icon: '🌐', label: 'HTTP Webhook', desc: 'Call any web endpoint', category: 'http' },
  { value: 'a2a',  icon: '🔗', label: 'A2A Protocol', desc: 'Any A2A-compatible agent', category: 'http' },
  // MCP
  { value: 'mcp', icon: '🔌', label: 'MCP Server', desc: 'Model Context Protocol', category: 'mcp' },
  // Shell
  { value: 'bash', icon: '💻', label: 'Bash / Script', desc: 'Shell commands & scripts', category: 'bash' },
]

// ─── Grouped Type Picker ──────────────────────────────────────────────────────

function GroupedTypePicker({
  value,
  onChange,
}: {
  value: AgentType
  onChange: (t: AgentType) => void
}) {
  return (
    <div className="space-y-3">
      {CATEGORY_ORDER.map((cat) => {
        const opts = TYPE_OPTIONS.filter((o) => o.category === cat)
        if (opts.length === 0) return null
        const meta = CATEGORY_META[cat]
        return (
          <div key={cat}>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <span>{meta.icon}</span>
              {meta.label}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {opts.map((opt) => {
                const selected = value === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => onChange(opt.value)}
                    className={`flex items-start gap-2 p-2.5 rounded-lg border text-left transition-all ${
                      selected
                        ? 'border-accent-purple bg-accent-purple/10 text-white'
                        : 'border-dark-border bg-dark-bg text-slate-300 hover:border-accent-purple/50 hover:bg-white/5'
                    }`}
                  >
                    <span className="text-lg leading-none shrink-0 mt-0.5">{opt.icon}</span>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate">{opt.label}</p>
                      <p className="text-xs text-slate-500 leading-tight mt-0.5 line-clamp-1">{opt.desc}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
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
  const [activeCategory, setActiveCategory] = useState<PresetCategory | 'all'>('all')
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())

  const { data: presetsData, isLoading } = useQuery({
    queryKey: ['presets'],
    queryFn: getPresets,
  })

  const presets = presetsData?.data || []

  const toggleExpand = (cat: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  // Filtered list for search mode
  const searchFiltered = search.trim()
    ? presets.filter(
        (p) =>
          p.name.toLowerCase().includes(search.toLowerCase()) ||
          p.description.toLowerCase().includes(search.toLowerCase())
      )
    : null

  const categoryFiltered =
    !search.trim() && activeCategory !== 'all'
      ? presets.filter((p) => p.category === activeCategory)
      : null

  const renderPresetCard = (preset: AgentPreset) => (
    <button
      key={preset.id}
      onClick={() => onSelect(preset)}
      className="group flex items-start gap-3 p-3.5 rounded-xl border border-dark-border bg-dark-bg hover:border-accent-purple/60 hover:bg-accent-purple/5 transition-all text-left w-full"
    >
      <span className="text-2xl leading-none mt-0.5 shrink-0">{preset.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-slate-200 group-hover:text-white transition-colors">
            {preset.name}
          </p>
          <span className="text-xs text-slate-600 bg-white/5 px-1.5 py-0.5 rounded font-mono shrink-0">
            {preset.type}
          </span>
          {preset.popular && (
            <span className="text-xs text-amber-400/80 bg-amber-400/10 px-1.5 py-0.5 rounded shrink-0">
              popular
            </span>
          )}
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
  )

  // Render grouped view (popular first, then "See All" expand)
  const renderGrouped = () => {
    const categoriesToShow = activeCategory === 'all' ? CATEGORY_ORDER : [activeCategory as PresetCategory]

    return (
      <div className="space-y-5">
        {categoriesToShow.map((cat) => {
          const catPresets = presets.filter((p) => p.category === cat)
          if (catPresets.length === 0) return null
          const meta = CATEGORY_META[cat]
          const popular = catPresets.filter((p) => p.popular)
          const rest = catPresets.filter((p) => !p.popular)
          const isExpanded = expandedCategories.has(cat)

          return (
            <div key={cat}>
              <div className="flex items-center gap-2 mb-2">
                <span>{meta.icon}</span>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  {meta.label}
                </h3>
                <span className="text-xs text-slate-600">({catPresets.length})</span>
              </div>
              <div className="space-y-1.5">
                {popular.map(renderPresetCard)}
              </div>
              {rest.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => toggleExpand(cat)}
                    className="mt-2 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" />
                    )}
                    {isExpanded
                      ? 'Show less'
                      : `See all ${meta.label} integrations (${rest.length} more)`}
                  </button>
                  {isExpanded && (
                    <div className="mt-1.5 space-y-1.5">
                      {rest.map(renderPresetCard)}
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-dark-card border border-dark-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
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
              placeholder="Search all presets..."
              autoFocus
              className="w-full bg-dark-bg border border-dark-border rounded-lg pl-9 pr-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent-purple transition-colors"
            />
          </div>
        </div>

        {/* Category tabs — hidden when searching */}
        {!search.trim() && (
          <div className="flex gap-1 px-4 pt-3 pb-1 flex-wrap border-b border-dark-border">
            <button
              onClick={() => setActiveCategory('all')}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                activeCategory === 'all'
                  ? 'bg-accent-purple text-white'
                  : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200'
              }`}
            >
              All
            </button>
            {CATEGORY_ORDER.map((cat) => {
              const meta = CATEGORY_META[cat]
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    activeCategory === cat
                      ? 'bg-accent-purple text-white'
                      : 'bg-white/5 text-slate-400 hover:bg-white/10 hover:text-slate-200'
                  }`}
                >
                  <span>{meta.icon}</span>
                  {meta.label}
                </button>
              )
            })}
          </div>
        )}

        {/* Content */}
        <div className="overflow-y-auto flex-1 p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-accent-purple" />
            </div>
          ) : searchFiltered !== null ? (
            // Search results — flat list
            searchFiltered.length === 0 ? (
              <div className="text-center py-12 text-slate-500 text-sm">
                No presets match your search
              </div>
            ) : (
              <div className="space-y-1.5">
                {searchFiltered.map(renderPresetCard)}
              </div>
            )
          ) : categoryFiltered !== null ? (
            // Single-category flat list
            <div className="space-y-1.5">
              {categoryFiltered.map(renderPresetCard)}
            </div>
          ) : (
            // Grouped view with popular + see-all
            renderGrouped()
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Info Box ─────────────────────────────────────────────────────────────────

function InfoBox({ children, variant = 'blue' }: { children: React.ReactNode; variant?: 'blue' | 'yellow' | 'purple' }) {
  const colors = {
    blue:   'bg-blue-500/10 border-blue-500/20 text-blue-300',
    yellow: 'bg-amber-500/10 border-amber-500/20 text-amber-300',
    purple: 'bg-accent-purple/10 border-accent-purple/20 text-slate-300',
  }
  return (
    <div className={`flex gap-2 p-3 rounded-lg border text-xs ${colors[variant]}`}>
      <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      <span>{children}</span>
    </div>
  )
}

function WarnBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-300">
      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
      <span>{children}</span>
    </div>
  )
}

// ─── HTTP Config ──────────────────────────────────────────────────────────────

interface KVRow {
  key: string
  value: string
}

function KVEditor({
  rows,
  onChange,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  label = 'Key-Value Pairs',
}: {
  rows: KVRow[]
  onChange: (rows: KVRow[]) => void
  keyPlaceholder?: string
  valuePlaceholder?: string
  label?: string
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className={LABEL_CLASS + ' mb-0'}>{label}</label>
        <button
          type="button"
          onClick={() => onChange([...rows, { key: '', value: '' }])}
          className="text-xs text-accent-purple hover:text-purple-400 transition-colors"
        >
          + Add row
        </button>
      </div>
      <div className="space-y-1.5">
        {rows.map((row, i) => (
          <div key={i} className="flex gap-2">
            <input
              type="text"
              value={row.key}
              onChange={(e) => {
                const next = [...rows]
                next[i] = { ...next[i], key: e.target.value }
                onChange(next)
              }}
              placeholder={keyPlaceholder}
              className={INPUT_CLASS + ' font-mono text-xs'}
            />
            <input
              type="text"
              value={row.value}
              onChange={(e) => {
                const next = [...rows]
                next[i] = { ...next[i], value: e.target.value }
                onChange(next)
              }}
              placeholder={valuePlaceholder}
              className={INPUT_CLASS + ' font-mono text-xs'}
            />
            <button
              type="button"
              onClick={() => onChange(rows.filter((_, j) => j !== i))}
              className="px-2 text-slate-500 hover:text-red-400 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="text-xs text-slate-600 italic">No entries. Click "+ Add row" to add one.</p>
        )}
      </div>
    </div>
  )
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
  const [headers, setHeaders] = useState<KVRow[]>(() => {
    const h = config.headers as Record<string, string> | undefined
    if (!h || Object.keys(h).length === 0) return []
    return Object.entries(h).map(([key, value]) => ({ key, value }))
  })
  const [authType, setAuthType] = useState<'none' | 'bearer' | 'basic' | 'apikey'>(
    (config.authType as any) || 'none'
  )
  const [authValue, setAuthValue] = useState((config.authValue as string) || '')
  const [bodyTemplate, setBodyTemplate] = useState((config.bodyTemplate as string) || '')
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle')
  const [testMsg, setTestMsg] = useState('')

  useEffect(() => {
    const headersObj: Record<string, string> = {}
    for (const row of headers) {
      if (row.key.trim()) headersObj[row.key.trim()] = row.value
    }
    if (authType === 'bearer' && authValue) {
      headersObj['Authorization'] = `Bearer ${authValue}`
    } else if (authType === 'basic' && authValue) {
      headersObj['Authorization'] = `Basic ${authValue}`
    } else if (authType === 'apikey' && authValue) {
      headersObj['X-API-Key'] = authValue
    }
    const c: Record<string, unknown> = { endpoint, method, headers: headersObj, authType, authValue }
    if (bodyTemplate.trim()) c.bodyTemplate = bodyTemplate
    onChange(c)
  }, [endpoint, method, headers, authType, authValue, bodyTemplate])

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
        <select value={method} onChange={(e) => setMethod(e.target.value)} className={INPUT_CLASS}>
          <option value="POST">POST</option>
          <option value="GET">GET</option>
          <option value="PUT">PUT</option>
          <option value="PATCH">PATCH</option>
        </select>
      </div>
      <div>
        <label className={LABEL_CLASS}>Auth</label>
        <select
          value={authType}
          onChange={(e) => setAuthType(e.target.value as any)}
          className={INPUT_CLASS}
        >
          <option value="none">None</option>
          <option value="bearer">Bearer Token</option>
          <option value="basic">Basic Auth (base64)</option>
          <option value="apikey">API Key (X-API-Key header)</option>
        </select>
      </div>
      {authType !== 'none' && (
        <div>
          <label className={LABEL_CLASS}>
            {authType === 'bearer'
              ? 'Bearer Token'
              : authType === 'apikey'
              ? 'API Key'
              : 'Base64 Credentials (user:pass)'}
          </label>
          <input
            type="password"
            value={authValue}
            onChange={(e) => setAuthValue(e.target.value)}
            placeholder={
              authType === 'bearer'
                ? 'your-token'
                : authType === 'apikey'
                ? 'your-api-key'
                : 'dXNlcjpwYXNz'
            }
            className={INPUT_CLASS}
          />
        </div>
      )}
      <KVEditor
        rows={headers}
        onChange={setHeaders}
        label="Additional Headers"
        keyPlaceholder="Header-Name"
        valuePlaceholder="value"
      />
      <div>
        <label className={LABEL_CLASS}>Body Template (JSON, optional)</label>
        <textarea
          value={bodyTemplate}
          onChange={(e) => setBodyTemplate(e.target.value)}
          rows={3}
          className={INPUT_CLASS + ' font-mono text-xs resize-y'}
          placeholder='{"key": "value"}'
        />
      </div>

      {/* ── Test Endpoint ── */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!endpoint.trim() || testStatus === 'testing'}
          onClick={async () => {
            setTestStatus('testing')
            setTestMsg('')
            try {
              const headersObj: Record<string, string> = {}
              for (const row of headers) { if (row.key.trim()) headersObj[row.key.trim()] = row.value }
              if (authType === 'bearer' && authValue) headersObj['Authorization'] = `Bearer ${authValue}`
              const r = await testHttpEndpoint(endpoint.trim(), headersObj)
              if (r.reachable) {
                setTestStatus('ok')
                setTestMsg(`HTTP ${r.status} ${r.statusText || ''}`.trim())
              } else {
                setTestStatus('error')
                setTestMsg(r.error || `HTTP ${r.status}`)
              }
            } catch {
              setTestStatus('error')
              setTestMsg('Request failed')
            }
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white/5 hover:bg-white/10 border border-dark-border text-slate-300 rounded-lg transition-colors disabled:opacity-50"
        >
          {testStatus === 'testing' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />}
          Test Endpoint
        </button>
        {testStatus === 'ok' && <span className="flex items-center gap-1 text-xs text-green-400"><CheckCircle className="w-3.5 h-3.5" />{testMsg}</span>}
        {testStatus === 'error' && <span className="flex items-center gap-1 text-xs text-red-400"><AlertCircle className="w-3.5 h-3.5" />{testMsg}</span>}
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
  const initialModel = (config.model as string) || 'claude-sonnet-4-6'
  const [model, setModel] = useState(initialModel)
  const [systemPrompt, setSystemPrompt] = useState(
    (config.systemPrompt as string) || (config.system_prompt as string) || ''
  )
  const spec = MODEL_SPECS[model]
  const defaultTokens = spec ? spec.suggestedOutput : 8192
  const [maxTokens, setMaxTokens] = useState(String((config.max_tokens as number) || defaultTokens))
  const [apiKey, setApiKey] = useState((config.api_key_override as string) || '')
  const [showApiKey, setShowApiKey] = useState(false)
  const [keyStatus, setKeyStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle')
  const [keyMsg, setKeyMsg] = useState('')
  const [showSystemPrompt, setShowSystemPrompt] = useState(!!systemPrompt)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const handleModelChange = (newModel: string) => {
    setModel(newModel)
    const newSpec = MODEL_SPECS[newModel]
    if (newSpec) setMaxTokens(String(newSpec.suggestedOutput))
  }

  useEffect(() => {
    const c: Record<string, unknown> = { model, systemPrompt, max_tokens: parseInt(maxTokens) || defaultTokens }
    if (apiKey) c.api_key_override = apiKey
    onChange(c)
  }, [model, systemPrompt, maxTokens, apiKey])

  const handleTestKey = async () => {
    const keyToTest = apiKey || (import.meta as any).env?.VITE_ANTHROPIC_API_KEY || ''
    if (!keyToTest) { setKeyStatus('error'); setKeyMsg('Enter an API key to test'); return }
    setKeyStatus('testing')
    setKeyMsg('')
    try {
      const r = await testApiKey('anthropic', keyToTest)
      if (r.valid) { setKeyStatus('ok'); setKeyMsg(`Valid — ${r.model || 'claude'}`) }
      else { setKeyStatus('error'); setKeyMsg(r.error || 'Invalid key') }
    } catch { setKeyStatus('error'); setKeyMsg('Test failed') }
  }

  return (
    <div className="space-y-3">
      <div>
        <label className={LABEL_CLASS}>Model</label>
        <select value={model} onChange={(e) => handleModelChange(e.target.value)} className={INPUT_CLASS}>
          <optgroup label="Claude">
            <option value="claude-opus-4-6">claude-opus-4-6 — most capable</option>
            <option value="claude-sonnet-4-6">claude-sonnet-4-6 — balanced (recommended)</option>
            <option value="claude-haiku-4-5-20251001">claude-haiku-4-5 — fastest &amp; cheapest</option>
          </optgroup>
        </select>
      </div>
      <div>
        <button
          type="button"
          onClick={() => setShowSystemPrompt(!showSystemPrompt)}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors mb-1.5"
        >
          <ChevronRight className={`w-3 h-3 transition-transform ${showSystemPrompt ? 'rotate-90' : ''}`} />
          System Prompt (optional)
        </button>
        {showSystemPrompt && (
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={3}
            className={INPUT_CLASS + ' resize-y'}
            placeholder="You are a helpful assistant..."
          />
        )}
      </div>

      {/* ── Advanced Settings ── */}
      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
        >
          <ChevronRight className={`w-3 h-3 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} />
          Advanced Settings
        </button>
        {showAdvanced && (
          <div className="mt-2 border border-dark-border rounded-xl p-3 space-y-2 bg-dark-bg/50">
            <button
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1.5 transition-colors"
            >
              <Key className="w-3.5 h-3.5" />
              <ChevronRight className={`w-3 h-3 transition-transform ${showApiKey ? 'rotate-90' : ''}`} />
              API Key Override (optional)
            </button>
            {showApiKey && (
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-ant-... (uses ANTHROPIC_API_KEY env var if empty)"
                className={INPUT_CLASS}
              />
            )}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleTestKey}
                disabled={keyStatus === 'testing'}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white/5 hover:bg-white/10 border border-dark-border text-slate-300 rounded-lg transition-colors disabled:opacity-50"
              >
                {keyStatus === 'testing' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Key className="w-3.5 h-3.5" />}
                Test API Key
              </button>
              {keyStatus === 'ok' && <span className="flex items-center gap-1 text-xs text-green-400"><CheckCircle className="w-3.5 h-3.5" />{keyMsg}</span>}
              {keyStatus === 'error' && <span className="flex items-center gap-1 text-xs text-red-400"><AlertCircle className="w-3.5 h-3.5" />{keyMsg}</span>}
            </div>
          </div>
        )}
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
  const initialModel = (config.model as string) || 'gpt-5.4'
  const [model, setModel] = useState(initialModel)
  const [systemPrompt, setSystemPrompt] = useState(
    (config.systemPrompt as string) || (config.system_prompt as string) || ''
  )
  const oSpec = MODEL_SPECS[model]
  const oDefaultTokens = oSpec ? oSpec.suggestedOutput : 8192
  const [maxTokens, setMaxTokens] = useState(String((config.max_tokens as number) || oDefaultTokens))
  const [apiKey, setApiKey] = useState((config.api_key_override as string) || '')
  const [showApiKey, setShowApiKey] = useState(false)
  const [keyStatus, setKeyStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle')
  const [keyMsg, setKeyMsg] = useState('')
  const [showOSystemPrompt, setShowOSystemPrompt] = useState(!!systemPrompt)
  const [showOAdvanced, setShowOAdvanced] = useState(false)

  const handleModelChange = (newModel: string) => {
    setModel(newModel)
    const newSpec = MODEL_SPECS[newModel]
    if (newSpec) setMaxTokens(String(newSpec.suggestedOutput))
  }

  useEffect(() => {
    const c: Record<string, unknown> = { model, systemPrompt, max_tokens: parseInt(maxTokens) || oDefaultTokens }
    if (apiKey) c.api_key_override = apiKey
    onChange(c)
  }, [model, systemPrompt, maxTokens, apiKey])

  const handleTestKey = async () => {
    if (!apiKey) { setKeyStatus('error'); setKeyMsg('Enter an API key to test'); return }
    setKeyStatus('testing')
    setKeyMsg('')
    try {
      const r = await testApiKey('openai', apiKey)
      if (r.valid) { setKeyStatus('ok'); setKeyMsg(`Valid — ${r.modelCount} models available`) }
      else { setKeyStatus('error'); setKeyMsg(r.error || 'Invalid key') }
    } catch { setKeyStatus('error'); setKeyMsg('Test failed') }
  }

  return (
    <div className="space-y-3">
      <div>
        <label className={LABEL_CLASS}>Model</label>
        <select value={model} onChange={(e) => handleModelChange(e.target.value)} className={INPUT_CLASS}>
          <optgroup label="GPT-5.4">
            <option value="gpt-5.4">gpt-5.4 — flagship ($2.50/$15.00)</option>
            <option value="gpt-5.4-pro">gpt-5.4-pro — max performance</option>
            <option value="gpt-5.4-mini">gpt-5.4-mini — fast ($0.75/$3.00)</option>
            <option value="gpt-5.4-nano">gpt-5.4-nano — cheapest</option>
          </optgroup>
          <optgroup label="GPT-4o">
            <option value="gpt-4o">gpt-4o — great balance</option>
            <option value="gpt-4o-mini">gpt-4o-mini — budget friendly</option>
          </optgroup>
          <optgroup label="Reasoning">
            <option value="o3">o3 — advanced reasoning</option>
            <option value="o3-mini">o3-mini — fast reasoning</option>
            <option value="o4-mini">o4-mini — fast reasoning</option>
          </optgroup>
        </select>
      </div>
      <div>
        <button
          type="button"
          onClick={() => setShowOSystemPrompt(!showOSystemPrompt)}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors mb-1.5"
        >
          <ChevronRight className={`w-3 h-3 transition-transform ${showOSystemPrompt ? 'rotate-90' : ''}`} />
          System Prompt (optional)
        </button>
        {showOSystemPrompt && (
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={3}
            className={INPUT_CLASS + ' resize-y'}
            placeholder="You are a helpful assistant..."
          />
        )}
      </div>

      {/* ── Advanced Settings ── */}
      <div>
        <button
          type="button"
          onClick={() => setShowOAdvanced(!showOAdvanced)}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
        >
          <ChevronRight className={`w-3 h-3 transition-transform ${showOAdvanced ? 'rotate-90' : ''}`} />
          Advanced Settings
        </button>
        {showOAdvanced && (
          <div className="mt-2 border border-dark-border rounded-xl p-3 space-y-2 bg-dark-bg/50">
            <button
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1.5 transition-colors"
            >
              <Key className="w-3.5 h-3.5" />
              <ChevronRight className={`w-3 h-3 transition-transform ${showApiKey ? 'rotate-90' : ''}`} />
              API Key Override (optional)
            </button>
            {showApiKey && (
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-... (uses OPENAI_API_KEY env var if empty)"
                className={INPUT_CLASS}
              />
            )}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleTestKey}
                disabled={keyStatus === 'testing'}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white/5 hover:bg-white/10 border border-dark-border text-slate-300 rounded-lg transition-colors disabled:opacity-50"
              >
                {keyStatus === 'testing' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Key className="w-3.5 h-3.5" />}
                Test API Key
              </button>
              {keyStatus === 'ok' && <span className="flex items-center gap-1 text-xs text-green-400"><CheckCircle className="w-3.5 h-3.5" />{keyMsg}</span>}
              {keyStatus === 'error' && <span className="flex items-center gap-1 text-xs text-red-400"><AlertCircle className="w-3.5 h-3.5" />{keyMsg}</span>}
            </div>
          </div>
        )}
      </div>
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
  const [systemPrompt, setSystemPrompt] = useState((config.systemPrompt as string) || '')
  const [showSysPrompt, setShowSysPrompt] = useState(!!systemPrompt)

  useEffect(() => {
    const c: Record<string, unknown> = { systemPrompt }
    if (provider !== 'auto') c.provider = provider
    onChange(c)
  }, [provider, systemPrompt])

  const modelLabel = provider === 'openai'
    ? 'gpt-5.4 (auto-selected)'
    : provider === 'anthropic'
    ? 'claude-sonnet-4-6 (auto-selected)'
    : 'auto-detected from API keys'

  return (
    <div className="space-y-3">
      <InfoBox variant="purple">
        Uses whichever API key is configured in your environment. Model is automatically selected for each provider.
      </InfoBox>
      <div>
        <label className={LABEL_CLASS}>Provider</label>
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
          className={INPUT_CLASS}
        >
          <option value="auto">Auto-detect (use whichever key is set)</option>
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="openai">OpenAI (GPT)</option>
        </select>
      </div>
      <div className="flex items-center gap-2 px-3 py-2 bg-dark-bg border border-dark-border rounded-lg">
        <span className="text-xs text-slate-500">Model:</span>
        <span className="text-xs text-slate-400 font-mono">{modelLabel}</span>
      </div>
      <div>
        <button
          type="button"
          onClick={() => setShowSysPrompt(!showSysPrompt)}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors mb-1.5"
        >
          <ChevronRight className={`w-3 h-3 transition-transform ${showSysPrompt ? 'rotate-90' : ''}`} />
          System Prompt (optional)
        </button>
        {showSysPrompt && (
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={3}
            className={INPUT_CLASS + ' resize-y'}
            placeholder="You are a helpful assistant..."
          />
        )}
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
  const [timeoutSec, setTimeoutSec] = useState(String(Math.round(((config.timeout as number) || 30000) / 1000)))
  const [workDir, setWorkDir] = useState((config.workDir as string) || '')
  const [envVars, setEnvVars] = useState<KVRow[]>(() => {
    const e = config.env as Record<string, string> | undefined
    if (!e || Object.keys(e).length === 0) return []
    return Object.entries(e).map(([key, value]) => ({ key, value }))
  })

  useEffect(() => {
    const c: Record<string, unknown> = { command, timeout: (parseInt(timeoutSec) || 30) * 1000 }
    if (workDir) c.workDir = workDir
    if (envVars.length > 0) {
      const envObj: Record<string, string> = {}
      for (const row of envVars) {
        if (row.key.trim()) envObj[row.key.trim()] = row.value
      }
      c.env = envObj
    }
    onChange(c)
  }, [command, timeoutSec, workDir, envVars])

  return (
    <div className="space-y-3">
      <WarnBox>
        Commands run with the same permissions as the AgentHub process. Use with caution.
      </WarnBox>
      <div>
        <label className={LABEL_CLASS}>Command</label>
        <textarea
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          rows={4}
          className={INPUT_CLASS + ' font-mono text-xs resize-y'}
          placeholder="python3 /path/to/script.py"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={LABEL_CLASS}>Timeout (seconds)</label>
          <input
            type="number"
            value={timeoutSec}
            onChange={(e) => setTimeoutSec(e.target.value)}
            min={1}
            max={600}
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
      <KVEditor
        rows={envVars}
        onChange={setEnvVars}
        label="Environment Variables"
        keyPlaceholder="VAR_NAME"
        valuePlaceholder="value"
      />
    </div>
  )
}

// ─── Claude Code Config ──────────────────────────────────────────────────────

type CcConnectionType = 'local-cli' | 'remote-connector' | 'api'
const CC_CONNECTION_OPTIONS: { value: CcConnectionType; label: string; desc: string }[] = [
  { value: 'local-cli',        label: 'Local CLI',          desc: 'Run Claude Code directly on this machine via CLI' },
  { value: 'remote-connector', label: 'Remote Connector',   desc: 'Run on a remote machine via polling connector script' },
  { value: 'api',              label: 'API (Direct)',       desc: 'Call Claude API directly without CLI — fastest, no install needed' },
]

function ClaudeCodeConfig({
  config,
  onChange,
  agentId,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
  agentId?: string
}) {
  const [connectionType, setConnectionType] = useState<CcConnectionType>(
    (config.connectionType as CcConnectionType) || 'local-cli'
  )
  const [model, setModel] = useState((config.model as string) || 'claude-sonnet-4-6')
  const [systemPrompt, setSystemPrompt] = useState((config.systemPrompt as string) || '')
  const [maxTurns, setMaxTurns] = useState(String((config.maxTurns as number) || 5))
  const [workDir, setWorkDir] = useState((config.workDir as string) || '/tmp')
  const [tools, setTools] = useState((config.tools as string) || '')
  const [script, setScript] = useState<string | null>(null)
  const [scriptLoading, setScriptLoading] = useState(false)
  const [scriptCopied, setScriptCopied] = useState(false)
  const [cliStatus, setCliStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle')
  const [cliMsg, setCliMsg] = useState('')

  useEffect(() => {
    const c: Record<string, unknown> = { connectionType, model, maxTurns: parseInt(maxTurns) || 5 }
    if (connectionType !== 'api') c.workDir = workDir
    if (systemPrompt) c.systemPrompt = systemPrompt
    if (tools) c.tools = tools
    onChange(c)
  }, [connectionType, model, systemPrompt, maxTurns, workDir, tools])

  const handleCheckCli = async () => {
    setCliStatus('checking')
    setCliMsg('')
    try {
      const r = await testCli('claude-code')
      if (r.installed) { setCliStatus('ok'); setCliMsg(r.version || 'installed') }
      else { setCliStatus('error'); setCliMsg(r.error || 'Not installed') }
    } catch { setCliStatus('error'); setCliMsg('Check failed') }
  }

  return (
    <div className="space-y-3">
      {/* ── Connection Type ── */}
      <div>
        <label className={LABEL_CLASS}>Connection Mode</label>
        <div className="grid grid-cols-3 gap-2">
          {CC_CONNECTION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setConnectionType(opt.value)}
              className={`p-2.5 rounded-lg border text-left transition-colors ${
                connectionType === opt.value
                  ? 'border-accent-purple/60 bg-accent-purple/10 text-slate-200'
                  : 'border-dark-border text-slate-400 hover:border-slate-500 hover:text-slate-300'
              }`}
            >
              <p className="text-xs font-semibold">{opt.label}</p>
              <p className="text-[10px] text-slate-500 mt-0.5 leading-tight">{opt.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* ── CLI Check (only for local-cli) ── */}
      {connectionType === 'local-cli' && (
        <div className="border border-dark-border rounded-xl p-3 space-y-2 bg-dark-bg/50">
          <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
            <Terminal className="w-3.5 h-3.5" />
            Installation Check
          </p>
          <p className="text-xs text-slate-500">
            Install: <code className="font-mono bg-white/10 px-1 rounded">npm install -g @anthropic-ai/claude-code</code>
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleCheckCli}
              disabled={cliStatus === 'checking'}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white/5 hover:bg-white/10 border border-dark-border text-slate-300 rounded-lg transition-colors disabled:opacity-50"
            >
              {cliStatus === 'checking' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Terminal className="w-3.5 h-3.5" />}
              Check claude CLI
            </button>
            {cliStatus === 'ok' && <span className="flex items-center gap-1 text-xs text-green-400"><CheckCircle className="w-3.5 h-3.5" />{cliMsg}</span>}
            {cliStatus === 'error' && <span className="flex items-center gap-1 text-xs text-red-400"><AlertCircle className="w-3.5 h-3.5" />{cliMsg}</span>}
          </div>
        </div>
      )}

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
        {connectionType !== 'api' && (
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
        )}
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

      {/* Remote Connector Script (only for remote-connector mode) */}
      {connectionType === 'remote-connector' && (
        <div className="border border-dark-border rounded-xl p-4 space-y-3 bg-dark-bg/50">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-300">Remote Machine Connector</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Run Claude Code on another machine. Script polls AgentHub for tasks and executes them locally.
              </p>
            </div>
            {agentId && (
              <button
                type="button"
                onClick={async () => {
                  setScriptLoading(true)
                  try {
                    const r = await getAgentConnectorScript(agentId)
                    setScript(r.data.script)
                  } catch { /* ignore */ }
                  finally { setScriptLoading(false) }
                }}
                disabled={scriptLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent-purple/20 hover:bg-accent-purple/30 border border-accent-purple/30 text-accent-purple rounded-lg transition-colors disabled:opacity-50 shrink-0"
              >
                {scriptLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                Generate Script
              </button>
            )}
            {!agentId && <span className="text-xs text-slate-600 italic">Save agent first</span>}
          </div>
          {script && (
            <div className="space-y-2">
              <div className="relative">
                <pre className="text-xs text-slate-300 bg-dark-bg border border-dark-border rounded-lg p-3 overflow-auto max-h-40 font-mono whitespace-pre-wrap">
                  {script}
                </pre>
                <button
                  type="button"
                  onClick={() => { navigator.clipboard.writeText(script); setScriptCopied(true); setTimeout(() => setScriptCopied(false), 1500) }}
                  className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 text-xs bg-dark-sidebar border border-dark-border rounded text-slate-400 hover:text-slate-200 transition-colors"
                >
                  <Copy className="w-3 h-3" />
                  {scriptCopied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <p className="text-xs text-slate-600">
                On the remote machine: <code className="font-mono">chmod +x connector.sh && HUB_API_KEY=your-key ./connector.sh</code>
              </p>
            </div>
          )}
        </div>
      )}

      {/* API mode info */}
      {connectionType === 'api' && (
        <div className="border border-dark-border rounded-xl p-3 bg-dark-bg/50">
          <p className="text-xs text-slate-400">
            API mode calls Claude directly via the Anthropic API. No CLI installation needed.
            Make sure an Anthropic API key is configured in <strong className="text-slate-300">Settings &gt; API Keys</strong>.
          </p>
        </div>
      )}
    </div>
  )
}

// ─── OpenAI Codex Config ─────────────────────────────────────────────────────

type CxConnectionType = 'local-cli' | 'remote-connector' | 'api'
const CX_CONNECTION_OPTIONS: { value: CxConnectionType; label: string; desc: string }[] = [
  { value: 'local-cli',        label: 'Local CLI',          desc: 'Run Codex directly on this machine via CLI' },
  { value: 'remote-connector', label: 'Remote Connector',   desc: 'Run on a remote machine via polling connector script' },
  { value: 'api',              label: 'API (Direct)',       desc: 'Call OpenAI API directly without CLI — fastest, no install needed' },
]

function OpenAICodexConfig({
  config,
  onChange,
  agentId,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
  agentId?: string
}) {
  const [connectionType, setConnectionType] = useState<CxConnectionType>(
    (config.connectionType as CxConnectionType) || 'local-cli'
  )
  const [mode, setMode] = useState((config.mode as string) || 'full-auto')
  const [workDir, setWorkDir] = useState((config.workDir as string) || '/tmp')
  const [apiKey, setApiKey] = useState((config.apiKeyOverride as string) || '')
  const [cliStatus, setCliStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle')
  const [cliMsg, setCliMsg] = useState('')
  const [script, setScript] = useState<string | null>(null)
  const [scriptLoading, setScriptLoading] = useState(false)
  const [scriptCopied, setScriptCopied] = useState(false)

  useEffect(() => {
    const c: Record<string, unknown> = { connectionType, mode }
    if (connectionType !== 'api') c.workDir = workDir
    if (apiKey) c.apiKeyOverride = apiKey
    onChange(c)
  }, [connectionType, mode, workDir, apiKey])

  const handleCheckCli = async () => {
    setCliStatus('checking')
    setCliMsg('')
    try {
      const r = await testCli('openai-codex')
      if (r.installed) { setCliStatus('ok'); setCliMsg(r.version || 'installed') }
      else { setCliStatus('error'); setCliMsg(r.error || 'Not installed') }
    } catch { setCliStatus('error'); setCliMsg('Check failed') }
  }

  return (
    <div className="space-y-3">
      {/* ── Connection Type ── */}
      <div>
        <label className={LABEL_CLASS}>Connection Mode</label>
        <div className="grid grid-cols-3 gap-2">
          {CX_CONNECTION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setConnectionType(opt.value)}
              className={`p-2.5 rounded-lg border text-left transition-colors ${
                connectionType === opt.value
                  ? 'border-accent-purple/60 bg-accent-purple/10 text-slate-200'
                  : 'border-dark-border text-slate-400 hover:border-slate-500 hover:text-slate-300'
              }`}
            >
              <p className="text-xs font-semibold">{opt.label}</p>
              <p className="text-[10px] text-slate-500 mt-0.5 leading-tight">{opt.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* ── CLI Check (only for local-cli) ── */}
      {connectionType === 'local-cli' && (
        <div className="border border-dark-border rounded-xl p-3 space-y-2 bg-dark-bg/50">
          <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
            <Terminal className="w-3.5 h-3.5" />
            Installation Check
          </p>
          <p className="text-xs text-slate-500">
            Install: <code className="font-mono bg-white/10 px-1 rounded">npm install -g @openai/codex</code>
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleCheckCli}
              disabled={cliStatus === 'checking'}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white/5 hover:bg-white/10 border border-dark-border text-slate-300 rounded-lg transition-colors disabled:opacity-50"
            >
              {cliStatus === 'checking' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Terminal className="w-3.5 h-3.5" />}
              Check codex CLI
            </button>
            {cliStatus === 'ok' && <span className="flex items-center gap-1 text-xs text-green-400"><CheckCircle className="w-3.5 h-3.5" />{cliMsg}</span>}
            {cliStatus === 'error' && <span className="flex items-center gap-1 text-xs text-red-400"><AlertCircle className="w-3.5 h-3.5" />{cliMsg}</span>}
          </div>
        </div>
      )}

      {connectionType !== 'api' && (
        <div>
          <label className={LABEL_CLASS}>Mode</label>
          <select value={mode} onChange={(e) => setMode(e.target.value)} className={INPUT_CLASS}>
            <option value="full-auto">full-auto — autonomous</option>
            <option value="auto-edit">auto-edit — edit files automatically</option>
            <option value="suggest">suggest — suggest only</option>
          </select>
        </div>
      )}
      {connectionType !== 'api' && (
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
      )}
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

      {/* Remote Connector Script (only for remote-connector mode) */}
      {connectionType === 'remote-connector' && (
        <div className="border border-dark-border rounded-xl p-4 space-y-3 bg-dark-bg/50">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-300">Remote Machine Connector</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Run Codex on another machine. Script polls AgentHub for tasks and executes them locally.
              </p>
            </div>
            {agentId && (
              <button
                type="button"
                onClick={async () => {
                  setScriptLoading(true)
                  try {
                    const r = await getAgentConnectorScript(agentId)
                    setScript(r.data.script)
                  } catch { /* ignore */ }
                  finally { setScriptLoading(false) }
                }}
                disabled={scriptLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-accent-purple/20 hover:bg-accent-purple/30 border border-accent-purple/30 text-accent-purple rounded-lg transition-colors disabled:opacity-50 shrink-0"
              >
                {scriptLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
                Generate Script
              </button>
            )}
            {!agentId && <span className="text-xs text-slate-600 italic">Save agent first</span>}
          </div>
          {script && (
            <div className="space-y-2">
              <div className="relative">
                <pre className="text-xs text-slate-300 bg-dark-bg border border-dark-border rounded-lg p-3 overflow-auto max-h-40 font-mono whitespace-pre-wrap">
                  {script}
                </pre>
                <button
                  type="button"
                  onClick={() => { navigator.clipboard.writeText(script); setScriptCopied(true); setTimeout(() => setScriptCopied(false), 1500) }}
                  className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 text-xs bg-dark-sidebar border border-dark-border rounded text-slate-400 hover:text-slate-200 transition-colors"
                >
                  <Copy className="w-3 h-3" />
                  {scriptCopied ? 'Copied!' : 'Copy'}
                </button>
              </div>
              <p className="text-xs text-slate-600">
                On the remote machine: <code className="font-mono">chmod +x connector.sh && HUB_API_KEY=your-key ./connector.sh</code>
              </p>
            </div>
          )}
        </div>
      )}

      {/* API mode info */}
      {connectionType === 'api' && (
        <div className="border border-dark-border rounded-xl p-3 bg-dark-bg/50">
          <p className="text-xs text-slate-400">
            API mode calls OpenAI directly via the API. No CLI installation needed.
            Make sure an OpenAI API key is configured in <strong className="text-slate-300">Settings &gt; API Keys</strong> or use the override above.
          </p>
        </div>
      )}
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
  const [cliStatus, setCliStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle')
  const [cliMsg, setCliMsg] = useState('')

  useEffect(() => {
    const c: Record<string, unknown> = { workDir, outputFormat }
    if (apiKey) c.apiKey = apiKey
    onChange(c)
  }, [workDir, outputFormat, apiKey])

  const handleCheckCli = async () => {
    setCliStatus('checking')
    setCliMsg('')
    try {
      const r = await testCli('cursor')
      if (r.installed) { setCliStatus('ok'); setCliMsg(r.version || 'installed') }
      else { setCliStatus('error'); setCliMsg(r.error || 'Not installed') }
    } catch { setCliStatus('error'); setCliMsg('Check failed') }
  }

  return (
    <div className="space-y-3">
      {/* ── CLI Check ── */}
      <div className="border border-dark-border rounded-xl p-3 space-y-2 bg-dark-bg/50">
        <p className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
          <Terminal className="w-3.5 h-3.5" />
          Installation Check
        </p>
        <p className="text-xs text-slate-500">
          Install Cursor from{' '}
          <a href="https://cursor.com" target="_blank" rel="noopener noreferrer" className="underline hover:opacity-80">cursor.com</a>
        </p>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleCheckCli}
            disabled={cliStatus === 'checking'}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white/5 hover:bg-white/10 border border-dark-border text-slate-300 rounded-lg transition-colors disabled:opacity-50"
          >
            {cliStatus === 'checking' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Terminal className="w-3.5 h-3.5" />}
            Check cursor CLI
          </button>
          {cliStatus === 'ok' && <span className="flex items-center gap-1 text-xs text-green-400"><CheckCircle className="w-3.5 h-3.5" />{cliMsg}</span>}
          {cliStatus === 'error' && <span className="flex items-center gap-1 text-xs text-red-400"><AlertCircle className="w-3.5 h-3.5" />{cliMsg}</span>}
        </div>
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
        <label className={LABEL_CLASS}>Output Format</label>
        <select value={outputFormat} onChange={(e) => setOutputFormat(e.target.value)} className={INPUT_CLASS}>
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
// Connection modes (docs.openclaw.ai):
//  responses    → POST /v1/responses   (full agent run, OpenAI Responses API)
//  tools-invoke → POST /tools/invoke   (single tool, always active)
//  webhook      → POST /hooks/<path>   (event trigger, hooks.enabled required)
//  cli          → openclaw agent --agent <id>  (local CLI, same machine only)

type OcConnectionType = 'responses' | 'tools-invoke' | 'webhook' | 'cli'

const OC_CONNECTION_OPTIONS: { value: OcConnectionType; label: string; desc: string }[] = [
  { value: 'responses',    label: 'OpenResponses API',  desc: 'POST /v1/responses — full agent run (recommended, must be enabled in OpenClaw)' },
  { value: 'tools-invoke', label: 'Tools Invoke API',   desc: 'POST /tools/invoke — single tool call, always active' },
  { value: 'webhook',      label: 'Webhook Trigger',    desc: 'POST /hooks/<path> — event-driven, hooks.enabled=true + hooks.token required' },
  { value: 'cli',          label: 'Local CLI',          desc: 'openclaw agent --agent <id> — only works when OpenClaw is on the same machine' },
]

function OpenClawConfig({
  config,
  onChange,
  agentId,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
  agentId?: string
}) {
  const [connectionType, setConnectionType] = useState<OcConnectionType>(
    (config.connectionType as OcConnectionType) || 'responses'
  )
  // Shared
  const [host,         setHost]         = useState((config.host as string)         || 'localhost')
  const [port,         setPort]         = useState(String((config.port as number)  || 18789))
  const [model,        setModel]        = useState((config.model as string)        || 'auto')
  const [systemPrompt, setSystemPrompt] = useState((config.systemPrompt as string) || '')
  // responses + tools-invoke
  const [gatewayToken, setGatewayToken] = useState((config.token as string)        || '')
  const [ocAgentId,    setOcAgentId]    = useState((config.ocAgentId as string)    || '')
  // tools-invoke
  const [toolName,     setToolName]     = useState((config.toolName as string)     || 'run')
  // webhook
  const [webhookPath,  setWebhookPath]  = useState((config.webhookPath as string)  || '/hooks/agenthub')
  const [webhookToken, setWebhookToken] = useState((config.webhookToken as string) || '')
  // test
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle')
  const [testMsg,    setTestMsg]    = useState('')
  // onboarding docs
  const [soulMd,      setSoulMd]      = useState<string | null>(null)
  const [heartbeatMd, setHeartbeatMd] = useState<string | null>(null)
  const [bootstrapMd, setBootstrapMd] = useState<string | null>(null)
  const [hubPrompt,   setHubPrompt]   = useState<string | null>(null)
  const [docsLoading, setDocsLoading] = useState(false)
  const [activeDoc, setActiveDoc] = useState<'bootstrap' | 'soul' | 'heartbeat' | 'prompt'>('bootstrap')
  const [copied, setCopied] = useState(false)
  const [docsError, setDocsError] = useState<string | null>(null)

  // ── Auto-load onboarding docs when agentId is available ──────────────────
  const fetchDocs = async () => {
    if (!agentId) return
    setDocsLoading(true)
    setDocsError(null)
    try {
      const [soulResult, promptResult] = await Promise.all([
        getAgentSoulMd(agentId),
        getAgentHubPrompt(agentId),
      ])
      setSoulMd(soulResult.data.soulMd)
      setHeartbeatMd(soulResult.data.heartbeatMd)
      setBootstrapMd(soulResult.data.bootstrapMd)
      setHubPrompt(promptResult.data.prompt)
      setActiveDoc('bootstrap')
    } catch (e: any) {
      setDocsError(e?.message || 'Error loading onboarding files')
    } finally {
      setDocsLoading(false)
    }
  }

  useEffect(() => {
    if (agentId) { fetchDocs() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId])

  useEffect(() => {
    const c: Record<string, unknown> = {
      connectionType,
      host,
      port: parseInt(port) || 18789,
    }
    if (systemPrompt) c.systemPrompt = systemPrompt
    if (connectionType === 'responses' || connectionType === 'tools-invoke') {
      if (gatewayToken) c.token = gatewayToken
      if (ocAgentId)    c.ocAgentId = ocAgentId
    }
    if (connectionType === 'tools-invoke') {
      if (toolName) c.toolName = toolName
    }
    if (connectionType === 'webhook') {
      if (webhookPath)  c.webhookPath  = webhookPath
      if (webhookToken) c.webhookToken = webhookToken
    }
    if (connectionType === 'cli') {
      if (ocAgentId) c.ocAgentId = ocAgentId
    }
    onChange(c)
  }, [connectionType, host, port, systemPrompt, gatewayToken, ocAgentId, toolName, webhookPath, webhookToken])

  const handleTest = async () => {
    setTestStatus('testing')
    try {
      const result = await discoverOpenclaw(host, parseInt(port) || 18789)
      if (result.connected) {
        setTestStatus('ok')
        setTestMsg(`Connected${result.version ? ` — OpenClaw v${result.version}` : ''}`)
      } else {
        setTestStatus('error')
        setTestMsg(result.error || 'Not reachable')
      }
    } catch {
      setTestStatus('error')
      setTestMsg('Connection failed')
    }
  }

  const handleGenerateDocs = fetchDocs

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleDownload = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/plain; charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
  }

  const activeContent =
    activeDoc === 'soul' ? soulMd : activeDoc === 'heartbeat' ? heartbeatMd
    : activeDoc === 'bootstrap' ? bootstrapMd : hubPrompt
  const activeFilename =
    activeDoc === 'soul' ? 'SOUL.md' : activeDoc === 'heartbeat' ? 'HEARTBEAT.md'
    : activeDoc === 'bootstrap' ? 'BOOTSTRAP.md' : 'hub-prompt.txt'

  return (
    <div className="space-y-3">
      {/* ── Connection Type ─────────────────────────────────────────────────── */}
      <div>
        <label className={LABEL_CLASS}>Connection Type</label>
        <div className="grid grid-cols-2 gap-2">
          {OC_CONNECTION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setConnectionType(opt.value)}
              className={`p-2.5 rounded-lg border text-left transition-colors ${
                connectionType === opt.value
                  ? 'border-accent-purple/60 bg-accent-purple/10 text-slate-200'
                  : 'border-dark-border text-slate-400 hover:border-slate-500 hover:text-slate-300'
              }`}
            >
              <p className="text-xs font-semibold">{opt.label}</p>
              <p className="text-[10px] text-slate-500 mt-0.5 leading-tight">{opt.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* ── Shared: Host + Port (not needed for CLI since it's local) ──────── */}
      {connectionType !== 'cli' && (
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2">
            <label className={LABEL_CLASS}>Host</label>
            <input type="text" value={host} onChange={(e) => setHost(e.target.value)}
              placeholder="localhost" className={INPUT_CLASS + ' font-mono text-xs'} />
          </div>
          <div>
            <label className={LABEL_CLASS}>Port</label>
            <input type="number" value={port} onChange={(e) => setPort(e.target.value)}
              placeholder="18789" className={INPUT_CLASS} />
          </div>
        </div>
      )}

      {/* ── responses + tools-invoke: Gateway Token ──────────────────────── */}
      {(connectionType === 'responses' || connectionType === 'tools-invoke') && (
        <>
          <div>
            <label className={LABEL_CLASS}>
              Gateway Token
              <span className="text-slate-600 font-normal ml-1">(gateway.auth.token)</span>
            </label>
            <input type="password" value={gatewayToken} onChange={(e) => setGatewayToken(e.target.value)}
              placeholder="your-gateway-token" className={INPUT_CLASS} />
          </div>
          <div>
            <label className={LABEL_CLASS}>
              OpenClaw Agent ID
              <span className="text-slate-600 font-normal ml-1">(optional, routes to specific agent)</span>
            </label>
            <input type="text" value={ocAgentId} onChange={(e) => setOcAgentId(e.target.value)}
              placeholder="agent-uuid or name" className={INPUT_CLASS + ' font-mono text-xs'} />
          </div>
        </>
      )}

      {/* ── tools-invoke: Tool Name ───────────────────────────────────────── */}
      {connectionType === 'tools-invoke' && (
        <div>
          <label className={LABEL_CLASS}>Tool Name</label>
          <input type="text" value={toolName} onChange={(e) => setToolName(e.target.value)}
            placeholder="run" className={INPUT_CLASS + ' font-mono text-xs'} />
        </div>
      )}

      {/* ── webhook: path + token ─────────────────────────────────────────── */}
      {connectionType === 'webhook' && (
        <>
          <InfoBox variant="yellow">
            Requires <code className="bg-white/10 px-1 rounded">hooks.enabled=true</code> and{' '}
            <code className="bg-white/10 px-1 rounded">hooks.token</code> in OpenClaw config.
          </InfoBox>
          <div>
            <label className={LABEL_CLASS}>Webhook Path</label>
            <input type="text" value={webhookPath} onChange={(e) => setWebhookPath(e.target.value)}
              placeholder="/hooks/agenthub" className={INPUT_CLASS + ' font-mono text-xs'} />
          </div>
          <div>
            <label className={LABEL_CLASS}>Webhook Token <span className="text-slate-600 font-normal">(hooks.token)</span></label>
            <input type="password" value={webhookToken} onChange={(e) => setWebhookToken(e.target.value)}
              placeholder="your-hooks-token" className={INPUT_CLASS} />
          </div>
        </>
      )}

      {/* ── cli: Agent ID ─────────────────────────────────────────────────── */}
      {connectionType === 'cli' && (
        <>
          <InfoBox variant="yellow">
            Requires <code className="bg-white/10 px-1 rounded">openclaw</code> CLI installed on the
            same machine as AgentHub.
          </InfoBox>
          <div>
            <label className={LABEL_CLASS}>OpenClaw Agent ID <span className="text-slate-600 font-normal">(optional)</span></label>
            <input type="text" value={ocAgentId} onChange={(e) => setOcAgentId(e.target.value)}
              placeholder="agent-uuid" className={INPUT_CLASS + ' font-mono text-xs'} />
            <p className="text-[10px] text-slate-600 mt-1">
              Runs: <code className="font-mono">openclaw agent --agent &lt;id&gt; --prompt "..."</code>
            </p>
          </div>
        </>
      )}

      {/* ── System Prompt ─────────────────────────────────────────────────── */}
      <div>
        <label className={LABEL_CLASS}>System Prompt <span className="text-slate-600 font-normal">(optional, wird dem Task vorangestellt)</span></label>
        <textarea value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)}
          rows={2} className={INPUT_CLASS + ' resize-y'}
          placeholder="Du bist ein hilfreicher Assistent..." />
      </div>

      {/* ── Test Connection (health check) ─────────────────────────────────── */}
      {connectionType !== 'cli' && (
        <div className="flex items-center gap-3">
          <button type="button" onClick={handleTest} disabled={testStatus === 'testing'}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white/5 hover:bg-white/10 border border-dark-border text-slate-300 rounded-lg transition-colors disabled:opacity-50">
            {testStatus === 'testing' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Globe className="w-3.5 h-3.5" />}
            Test Gateway
          </button>
          {testStatus === 'ok'    && <span className="flex items-center gap-1 text-xs text-green-400"><CheckCircle className="w-3.5 h-3.5" />{testMsg}</span>}
          {testStatus === 'error' && <span className="flex items-center gap-1 text-xs text-red-400"><AlertCircle className="w-3.5 h-3.5" />{testMsg}</span>}
        </div>
      )}

      {/* ── Onboarding Files (BOOTSTRAP / SOUL / HEARTBEAT / Hub Prompt) ─── */}
      <div className="border border-accent-purple/40 rounded-xl p-4 space-y-3 bg-accent-purple/5">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-slate-100 flex items-center gap-1.5">
              <Plug className="w-4 h-4 text-accent-purple" />
              Onboarding Files
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              Load these files into your OpenClaw agent workspace. Connection mode: <strong className="text-slate-200">{connectionType}</strong>
            </p>
          </div>
          <button type="button" onClick={handleGenerateDocs} disabled={docsLoading || !agentId}
            title={!agentId ? 'Save agent first' : 'Regenerate files'}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-accent-purple hover:bg-purple-600 disabled:bg-dark-border disabled:text-slate-500 text-white rounded-lg transition-colors shrink-0">
            {docsLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileText className="w-3.5 h-3.5" />}
            {docsLoading ? 'Loading...' : bootstrapMd ? 'Refresh' : 'Generate'}
          </button>
        </div>

        {/* Not-saved hint */}
        {!agentId && (
          <InfoBox variant="yellow">
            Save the agent first — BOOTSTRAP.md, SOUL.md, and HEARTBEAT.md will be generated automatically.
          </InfoBox>
        )}

        {/* Loading spinner */}
        {docsLoading && (
          <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
            <Loader2 className="w-4 h-4 animate-spin text-accent-purple" />
            Generating onboarding files...
          </div>
        )}

        {/* Error */}
        {docsError && !docsLoading && (
          <div className="text-xs text-red-400 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />{docsError}
          </div>
        )}

        {/* Tabs + Content */}
        {(bootstrapMd || soulMd || hubPrompt) && !docsLoading && (
          <div className="space-y-2">
            {/* Tab Bar */}
            <div className="flex gap-1.5 flex-wrap border-b border-dark-border pb-2">
              {[
                { key: 'bootstrap', label: '📦 BOOTSTRAP.md', hint: 'One-time onboarding file — agent reads it on first start, then delete' },
                { key: 'soul',      label: '🌟 SOUL.md',       hint: 'Identity file — loaded on every session' },
                { key: 'heartbeat', label: '💓 HEARTBEAT.md',  hint: 'Protocol: How AgentHub calls this agent' },
                { key: 'prompt',    label: '🔌 Hub Prompt',    hint: 'Insert into OpenClaw system config or prepend to SOUL.md' },
              ].map((tab) => {
                const hasContent = tab.key === 'soul' ? !!soulMd : tab.key === 'heartbeat' ? !!heartbeatMd : tab.key === 'bootstrap' ? !!bootstrapMd : !!hubPrompt
                if (!hasContent) return null
                return (
                  <button key={tab.key} type="button" title={tab.hint}
                    onClick={() => setActiveDoc(tab.key as any)}
                    className={`text-xs px-2.5 py-1.5 rounded-lg border font-medium transition-colors ${
                      activeDoc === tab.key
                        ? 'border-accent-purple/60 bg-accent-purple/25 text-purple-300'
                        : 'border-dark-border text-slate-400 hover:border-slate-500 hover:text-slate-200'
                    }`}>
                    {tab.label}
                  </button>
                )
              })}
            </div>

            {/* Viewer */}
            <div className="relative group">
              <pre className="text-xs text-slate-300 bg-dark-bg border border-dark-border rounded-lg p-3 pr-20 overflow-auto max-h-64 font-mono whitespace-pre-wrap leading-relaxed">
                {activeContent}
              </pre>
              {/* Action buttons — always visible, not just on hover */}
              <div className="absolute top-2 right-2 flex flex-col gap-1">
                <button type="button" onClick={() => activeContent && handleCopy(activeContent)}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold bg-accent-purple hover:bg-purple-600 text-white rounded-lg transition-colors shadow">
                  <Copy className="w-3.5 h-3.5" />{copied ? '✓ Copied' : 'Copy'}
                </button>
                <button type="button" onClick={() => activeContent && handleDownload(activeContent, activeFilename)}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-dark-sidebar border border-dark-border rounded-lg text-slate-300 hover:text-slate-100 hover:border-slate-500 transition-colors">
                  <Download className="w-3.5 h-3.5" />Download
                </button>
              </div>
            </div>

            {/* Context hint */}
            <p className="text-[11px] text-slate-500">
              {activeDoc === 'bootstrap'
                ? '→ Place in OpenClaw workspace: ~/.openclaw/agents/<name>/BOOTSTRAP.md — read on first start, then delete (rm BOOTSTRAP.md)'
                : activeDoc === 'soul'
                ? '→ Place in OpenClaw workspace: ~/.openclaw/agents/<name>/SOUL.md — loaded automatically on every session'
                : activeDoc === 'heartbeat'
                ? '→ Place in OpenClaw workspace: ~/.openclaw/agents/<name>/HEARTBEAT.md — shows the agent how AgentHub calls it'
                : '→ Insert into OpenClaw system configuration or prepend to SOUL.md'}
            </p>
          </div>
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

// ─── MCP Config ───────────────────────────────────────────────────────────────

function McpConfig({
  config,
  onChange,
}: {
  config: Record<string, unknown>
  onChange: (c: Record<string, unknown>) => void
}) {
  const [transport, setTransport] = useState<'http' | 'stdio'>((config.transport as any) || 'http')
  const [endpoint, setEndpoint] = useState((config.endpoint as string) || '')
  const [token, setToken] = useState((config.token as string) || '')
  const [command, setCommand] = useState((config.command as string) || '')
  const [toolName, setToolName] = useState((config.toolName as string) || 'run')
  const [argsTemplate, setArgsTemplate] = useState(
    config.arguments ? JSON.stringify(config.arguments, null, 2) : ''
  )
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle')
  const [testMsg, setTestMsg] = useState('')

  useEffect(() => {
    const c: Record<string, unknown> = { transport, toolName }
    if (transport === 'http') {
      if (endpoint) c.endpoint = endpoint
      if (token) c.token = token
    } else {
      if (command) c.command = command
    }
    if (argsTemplate.trim()) {
      try {
        c.arguments = JSON.parse(argsTemplate)
      } catch {
        // invalid JSON — don't include
      }
    }
    onChange(c)
  }, [transport, endpoint, token, command, toolName, argsTemplate])

  const handleTest = async () => {
    if (transport !== 'http' || !endpoint.trim()) {
      setTestStatus('error')
      setTestMsg('Test only available for HTTP transport — enter an endpoint URL first')
      return
    }
    setTestStatus('testing')
    setTestMsg('')
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (token) headers['Authorization'] = `Bearer ${token}`
      const body = {
        jsonrpc: '2.0',
        id: '1',
        method: 'tools/list',
        params: {},
      }
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      })
      const data = await resp.json()
      const tools: any[] = data?.result?.tools || []
      if (tools.length > 0) {
        setTestStatus('ok')
        setTestMsg(`Connected — ${tools.length} tool${tools.length !== 1 ? 's' : ''}: ${tools.slice(0, 3).map((t: any) => t.name).join(', ')}${tools.length > 3 ? '…' : ''}`)
      } else {
        setTestStatus('ok')
        setTestMsg('Connected (no tools listed)')
      }
    } catch (err: any) {
      setTestStatus('error')
      setTestMsg(err.message || 'Connection failed')
    }
  }

  return (
    <div className="space-y-3">
      <InfoBox>
        MCP (Model Context Protocol) is Anthropic's standard for connecting AI to tools and data sources.{' '}
        <a
          href="https://modelcontextprotocol.io"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:opacity-80"
        >
          modelcontextprotocol.io
        </a>
      </InfoBox>
      <div>
        <label className={LABEL_CLASS}>Transport</label>
        <div className="flex gap-2">
          {(['http', 'stdio'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTransport(t)}
              className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-all ${
                transport === t
                  ? 'border-accent-purple bg-accent-purple/10 text-white'
                  : 'border-dark-border bg-dark-bg text-slate-400 hover:border-slate-500'
              }`}
            >
              {t === 'http' ? '🌐 HTTP / SSE' : '💻 stdio'}
            </button>
          ))}
        </div>
      </div>
      {transport === 'http' ? (
        <>
          <div>
            <label className={LABEL_CLASS}>Endpoint URL</label>
            <input
              type="url"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="http://localhost:3001/mcp"
              className={INPUT_CLASS}
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
        </>
      ) : (
        <div>
          <label className={LABEL_CLASS}>Command</label>
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="npx -y @modelcontextprotocol/server-filesystem /tmp"
            className={INPUT_CLASS + ' font-mono text-xs'}
          />
        </div>
      )}
      <div>
        <label className={LABEL_CLASS}>Tool Name</label>
        <input
          type="text"
          value={toolName}
          onChange={(e) => setToolName(e.target.value)}
          placeholder="run"
          className={INPUT_CLASS + ' font-mono text-xs'}
        />
      </div>
      <div>
        <label className={LABEL_CLASS}>Arguments Template (JSON, optional)</label>
        <textarea
          value={argsTemplate}
          onChange={(e) => setArgsTemplate(e.target.value)}
          rows={3}
          className={INPUT_CLASS + ' font-mono text-xs resize-y'}
          placeholder='{"path": "/tmp/file.txt"}'
        />
      </div>
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={handleTest}
          disabled={testStatus === 'testing'}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white/5 hover:bg-white/10 border border-dark-border text-slate-300 rounded-lg transition-colors disabled:opacity-50"
        >
          {testStatus === 'testing' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Plug className="w-3.5 h-3.5" />
          )}
          Test MCP Connection
        </button>
        {testStatus === 'ok' && (
          <span className="flex items-center gap-1 text-xs text-green-400">
            <CheckCircle className="w-3.5 h-3.5" />
            {testMsg}
          </span>
        )}
        {testStatus === 'error' && (
          <span className="flex items-center gap-1 text-xs text-red-400 max-w-xs">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            {testMsg}
          </span>
        )}
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
  const [showTypePicker, setShowTypePicker] = useState(!agent)

  const handlePresetSelect = (preset: AgentPreset) => {
    setType(preset.type as AgentType)
    setTypeConfig(preset.defaultConfig)
    if (!name) setName(preset.name)
    if (!description) setDescription(preset.description)
    setShowPresets(false)
    setShowTypePicker(false)
  }

  const handleTypeChange = (newType: AgentType) => {
    setType(newType)
    setTypeConfig({})
    setShowTypePicker(false)
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
      case 'http':        return <HttpConfig config={typeConfig} onChange={setTypeConfig} />
      case 'claude':      return <ClaudeConfig config={typeConfig} onChange={setTypeConfig} />
      case 'openai':      return <OpenAIConfig config={typeConfig} onChange={setTypeConfig} />
      case 'internal':    return <InternalConfig config={typeConfig} onChange={setTypeConfig} />
      case 'bash':        return <BashConfig config={typeConfig} onChange={setTypeConfig} />
      case 'claude-code': return <ClaudeCodeConfig config={typeConfig} onChange={setTypeConfig} agentId={agent?.id} />
      case 'openai-codex':return <OpenAICodexConfig config={typeConfig} onChange={setTypeConfig} agentId={agent?.id} />
      case 'cursor':      return <CursorConfig config={typeConfig} onChange={setTypeConfig} />
      case 'openclaw':    return <OpenClawConfig config={typeConfig} onChange={setTypeConfig} agentId={agent?.id} />
      case 'a2a':         return <A2AConfig config={typeConfig} onChange={setTypeConfig} />
      case 'mcp':         return <McpConfig config={typeConfig} onChange={setTypeConfig} />
      default:            return null
    }
  }

  // Derive current type display info
  const currentTypeInfo = TYPE_OPTIONS.find((o) => o.value === type)

  return (
    <>
      {showPresets && (
        <PresetPicker onSelect={handlePresetSelect} onClose={() => setShowPresets(false)} />
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
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

        {/* Type selector section */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className={LABEL_CLASS + ' mb-0'}>Type *</label>
            <button
              type="button"
              onClick={() => setShowTypePicker(!showTypePicker)}
              className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1 transition-colors"
            >
              {showTypePicker ? (
                <>
                  <ChevronDown className="w-3 h-3" />
                  Collapse
                </>
              ) : (
                <>
                  <ChevronRight className="w-3 h-3" />
                  Change type
                </>
              )}
            </button>
          </div>

          {/* Current type badge (shown when picker is collapsed) */}
          {!showTypePicker && currentTypeInfo && (
            <div
              className="flex items-center gap-2 p-2.5 rounded-lg border border-accent-purple/40 bg-accent-purple/5 cursor-pointer"
              onClick={() => setShowTypePicker(true)}
            >
              <span className="text-xl leading-none">{currentTypeInfo.icon}</span>
              <div>
                <p className="text-sm font-semibold text-white">{currentTypeInfo.label}</p>
                <p className="text-xs text-slate-500">{currentTypeInfo.desc}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-600 ml-auto" />
            </div>
          )}

          {/* Grouped visual picker */}
          {showTypePicker && (
            <div className="p-3 rounded-xl border border-dark-border bg-dark-bg/50">
              <GroupedTypePicker value={type} onChange={handleTypeChange} />
            </div>
          )}
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
