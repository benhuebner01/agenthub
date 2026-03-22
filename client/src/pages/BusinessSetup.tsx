import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import {
  Building2,
  Sparkles,
  ChevronRight,
  Plus,
  Trash2,
  CheckCircle,
  Loader2,
  ArrowLeft,
  Users,
  User,
  GitBranch,
} from 'lucide-react'
import { analyzeBusiness, createBusiness, BusinessAnalysisInput, AgentType, AgentRole } from '../api/client'
import { useToast } from '../components/Toaster'

const INDUSTRIES = [
  'Technology',
  'Marketing',
  'E-commerce',
  'Finance',
  'Healthcare',
  'Education',
  'Media & Content',
  'Consulting',
  'Real Estate',
  'Other',
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

const REAL_AGENT_TYPES: AgentType[] = ['claude-code', 'openclaw']
const isRealAgent = (type: AgentType) => REAL_AGENT_TYPES.includes(type) || type === 'openai' || type === 'claude'

type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7

interface AnalysisResult {
  organization: { name: string; description: string; industry: string; goals: string[] }
  ceoAgent: { name: string; description: string; type: AgentType; config: Record<string, unknown>; jobDescription: string }
  proposedTeam: Array<{
    name: string
    role: AgentRole
    description: string
    type: AgentType
    config: Record<string, unknown>
    jobDescription: string
    reportsTo: string
  }>
  reasoning: string
  estimatedMonthlyCostUsd: number
  recommendation: string
}

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

  // Organization mapping state (step 4)
  const [orgMode, setOrgMode] = useState<'full-team' | 'one-agent'>('full-team')
  const [maxRealAgents, setMaxRealAgents] = useState<number | null>(null)
  const [subagentMap, setSubagentMap] = useState<Record<number, number[]>>({})

  // Progress steps
  const [creationProgress, setCreationProgress] = useState<string[]>([])

  const analyzeMutation = useMutation({
    mutationFn: (data: BusinessAnalysisInput) => analyzeBusiness(data),
    onSuccess: (data) => {
      setAnalysisResult(data.data)
      setEditableCeo(data.data.ceoAgent)
      setEditableTeam(data.data.proposedTeam || [])
      setStep(3)
    },
    onError: (err: Error) => {
      toast.error(`Analysis failed: ${err.message}`)
      setStep(1)
    },
  })

  const createMutation = useMutation({
    mutationFn: () => {
      if (!analysisResult || !editableCeo) throw new Error('No analysis data')
      let finalTeam = [...editableTeam]

      // Apply subagent mappings: set reportsTo for internal agents assigned to real agents
      for (const [realIdxStr, internalIdxes] of Object.entries(subagentMap)) {
        const realIdx = Number(realIdxStr)
        const realAgent = editableTeam[realIdx]
        if (realAgent) {
          for (const intIdx of internalIdxes) {
            const intAgent = finalTeam.find((a, i) => i === intIdx)
            if (intAgent) {
              intAgent.reportsTo = realAgent.name
            }
          }
        }
      }

      if (orgMode === 'one-agent') {
        const realAgents = finalTeam.filter((a) => isRealAgent(a.type))
        const internalAgents = finalTeam.filter((a) => a.type === 'internal')
        finalTeam = realAgents.length > 0 ? [realAgents[0], ...internalAgents] : internalAgents
      }
      if (maxRealAgents !== null) {
        let realCount = 0
        finalTeam = finalTeam.filter((a) => {
          if (isRealAgent(a.type)) {
            realCount++
            return realCount <= maxRealAgents
          }
          return true
        })
      }
      return createBusiness({
        organizationData: {
          ...analysisResult.organization,
          orgMode,
          maxRealAgents,
        } as typeof analysisResult.organization,
        ceoConfig: editableCeo,
        teamConfigs: finalTeam,
      })
    },
    onSuccess: () => {
      setStep(7)
    },
    onError: (err: Error) => {
      toast.error(`Creation failed: ${err.message}`)
      setStep(5)
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
    setStep(6)
    setCreationProgress(['Creating CEO agent...'])
    setTimeout(() => setCreationProgress((p) => [...p, 'Creating team agents...']), 800)
    setTimeout(() => setCreationProgress((p) => [...p, 'Setting up hierarchy...']), 1600)
    createMutation.mutate()
  }

  const addGoal = () => setGoals((g) => [...g, ''])
  const removeGoal = (i: number) => setGoals((g) => g.filter((_, idx) => idx !== i))
  const updateGoal = (i: number, val: string) => setGoals((g) => g.map((x, idx) => idx === i ? val : x))

  // Helper: get real agents from editable team
  const getRealAgents = () => editableTeam.filter((a) => isRealAgent(a.type))
  const getInternalAgents = () => editableTeam.filter((a) => a.type === 'internal')

  // ─── Steps ───────────────────────────────────────────────────────────────────

  // Step 0: Intro
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

  // Step 1: Describe business
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
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Acme Corp"
              className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-xl text-slate-200 placeholder-slate-600 text-sm focus:outline-none focus:border-accent-purple/50"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Industry</label>
            <select
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-xl text-slate-200 text-sm focus:outline-none focus:border-accent-purple/50"
            >
              <option value="">Select industry...</option>
              {INDUSTRIES.map((ind) => (
                <option key={ind} value={ind}>{ind}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Description *</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
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
                  <input
                    type="text"
                    value={goal}
                    onChange={(e) => updateGoal(i, e.target.value)}
                    placeholder={`Goal ${i + 1}...`}
                    className="flex-1 px-4 py-2.5 bg-dark-bg border border-dark-border rounded-xl text-slate-200 placeholder-slate-600 text-sm focus:outline-none focus:border-accent-purple/50"
                  />
                  {goals.length > 1 && (
                    <button
                      onClick={() => removeGoal(i)}
                      className="p-2.5 text-slate-500 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
              <button
                onClick={addGoal}
                className="flex items-center gap-2 text-sm text-slate-400 hover:text-accent-purple transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add goal
              </button>
            </div>
          </div>
        </div>

        <button
          onClick={handleAnalyze}
          className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-accent-purple hover:bg-purple-600 text-white font-semibold rounded-xl transition-colors"
        >
          <Sparkles className="w-5 h-5" />
          Analyze with AI
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    )
  }

  // Step 2: Analyzing (spinner)
  if (step === 2) {
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
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {s}
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // Step 3: Review AI analysis result
  if (step === 3) {
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
              </span>
            </div>
            {analysisResult.ceoAgent.jobDescription && (
              <p className="text-xs text-slate-500 mt-3 border-t border-dark-border pt-3">
                {analysisResult.ceoAgent.jobDescription}
              </p>
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
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${ROLE_BADGE[agent.role] || ROLE_BADGE.worker}`}>
                    {agent.role}
                  </span>
                  <span className="text-xs text-slate-500 font-mono">{agent.type}</span>
                </div>
                <p className="text-sm font-bold text-white">{agent.name}</p>
                <p className="text-xs text-slate-400 mt-0.5">{agent.description}</p>
                {agent.jobDescription && (
                  <p className="text-xs text-slate-600 mt-2 line-clamp-2">{agent.jobDescription}</p>
                )}
                {agent.reportsTo && (
                  <p className="text-xs text-slate-600 mt-1">Reports to: {agent.reportsTo}</p>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Cost & Recommendation */}
        <div className="bg-dark-card border border-dark-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-white">Estimated Monthly Cost</h3>
            <span className="text-lg font-bold text-green-400">
              ~${(analysisResult.estimatedMonthlyCostUsd || 0).toFixed(2)}/month
            </span>
          </div>
          {analysisResult.recommendation && (
            <p className="text-sm text-slate-400">{analysisResult.recommendation}</p>
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => setStep(4)}
            className="flex-1 flex items-center justify-center gap-2 px-6 py-3.5 bg-accent-purple hover:bg-purple-600 text-white font-semibold rounded-xl transition-colors"
          >
            <GitBranch className="w-5 h-5" />
            Configure Organization
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    )
  }

  // Step 4: Organization Mapping
  if (step === 4) {
    const realAgents = getRealAgents()
    const internalAgents = getInternalAgents()
    const realAgentCount = realAgents.length

    const toggleSubagent = (realIdx: number, internalIdx: number) => {
      setSubagentMap((prev) => {
        const current = prev[realIdx] || []
        if (current.includes(internalIdx)) {
          return { ...prev, [realIdx]: current.filter((x) => x !== internalIdx) }
        }
        return { ...prev, [realIdx]: [...current, internalIdx] }
      })
    }

    const addNewAgent = () => {
      setEditableTeam((t) => [
        ...t,
        {
          name: 'New Agent',
          role: 'worker' as AgentRole,
          description: '',
          type: 'internal' as AgentType,
          config: {},
          jobDescription: '',
          reportsTo: editableCeo?.name || 'CEO',
        },
      ])
    }

    const removeAgent = (i: number) => {
      setEditableTeam((t) => t.filter((_, idx) => idx !== i))
      // Clean up subagent map references
      setSubagentMap((prev) => {
        const next: Record<number, number[]> = {}
        for (const [k, v] of Object.entries(prev)) {
          next[Number(k)] = v.filter((x) => x !== i).map((x) => (x > i ? x - 1 : x))
        }
        return next
      })
    }

    // In one-agent mode, show only the first real agent + internal agents
    const displayAgents = orgMode === 'one-agent'
      ? editableTeam.filter((a, _i) => {
          if (a.type === 'internal') return true
          if (isRealAgent(a.type)) {
            // Only keep the first real agent
            const firstRealIdx = editableTeam.findIndex((x) => isRealAgent(x.type))
            return editableTeam.indexOf(a) === firstRealIdx
          }
          return false
        })
      : editableTeam

    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <button onClick={() => setStep(3)} className="text-slate-400 hover:text-slate-200">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white">Organization Mapping</h1>
            <p className="text-sm text-slate-400">Configure your organization mode and agent hierarchy</p>
          </div>
        </div>

        {/* Mode Selection */}
        <div>
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">Organization Mode</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <button
              onClick={() => setOrgMode('full-team')}
              className={`rounded-xl border-2 p-5 text-left transition-colors ${
                orgMode === 'full-team'
                  ? 'border-accent-purple bg-accent-purple/10'
                  : 'border-dark-border bg-dark-card hover:border-slate-600'
              }`}
            >
              <div className="flex items-center gap-3 mb-2">
                <Users className={`w-6 h-6 ${orgMode === 'full-team' ? 'text-accent-purple' : 'text-slate-400'}`} />
                <span className={`text-sm font-semibold ${orgMode === 'full-team' ? 'text-white' : 'text-slate-200'}`}>
                  Full Team
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Multiple real coding agents plus internal agents. Each agent works independently with its own capabilities.
              </p>
            </button>
            <button
              onClick={() => setOrgMode('one-agent')}
              className={`rounded-xl border-2 p-5 text-left transition-colors ${
                orgMode === 'one-agent'
                  ? 'border-accent-purple bg-accent-purple/10'
                  : 'border-dark-border bg-dark-card hover:border-slate-600'
              }`}
            >
              <div className="flex items-center gap-3 mb-2">
                <User className={`w-6 h-6 ${orgMode === 'one-agent' ? 'text-accent-purple' : 'text-slate-400'}`} />
                <span className={`text-sm font-semibold ${orgMode === 'one-agent' ? 'text-white' : 'text-slate-200'}`}>
                  One Agent Company
                </span>
              </div>
              <p className="text-xs text-slate-400">
                A single real coding agent with internal agents and sub-agents dedicated to it. Simpler and more focused.
              </p>
            </button>
          </div>
        </div>

        {/* Max Real Agents */}
        {orgMode === 'full-team' && (
          <div className="bg-dark-card border border-dark-border rounded-xl p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-200">Max Real Agents</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Limit the number of coding agents (claude-code, openai, openclaw, cursor). Internal agents are not counted.
                </p>
              </div>
              <input
                type="number"
                min={1}
                value={maxRealAgents ?? ''}
                onChange={(e) => setMaxRealAgents(e.target.value ? Number(e.target.value) : null)}
                placeholder="No limit"
                className="w-28 px-3 py-2 bg-dark-bg border border-dark-border rounded-xl text-slate-200 text-sm text-center focus:outline-none focus:border-accent-purple/50"
              />
            </div>
          </div>
        )}

        {/* Agent Hierarchy */}
        <div>
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">Agent Hierarchy</p>

          {/* CEO at top */}
          {editableCeo && (
            <div className={`rounded-xl border-2 p-4 mb-4 ${ROLE_COLORS.ceo}`}>
              <div className="flex items-center gap-3">
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${ROLE_BADGE.ceo}`}>CEO</span>
                <span className="text-sm font-bold text-white">{editableCeo.name}</span>
                <span className="text-xs text-slate-500 font-mono ml-auto">{editableCeo.type}</span>
              </div>
            </div>
          )}

          {/* Team agents tree */}
          <div className="space-y-3 ml-6 border-l-2 border-dark-border pl-4">
            {displayAgents.map((agent, displayIdx) => {
              const actualIdx = editableTeam.indexOf(agent)
              const isReal = isRealAgent(agent.type)
              const assignedSubagents = subagentMap[actualIdx] || []

              return (
                <div key={actualIdx} className={`rounded-xl border p-4 ${ROLE_COLORS[agent.role] || ROLE_COLORS.worker}`}>
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${ROLE_BADGE[agent.role] || ROLE_BADGE.worker}`}>
                        {agent.role}
                      </span>
                      {isReal && (
                        <span className="text-xs px-2 py-0.5 rounded bg-blue-500/20 text-blue-300 font-medium">
                          coding
                        </span>
                      )}
                      {agent.type === 'internal' && (
                        <span className="text-xs px-2 py-0.5 rounded bg-slate-500/20 text-slate-300 font-medium">
                          internal
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => removeAgent(actualIdx)}
                      className="text-slate-500 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mb-2">
                    <div>
                      <label className="text-xs text-slate-500 mb-1 block">Name</label>
                      <input
                        value={agent.name}
                        onChange={(e) =>
                          setEditableTeam((t) => t.map((a, idx) => idx === actualIdx ? { ...a, name: e.target.value } : a))
                        }
                        className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-xl text-sm text-slate-200 focus:outline-none focus:border-accent-purple/50"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 mb-1 block">Type</label>
                      <select
                        value={agent.type}
                        onChange={(e) =>
                          setEditableTeam((t) => t.map((a, idx) => idx === actualIdx ? { ...a, type: e.target.value as AgentType } : a))
                        }
                        className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-xl text-sm text-slate-200 focus:outline-none focus:border-accent-purple/50"
                      >
                        {['claude', 'openai', 'http', 'bash', 'internal', 'openclaw', 'claude-code', 'a2a', 'mcp'].map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-slate-500 mb-1 block">Role</label>
                      <select
                        value={agent.role}
                        onChange={(e) =>
                          setEditableTeam((t) => t.map((a, idx) => idx === actualIdx ? { ...a, role: e.target.value as AgentRole } : a))
                        }
                        className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-xl text-sm text-slate-200 focus:outline-none focus:border-accent-purple/50"
                      >
                        {['ceo', 'manager', 'worker', 'specialist'].map((r) => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 mb-1 block">Reports To</label>
                      <input
                        value={agent.reportsTo}
                        onChange={(e) =>
                          setEditableTeam((t) => t.map((a, idx) => idx === actualIdx ? { ...a, reportsTo: e.target.value } : a))
                        }
                        className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-xl text-sm text-slate-200 focus:outline-none focus:border-accent-purple/50"
                      />
                    </div>
                  </div>

                  {/* Sub-agent assignment for real agents */}
                  {isReal && internalAgents.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-dark-border">
                      <p className="text-xs text-slate-400 mb-2 flex items-center gap-1">
                        <GitBranch className="w-3 h-3" />
                        Dedicated sub-agents (internal)
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {internalAgents.map((ia) => {
                          const iaIdx = editableTeam.indexOf(ia)
                          const isAssigned = assignedSubagents.includes(iaIdx)
                          return (
                            <button
                              key={iaIdx}
                              onClick={() => toggleSubagent(actualIdx, iaIdx)}
                              className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                                isAssigned
                                  ? 'border-accent-purple bg-accent-purple/20 text-purple-300'
                                  : 'border-dark-border bg-dark-bg text-slate-400 hover:border-slate-500'
                              }`}
                            >
                              {ia.name}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Add agent button */}
          <button
            onClick={addNewAgent}
            className="mt-3 ml-6 flex items-center gap-2 text-sm text-slate-400 hover:text-accent-purple transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add agent
          </button>
        </div>

        {/* Summary */}
        <div className="bg-dark-card border border-dark-border rounded-xl p-4">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-4">
              <span className="text-slate-400">
                Mode: <span className="text-slate-200 font-medium">{orgMode === 'full-team' ? 'Full Team' : 'One Agent Company'}</span>
              </span>
              <span className="text-slate-400">
                Real agents: <span className="text-slate-200 font-medium">{orgMode === 'one-agent' ? 1 : realAgentCount}</span>
                {maxRealAgents !== null && orgMode === 'full-team' && (
                  <span className="text-slate-500"> / {maxRealAgents} max</span>
                )}
              </span>
              <span className="text-slate-400">
                Internal: <span className="text-slate-200 font-medium">{internalAgents.length}</span>
              </span>
            </div>
            <span className="text-sm font-semibold text-green-400">
              Total: {1 + displayAgents.length} agents
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={handleCreate}
            className="flex-1 flex items-center justify-center gap-2 px-6 py-3.5 bg-accent-purple hover:bg-purple-600 text-white font-semibold rounded-xl transition-colors"
          >
            <CheckCircle className="w-5 h-5" />
            Create Organization
          </button>
          <button
            onClick={() => setStep(5)}
            className="px-6 py-3.5 bg-white/5 hover:bg-white/10 text-slate-300 font-medium rounded-xl border border-dark-border transition-colors"
          >
            Customize
          </button>
        </div>
      </div>
    )
  }

  // Step 5: Customize team (fine-tuning)
  if (step === 5) {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <button onClick={() => setStep(4)} className="text-slate-400 hover:text-slate-200">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white">Customize Team</h1>
            <p className="text-sm text-slate-400">Modify agents before creating</p>
          </div>
        </div>

        {editableCeo && (
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">CEO Agent</p>
            <div className={`rounded-xl border-2 p-4 ${ROLE_COLORS.ceo}`}>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Name</label>
                  <input
                    value={editableCeo.name}
                    onChange={(e) => setEditableCeo({ ...editableCeo, name: e.target.value })}
                    className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-sm text-slate-200"
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-500 mb-1 block">Type</label>
                  <select
                    value={editableCeo.type}
                    onChange={(e) => setEditableCeo({ ...editableCeo, type: e.target.value as AgentType })}
                    className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-sm text-slate-200"
                  >
                    {['claude', 'openai', 'internal', 'openclaw', 'claude-code'].map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}

        <div>
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Team Agents</p>
          <div className="space-y-3">
            {editableTeam.map((agent, i) => (
              <div key={i} className={`rounded-xl border p-4 ${ROLE_COLORS[agent.role] || ROLE_COLORS.worker}`}>
                <div className="flex items-start justify-between mb-3">
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${ROLE_BADGE[agent.role] || ROLE_BADGE.worker}`}>
                    {agent.role}
                  </span>
                  <button
                    onClick={() => setEditableTeam((t) => t.filter((_, idx) => idx !== i))}
                    className="text-slate-500 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">Name</label>
                    <input
                      value={agent.name}
                      onChange={(e) => setEditableTeam((t) => t.map((a, idx) => idx === i ? { ...a, name: e.target.value } : a))}
                      className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-sm text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">Type</label>
                    <select
                      value={agent.type}
                      onChange={(e) => setEditableTeam((t) => t.map((a, idx) => idx === i ? { ...a, type: e.target.value as AgentType } : a))}
                      className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-sm text-slate-200"
                    >
                      {['claude', 'openai', 'http', 'bash', 'internal', 'openclaw', 'claude-code', 'a2a', 'mcp'].map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-dark-card border border-dark-border rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-400">Total agents: {1 + editableTeam.length}</span>
            <span className="text-sm font-semibold text-green-400">
              ~${(analysisResult?.estimatedMonthlyCostUsd || 0).toFixed(2)}/month estimated
            </span>
          </div>
        </div>

        <button
          onClick={handleCreate}
          className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-accent-purple hover:bg-purple-600 text-white font-semibold rounded-xl transition-colors"
        >
          <CheckCircle className="w-5 h-5" />
          Create Organization
        </button>
      </div>
    )
  }

  // Step 6: Creating
  if (step === 6) {
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
                <CheckCircle className="w-4 h-4" />
                {msg}
              </div>
            ))}
            {createMutation.isPending && (
              <div className="flex items-center gap-2 text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                Finalizing...
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // Step 7: Done
  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex flex-col items-center justify-center py-20 space-y-6 text-center">
        <div className="w-20 h-20 bg-green-500/20 rounded-2xl flex items-center justify-center border border-green-500/30">
          <CheckCircle className="w-10 h-10 text-green-400" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-white mb-2">Your AI business is ready!</h2>
          <p className="text-slate-400">
            Your CEO agent and team have been created. Run the CEO to get started.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => navigate('/organization')}
            className="flex items-center gap-2 px-6 py-3 bg-accent-purple hover:bg-purple-600 text-white font-semibold rounded-xl transition-colors"
          >
            <Building2 className="w-5 h-5" />
            View Org Chart
          </button>
          <button
            onClick={() => navigate('/agents')}
            className="px-6 py-3 bg-white/5 hover:bg-white/10 text-slate-300 font-medium rounded-xl border border-dark-border transition-colors"
          >
            View Agents
          </button>
        </div>
      </div>
    </div>
  )
}
