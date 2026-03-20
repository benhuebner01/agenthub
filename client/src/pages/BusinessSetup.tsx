import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  Building2,
  Sparkles,
  ChevronRight,
  ChevronDown,
  Plus,
  Trash2,
  CheckCircle,
  Loader2,
  ArrowLeft,
  Search,
  X,
  Wand2,
  Edit3,
} from 'lucide-react'
import { analyzeBusiness, createBusiness, getPresets, BusinessAnalysisInput, AgentType, AgentRole, AgentPreset } from '../api/client'
import { useToast } from '../components/Toaster'

const INDUSTRIES = [
  'Technology', 'Marketing', 'E-commerce', 'Finance', 'Healthcare',
  'Education', 'Media & Content', 'Consulting', 'Real Estate', 'Other',
]

const ROLE_COLORS: Record<string, string> = {
  ceo: 'border-yellow-500/40 bg-yellow-500/5',
  manager: 'border-purple-500/40 bg-purple-500/5',
  worker: 'border-blue-500/40 bg-blue-500/5',
  specialist: 'border-green-500/40 bg-green-500/5',
}

const ROLE_BADGE: Record<string, string> = {
  ceo: 'bg-yellow-500/20 text-yellow-300',
  manager: 'bg-purple-500/20 text-purple-300',
  worker: 'bg-blue-500/20 text-blue-300',
  specialist: 'bg-green-500/20 text-green-300',
}

type PresetCategory = 'local' | 'ai-api' | 'http' | 'automation' | 'mcp' | 'bash'

const CATEGORY_META: Record<PresetCategory, { label: string; icon: string }> = {
  local:      { label: 'Local Agents',        icon: '🖥️' },
  'ai-api':   { label: 'AI APIs',              icon: '🧠' },
  http:       { label: 'HTTP & Protocols',     icon: '🌐' },
  automation: { label: 'Automation Platforms', icon: '⚙️' },
  mcp:        { label: 'MCP Servers',          icon: '🔌' },
  bash:       { label: 'Scripts & Shell',      icon: '💻' },
}

const CATEGORY_ORDER: PresetCategory[] = ['local', 'ai-api', 'http', 'automation', 'mcp', 'bash']

// Quick recommended alternatives for connection picker
const QUICK_ALTERNATIVES: { label: string; type: AgentType; model?: string }[] = [
  { label: 'Claude Sonnet', type: 'claude', model: 'claude-sonnet-4-6' },
  { label: 'Claude Haiku', type: 'claude', model: 'claude-haiku-4-5' },
  { label: 'GPT-5.2', type: 'openai', model: 'gpt-5.2' },
  { label: 'GPT-5 Mini', type: 'openai', model: 'gpt-5-mini' },
  { label: 'GPT-5 Nano', type: 'openai', model: 'gpt-5-nano' },
  { label: 'Internal', type: 'internal' },
  { label: 'HTTP Webhook', type: 'http' },
  { label: 'Bash Script', type: 'bash' },
]

type Step = 0 | 1 | 2 | 3 | 4 | 5

interface AnalysisResult {
  organization: { name: string; description: string; industry: string; goals: string[] }
  ceoAgent: { name: string; description: string; type: AgentType; config: Record<string, unknown>; jobDescription: string }
  proposedTeam: Array<{
    name: string; role: AgentRole; description: string; type: AgentType
    config: Record<string, unknown>; jobDescription: string; reportsTo: string
  }>
  reasoning: string
  estimatedMonthlyCostUsd: number
  costBreakdown?: Array<{ agentName: string; model: string; estimatedCallsPerMonth: number; estimatedCostUsd: number }>
  alternatives?: Array<{ description: string; estimatedMonthlyCostUsd: number; tradeoff: string }>
  recommendation: string
}

// ─── All Presets Modal ────────────────────────────────────────────────────────

function AllPresetsModal({
  presets,
  onSelect,
  onClose,
}: {
  presets: AgentPreset[]
  onSelect: (preset: AgentPreset) => void
  onClose: () => void
}) {
  const [search, setSearch] = useState('')

  const filtered = search.trim()
    ? presets.filter(p => p.name.toLowerCase().includes(search.toLowerCase()) || p.description.toLowerCase().includes(search.toLowerCase()))
    : presets

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-dark-card border border-dark-border rounded-2xl max-w-2xl w-full max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-border">
          <h3 className="text-lg font-bold text-white">All Integrations</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <div className="px-5 py-3 border-b border-dark-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search integrations..."
              className="w-full pl-9 pr-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent-purple/50"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {CATEGORY_ORDER.map(cat => {
            const catPresets = filtered.filter(p => p.category === cat)
            if (catPresets.length === 0) return null
            const meta = CATEGORY_META[cat]
            return (
              <div key={cat}>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <span>{meta.icon}</span> {meta.label}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {catPresets.map(preset => (
                    <button
                      key={preset.id}
                      onClick={() => { onSelect(preset); onClose() }}
                      className="text-left p-3 rounded-lg border border-dark-border bg-dark-bg hover:border-accent-purple/40 hover:bg-accent-purple/5 transition-all"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg">{preset.icon}</span>
                        <span className="text-sm font-medium text-white">{preset.name}</span>
                      </div>
                      <p className="text-xs text-slate-500 line-clamp-2">{preset.description}</p>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
          {filtered.length === 0 && (
            <p className="text-center text-sm text-slate-500 py-8">No integrations found</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Connection Picker ────────────────────────────────────────────────────────

function ConnectionPicker({
  currentType,
  currentModel,
  onSelect,
  presets,
}: {
  currentType: AgentType
  currentModel?: string
  onSelect: (type: AgentType, model?: string, config?: Record<string, unknown>) => void
  presets: AgentPreset[]
}) {
  const [showAll, setShowAll] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const currentLabel = currentModel
    ? `${currentType} (${currentModel})`
    : currentType

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-slate-500">Connection:</span>
        <span className="text-xs font-mono text-accent-purple bg-accent-purple/10 px-2 py-0.5 rounded">{currentLabel}</span>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-slate-400 hover:text-accent-purple flex items-center gap-1 transition-colors"
        >
          Change <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {expanded && (
        <div className="space-y-2 mt-2 p-3 bg-dark-bg rounded-lg border border-dark-border">
          <p className="text-xs text-slate-500 font-medium mb-1">Quick alternatives:</p>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_ALTERNATIVES.map((alt, i) => {
              const isActive = alt.type === currentType && (alt.model || '') === (currentModel || '')
              return (
                <button
                  key={i}
                  onClick={() => {
                    onSelect(alt.type, alt.model, alt.model ? { model: alt.model } : {})
                    setExpanded(false)
                  }}
                  className={`text-xs px-2.5 py-1.5 rounded-md border transition-colors ${
                    isActive
                      ? 'bg-accent-purple/20 border-accent-purple/40 text-accent-purple'
                      : 'bg-dark-card border-dark-border text-slate-400 hover:border-accent-purple/30 hover:text-slate-200'
                  }`}
                >
                  {alt.label}
                </button>
              )
            })}
          </div>
          <button
            onClick={() => setShowAll(true)}
            className="text-xs text-slate-400 hover:text-accent-purple transition-colors mt-1"
          >
            See All Integrations...
          </button>
        </div>
      )}

      {showAll && (
        <AllPresetsModal
          presets={presets}
          onSelect={(preset) => {
            onSelect(preset.type as AgentType, preset.defaultConfig?.model, preset.defaultConfig)
            setExpanded(false)
          }}
          onClose={() => setShowAll(false)}
        />
      )}
    </div>
  )
}

// ─── Agent Card ───────────────────────────────────────────────────────────────

function AgentCard({
  agent,
  isCeo,
  presets,
  onUpdate,
  onRemove,
}: {
  agent: { name: string; type: AgentType; config: Record<string, unknown>; jobDescription: string; role?: string; description?: string }
  isCeo?: boolean
  presets: AgentPreset[]
  onUpdate: (updates: Partial<typeof agent>) => void
  onRemove?: () => void
}) {
  const [editingPrompt, setEditingPrompt] = useState(false)
  const role = isCeo ? 'ceo' : (agent.role || 'worker')
  const systemPrompt = (agent.config?.system_prompt as string) || (agent.config?.systemPrompt as string) || ''

  return (
    <div className={`rounded-xl border-2 p-4 ${ROLE_COLORS[role] || ROLE_COLORS.worker}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-0.5 rounded font-medium ${ROLE_BADGE[role] || ROLE_BADGE.worker}`}>
            {role}
          </span>
        </div>
        {onRemove && (
          <button onClick={onRemove} className="text-slate-500 hover:text-red-400 transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Name */}
      <div className="mb-3">
        <label className="text-xs text-slate-500 mb-1 block">Name</label>
        <input
          value={agent.name}
          onChange={e => onUpdate({ name: e.target.value })}
          className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-sm text-slate-200 focus:outline-none focus:border-accent-purple/50"
        />
      </div>

      {/* Connection Picker */}
      <ConnectionPicker
        currentType={agent.type}
        currentModel={agent.config?.model as string}
        presets={presets}
        onSelect={(type, model, config) => {
          const newConfig = { ...agent.config, ...config }
          if (model) newConfig.model = model
          onUpdate({ type, config: newConfig })
        }}
      />

      {/* Job Description */}
      {agent.jobDescription && (
        <div className="mt-3">
          <label className="text-xs text-slate-500 mb-1 block">Job Description</label>
          <input
            value={agent.jobDescription}
            onChange={e => onUpdate({ jobDescription: e.target.value })}
            className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-xs text-slate-300 focus:outline-none focus:border-accent-purple/50"
          />
        </div>
      )}

      {/* System Prompt toggle */}
      <div className="mt-3">
        <button
          onClick={() => setEditingPrompt(!editingPrompt)}
          className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1 transition-colors"
        >
          <Edit3 className="w-3 h-3" />
          {editingPrompt ? 'Hide' : 'Edit'} System Prompt
        </button>
        {editingPrompt && (
          <textarea
            value={systemPrompt}
            onChange={e => onUpdate({ config: { ...agent.config, system_prompt: e.target.value } })}
            className="w-full mt-2 px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-xs text-slate-300 resize-none focus:outline-none focus:border-accent-purple/50"
            rows={3}
            placeholder="System prompt for this agent..."
          />
        )}
      </div>
    </div>
  )
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function BusinessSetup() {
  const navigate = useNavigate()
  const toast = useToast()
  const [step, setStep] = useState<Step>(0)

  // Step 1 form data
  const [companyName, setCompanyName] = useState('')
  const [industry, setIndustry] = useState('')
  const [description, setDescription] = useState('')
  const [goals, setGoals] = useState<string[]>([''])

  // Analysis result
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null)

  // Customizable team (editable copy of analysis result)
  const [editableCeo, setEditableCeo] = useState<AnalysisResult['ceoAgent'] | null>(null)
  const [editableTeam, setEditableTeam] = useState<AnalysisResult['proposedTeam']>([])

  // Progress steps
  const [creationProgress, setCreationProgress] = useState<string[]>([])

  // Load presets for connection picker
  const { data: presetsData } = useQuery({
    queryKey: ['presets'],
    queryFn: getPresets,
  })
  const presets = presetsData?.data ?? []

  const analyzeMutation = useMutation({
    mutationFn: (data: BusinessAnalysisInput) => analyzeBusiness(data),
    onSuccess: (data) => {
      setAnalysisResult(data.data)
      setEditableCeo(data.data.ceoAgent)
      setEditableTeam(data.data.proposedTeam || [])
      setStep(2)
    },
    onError: (err: Error) => {
      toast.error(`Analysis failed: ${err.message}`)
      setStep(1)
    },
  })

  const createMutation = useMutation({
    mutationFn: () => {
      if (!analysisResult || !editableCeo) throw new Error('No analysis data')
      return createBusiness({
        organizationData: analysisResult.organization,
        ceoConfig: editableCeo,
        teamConfigs: editableTeam,
      })
    },
    onSuccess: () => {
      setStep(5)
    },
    onError: (err: Error) => {
      toast.error(`Creation failed: ${err.message}`)
      setStep(3)
    },
  })

  const handleAnalyze = () => {
    const validGoals = goals.filter((g) => g.trim().length > 0)
    if (!companyName.trim() || !description.trim()) {
      toast.error('Please fill in company name and description')
      return
    }
    setStep(2)
    analyzeMutation.mutate({
      name: companyName,
      description,
      industry,
      goals: validGoals,
    })
  }

  const handleCreate = async () => {
    setStep(4)
    setCreationProgress(['Creating CEO agent...'])
    setTimeout(() => setCreationProgress((p) => [...p, 'Creating team agents...']), 800)
    setTimeout(() => setCreationProgress((p) => [...p, 'Setting up hierarchy...']), 1600)
    createMutation.mutate()
  }

  const addGoal = () => setGoals((g) => [...g, ''])
  const removeGoal = (i: number) => setGoals((g) => g.filter((_, idx) => idx !== i))
  const updateGoal = (i: number, val: string) => setGoals((g) => g.map((x, idx) => idx === i ? val : x))

  // ─── Step 0: Welcome ──────────────────────────────────────────────────────

  if (step === 0) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="text-center py-16 space-y-6">
          <div className="w-20 h-20 bg-accent-purple/20 rounded-2xl flex items-center justify-center mx-auto border border-accent-purple/30">
            <Building2 className="w-10 h-10 text-accent-purple" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white mb-3">Set Up Your AI Business</h1>
            <p className="text-slate-400 text-lg">
              We'll create a CEO agent and a full team tailored to your needs.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
            {[
              { icon: '🤖', title: 'AI CEO', desc: 'A strategic agent that manages your team and makes proposals' },
              { icon: '👥', title: 'Full Team', desc: 'Specialized agents for each business function' },
              { icon: '📋', title: 'Proposals', desc: 'CEO automatically proposes improvements and new hires' },
            ].map((item) => (
              <div key={item.title} className="bg-dark-card border border-dark-border rounded-xl p-4">
                <div className="text-2xl mb-2">{item.icon}</div>
                <p className="text-sm font-semibold text-white mb-1">{item.title}</p>
                <p className="text-xs text-slate-500">{item.desc}</p>
              </div>
            ))}
          </div>
          <button
            onClick={() => setStep(1)}
            className="flex items-center gap-2 px-8 py-3.5 bg-accent-purple hover:bg-purple-600 text-white font-semibold rounded-xl transition-colors mx-auto"
          >
            Get Started
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    )
  }

  // ─── Step 1: Business Info ──────────────────────────────────────────────────

  if (step === 1) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <button onClick={() => setStep(0)} className="text-slate-400 hover:text-slate-200">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white">Describe Your Business</h1>
            <p className="text-sm text-slate-400">Tell us about your company so we can design the right team</p>
          </div>
        </div>

        <div className="bg-dark-card border border-dark-border rounded-xl p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Company Name *</label>
            <input
              type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Acme Corp"
              className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-xl text-slate-200 placeholder-slate-600 text-sm focus:outline-none focus:border-accent-purple/50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Industry</label>
            <select
              value={industry} onChange={(e) => setIndustry(e.target.value)}
              className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-xl text-slate-200 text-sm focus:outline-none focus:border-accent-purple/50"
            >
              <option value="">Select industry...</option>
              {INDUSTRIES.map((ind) => <option key={ind} value={ind}>{ind}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Description *</label>
            <textarea
              value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="What does your company do? What problems do you solve?"
              className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-xl text-slate-200 placeholder-slate-600 text-sm resize-none focus:outline-none focus:border-accent-purple/50"
              rows={4}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Goals <span className="text-slate-500 font-normal">(What should your AI company achieve?)</span>
            </label>
            <div className="space-y-2">
              {goals.map((goal, i) => (
                <div key={i} className="flex gap-2">
                  <input type="text" value={goal} onChange={(e) => updateGoal(i, e.target.value)}
                    placeholder={`Goal ${i + 1}...`}
                    className="flex-1 px-4 py-2.5 bg-dark-bg border border-dark-border rounded-xl text-slate-200 placeholder-slate-600 text-sm focus:outline-none focus:border-accent-purple/50"
                  />
                  {goals.length > 1 && (
                    <button onClick={() => removeGoal(i)} className="p-2.5 text-slate-500 hover:text-red-400 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
              <button onClick={addGoal} className="flex items-center gap-2 text-sm text-slate-400 hover:text-accent-purple transition-colors">
                <Plus className="w-4 h-4" /> Add goal
              </button>
            </div>
          </div>
        </div>

        <button onClick={handleAnalyze}
          className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-accent-purple hover:bg-purple-600 text-white font-semibold rounded-xl transition-colors">
          <Sparkles className="w-5 h-5" /> Analyze with AI <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    )
  }

  // ─── Step 2: Analysis Results ───────────────────────────────────────────────

  if (step === 2) {
    if (analyzeMutation.isPending) {
      return (
        <div className="max-w-2xl mx-auto">
          <div className="flex flex-col items-center justify-center py-20 space-y-6">
            <div className="w-16 h-16 bg-accent-purple/20 rounded-2xl flex items-center justify-center border border-accent-purple/30 animate-pulse">
              <Sparkles className="w-8 h-8 text-accent-purple" />
            </div>
            <div className="text-center">
              <h2 className="text-xl font-bold text-white mb-2">Analyzing your business...</h2>
              <p className="text-slate-400 text-sm">AI is designing your optimal team structure</p>
            </div>
            <div className="flex flex-col items-center gap-2 text-sm text-slate-500">
              {['Analyzing business model', 'Designing org structure', 'Selecting agent types', 'Calculating costs'].map((s, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> {s}
                </div>
              ))}
            </div>
          </div>
        </div>
      )
    }

    if (!analysisResult) return null

    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <button onClick={() => setStep(1)} className="text-slate-400 hover:text-slate-200">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white">Your AI Team</h1>
            <p className="text-sm text-slate-400">Review the proposed organization</p>
          </div>
        </div>

        {/* Reasoning */}
        <div className="bg-dark-card border border-dark-border rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-2">AI Analysis</h3>
          <p className="text-sm text-slate-400">{analysisResult.reasoning}</p>
        </div>

        {/* CEO Card */}
        <div>
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">CEO Agent</p>
          <div className={`rounded-xl border-2 p-5 ${ROLE_COLORS.ceo}`}>
            <div className="flex items-start justify-between">
              <div>
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${ROLE_BADGE.ceo}`}>CEO</span>
                <p className="text-lg font-bold text-white mt-1">{analysisResult.ceoAgent.name}</p>
                <p className="text-sm text-slate-400 mt-0.5">{analysisResult.ceoAgent.description}</p>
              </div>
              <span className="text-xs text-slate-500 font-mono bg-dark-bg px-2 py-1 rounded">
                {analysisResult.ceoAgent.type}
                {analysisResult.ceoAgent.config?.model && ` (${analysisResult.ceoAgent.config.model})`}
              </span>
            </div>
            {analysisResult.ceoAgent.jobDescription && (
              <p className="text-xs text-slate-500 mt-3 border-t border-dark-border pt-3">{analysisResult.ceoAgent.jobDescription}</p>
            )}
          </div>
        </div>

        {/* Team Cards */}
        <div>
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">
            Team Agents ({analysisResult.proposedTeam?.length || 0})
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(analysisResult.proposedTeam || []).map((agent, i) => (
              <div key={i} className={`rounded-xl border p-4 ${ROLE_COLORS[agent.role] || ROLE_COLORS.worker}`}>
                <div className="flex items-start justify-between mb-2">
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${ROLE_BADGE[agent.role] || ROLE_BADGE.worker}`}>{agent.role}</span>
                  <span className="text-xs text-slate-500 font-mono">
                    {agent.type}{agent.config?.model ? ` (${agent.config.model})` : ''}
                  </span>
                </div>
                <p className="text-sm font-bold text-white">{agent.name}</p>
                <p className="text-xs text-slate-400 mt-0.5">{agent.description}</p>
                {agent.jobDescription && <p className="text-xs text-slate-600 mt-2 line-clamp-2">{agent.jobDescription}</p>}
              </div>
            ))}
          </div>
        </div>

        {/* Cost Breakdown */}
        {analysisResult.costBreakdown && analysisResult.costBreakdown.length > 0 && (
          <div className="bg-dark-card border border-dark-border rounded-xl p-5">
            <h3 className="text-sm font-semibold text-white mb-3">Cost Breakdown</h3>
            <div className="space-y-2">
              {analysisResult.costBreakdown.map((cb, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <div className="text-slate-400">
                    <span className="text-slate-200 font-medium">{cb.agentName}</span>
                    <span className="text-slate-600 ml-2">{cb.model} ~ {cb.estimatedCallsPerMonth} calls/mo</span>
                  </div>
                  <span className="text-green-400 font-mono">${cb.estimatedCostUsd.toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Alternatives */}
        {analysisResult.alternatives && analysisResult.alternatives.length > 0 && (
          <div className="bg-dark-card border border-dark-border rounded-xl p-5">
            <h3 className="text-sm font-semibold text-white mb-3">Alternative Configurations</h3>
            <div className="space-y-3">
              {analysisResult.alternatives.map((alt, i) => (
                <div key={i} className="border border-dark-border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs text-slate-300">{alt.description}</p>
                    <span className="text-xs font-mono text-green-400">${alt.estimatedMonthlyCostUsd.toFixed(2)}/mo</span>
                  </div>
                  <p className="text-xs text-slate-600">{alt.tradeoff}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Total Cost */}
        <div className="bg-dark-card border border-dark-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white">Estimated Monthly Cost</h3>
            <span className="text-lg font-bold text-green-400">~${(analysisResult.estimatedMonthlyCostUsd || 0).toFixed(2)}/month</span>
          </div>
          {analysisResult.recommendation && <p className="text-sm text-slate-400">{analysisResult.recommendation}</p>}
        </div>

        <div className="flex gap-3">
          <button onClick={() => setStep(3)}
            className="flex-1 flex items-center justify-center gap-2 px-6 py-3.5 bg-accent-purple hover:bg-purple-600 text-white font-semibold rounded-xl transition-colors">
            <Edit3 className="w-5 h-5" /> Customize & Choose Connections
          </button>
          <button onClick={handleCreate}
            className="px-6 py-3.5 bg-white/5 hover:bg-white/10 text-slate-300 font-medium rounded-xl border border-dark-border transition-colors">
            <div className="flex items-center gap-2">
              <Wand2 className="w-4 h-4" /> Let AI Decide
            </div>
          </button>
        </div>
      </div>
    )
  }

  // ─── Step 3: Customize with Connection Picker ───────────────────────────────

  if (step === 3) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <button onClick={() => setStep(2)} className="text-slate-400 hover:text-slate-200">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white">Customize Team</h1>
            <p className="text-sm text-slate-400">Choose connections and modify agents before creating</p>
          </div>
        </div>

        {/* CEO */}
        {editableCeo && (
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">CEO Agent</p>
            <AgentCard
              agent={editableCeo}
              isCeo
              presets={presets}
              onUpdate={(updates) => setEditableCeo({ ...editableCeo, ...updates } as any)}
            />
          </div>
        )}

        {/* Team */}
        <div>
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Team Agents</p>
          <div className="space-y-3">
            {editableTeam.map((agent, i) => (
              <AgentCard
                key={i}
                agent={agent}
                presets={presets}
                onUpdate={(updates) => setEditableTeam(t => t.map((a, idx) => idx === i ? { ...a, ...updates } as any : a))}
                onRemove={() => setEditableTeam(t => t.filter((_, idx) => idx !== i))}
              />
            ))}
          </div>
        </div>

        {/* Sticky cost footer */}
        <div className="sticky bottom-0 bg-dark-card border border-dark-border rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">Total agents: {1 + editableTeam.length}</span>
            <span className="text-sm font-semibold text-green-400">
              ~${(analysisResult?.estimatedMonthlyCostUsd || 0).toFixed(2)}/month estimated
            </span>
          </div>
        </div>

        <button onClick={handleCreate}
          className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-accent-purple hover:bg-purple-600 text-white font-semibold rounded-xl transition-colors">
          <CheckCircle className="w-5 h-5" /> Create Organization
        </button>
      </div>
    )
  }

  // ─── Step 4: Creating ────────────────────────────────────────────────────────

  if (step === 4) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="flex flex-col items-center justify-center py-20 space-y-6">
          <div className="w-16 h-16 bg-accent-purple/20 rounded-2xl flex items-center justify-center border border-accent-purple/30 animate-pulse">
            <Building2 className="w-8 h-8 text-accent-purple" />
          </div>
          <div className="text-center">
            <h2 className="text-xl font-bold text-white mb-2">Creating your organization...</h2>
            <p className="text-slate-400 text-sm">Setting up agents and hierarchy</p>
          </div>
          <div className="flex flex-col items-start gap-3 text-sm">
            {creationProgress.map((msg, i) => (
              <div key={i} className="flex items-center gap-2 text-green-400">
                <CheckCircle className="w-4 h-4" /> {msg}
              </div>
            ))}
            {createMutation.isPending && (
              <div className="flex items-center gap-2 text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" /> Finalizing...
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ─── Step 5: Done ────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex flex-col items-center justify-center py-20 space-y-6 text-center">
        <div className="w-20 h-20 bg-green-500/20 rounded-2xl flex items-center justify-center border border-green-500/30">
          <CheckCircle className="w-10 h-10 text-green-400" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-white mb-2">Your AI business is ready!</h2>
          <p className="text-slate-400">Your CEO agent and team have been created. Run the CEO to get started.</p>
        </div>
        <div className="flex gap-3">
          <button onClick={() => navigate('/organization')}
            className="flex items-center gap-2 px-6 py-3 bg-accent-purple hover:bg-purple-600 text-white font-semibold rounded-xl transition-colors">
            <Building2 className="w-5 h-5" /> View Org Chart
          </button>
          <button onClick={() => navigate('/agents')}
            className="px-6 py-3 bg-white/5 hover:bg-white/10 text-slate-300 font-medium rounded-xl border border-dark-border transition-colors">
            View Agents
          </button>
        </div>
      </div>
    </div>
  )
}
