import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  Building2, Sparkles, ChevronRight, Plus, Trash2, CheckCircle,
  Loader2, ArrowLeft, MessageSquare, Rocket, Send, Bot, User as UserIcon,
} from 'lucide-react'
import {
  createCeo, ceoPrelaunchChat, launchBusiness, getPrelaunchMessages,
  BusinessAnalysisInput, AgentType, AgentRole, TeamPlan, PrelaunchMessage,
} from '../api/client'
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

type Step = 0 | 1 | 2 | 3 | 4 | 5

export default function BusinessSetup() {
  const navigate = useNavigate()
  const toast = useToast()
  const [step, setStep] = useState<Step>(0)

  // Form data
  const [companyName, setCompanyName] = useState('')
  const [industry, setIndustry] = useState('')
  const [description, setDescription] = useState('')
  const [goals, setGoals] = useState<string[]>([''])

  // Result from create-ceo
  const [orgId, setOrgId] = useState<string | null>(null)
  const [teamPlan, setTeamPlan] = useState<TeamPlan | null>(null)
  const [editableTeam, setEditableTeam] = useState<TeamPlan['proposedTeam']>([])

  // Chat state
  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState<PrelaunchMessage[]>([])
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  // ─── Mutations ──────────────────────────────────────────────────────────────

  const createCeoMutation = useMutation({
    mutationFn: (data: BusinessAnalysisInput) => createCeo(data),
    onSuccess: (result) => {
      setOrgId(result.data.organization.id)
      setTeamPlan(result.data.teamPlan)
      setEditableTeam(result.data.teamPlan.proposedTeam || [])
      setStep(3)
    },
    onError: (err: Error) => {
      toast.error(`Failed: ${err.message}`)
      setStep(1)
    },
  })

  const chatMutation = useMutation({
    mutationFn: (message: string) => ceoPrelaunchChat(orgId!, message),
    onSuccess: (result) => {
      setChatMessages(prev => [...prev, {
        id: `asst-${Date.now()}`,
        organizationId: orgId!,
        role: 'assistant',
        content: result.data.message,
        createdAt: new Date().toISOString(),
      }])
      if (result.data.planUpdated && result.data.updatedPlan) {
        setTeamPlan(result.data.updatedPlan)
        setEditableTeam(result.data.updatedPlan.proposedTeam || [])
        toast.success('CEO updated the team plan!')
      }
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const launchMutation = useMutation({
    mutationFn: () => launchBusiness(orgId!, editableTeam as any),
    onSuccess: () => {
      toast.success('Organization launched!')
      setTimeout(() => navigate('/organization'), 1500)
    },
    onError: (err: Error) => {
      toast.error(`Launch failed: ${err.message}`)
      setStep(3)
    },
  })

  // ─── Handlers ───────────────────────────────────────────────────────────────

  const handleAnalyze = () => {
    const validGoals = goals.filter(g => g.trim())
    if (!companyName.trim() || !description.trim()) {
      toast.error('Please fill in company name and description')
      return
    }
    setStep(2)
    createCeoMutation.mutate({ name: companyName, description, industry, goals: validGoals })
  }

  const handleSendChat = () => {
    if (!chatInput.trim() || chatMutation.isPending) return
    const msg = chatInput.trim()
    setChatInput('')
    setChatMessages(prev => [...prev, {
      id: `user-${Date.now()}`,
      organizationId: orgId!,
      role: 'user',
      content: msg,
      createdAt: new Date().toISOString(),
    }])
    chatMutation.mutate(msg)
  }

  const handleLaunch = () => {
    setStep(5)
    launchMutation.mutate()
  }

  const addGoal = () => setGoals(g => [...g, ''])
  const removeGoal = (i: number) => setGoals(g => g.filter((_, idx) => idx !== i))
  const updateGoal = (i: number, val: string) => setGoals(g => g.map((x, idx) => idx === i ? val : x))

  // ─── Step 0: Intro ─────────────────────────────────────────────────────────

  if (step === 0) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="text-center py-16 space-y-6">
          <div className="w-20 h-20 bg-accent-purple/20 rounded-2xl flex items-center justify-center mx-auto border border-accent-purple/30">
            <Building2 className="w-10 h-10 text-accent-purple" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white mb-3">Set Up Your AI Business</h1>
            <p className="text-slate-400 text-lg">CEO-first approach: we create your CEO, then build the team together.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-left">
            {[
              { icon: '\u{1F916}', title: 'AI CEO', desc: 'Your CEO is created first with full identity files' },
              { icon: '\u{1F4AC}', title: 'Chat (Optional)', desc: 'Discuss the team plan with your CEO before launch' },
              { icon: '\u{1F680}', title: 'Launch', desc: 'Team agents are created with AGENT.md, SOUL.md, HEARTBEAT.md' },
            ].map(item => (
              <div key={item.title} className="bg-dark-card border border-dark-border rounded-xl p-4">
                <div className="text-2xl mb-2">{item.icon}</div>
                <p className="text-sm font-semibold text-white mb-1">{item.title}</p>
                <p className="text-xs text-slate-500">{item.desc}</p>
              </div>
            ))}
          </div>
          <button onClick={() => setStep(1)} className="flex items-center gap-2 px-8 py-3.5 bg-accent-purple hover:bg-purple-600 text-white font-semibold rounded-xl transition-colors mx-auto">
            Get Started <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    )
  }

  // ─── Step 1: Business Input ─────────────────────────────────────────────────

  if (step === 1) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <button onClick={() => setStep(0)} className="text-slate-400 hover:text-slate-200"><ArrowLeft className="w-5 h-5" /></button>
          <div>
            <h1 className="text-2xl font-bold text-white">Describe Your Business</h1>
            <p className="text-sm text-slate-400">Tell us about your company so we can design the right team</p>
          </div>
        </div>

        <div className="bg-dark-card border border-dark-border rounded-xl p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Company Name *</label>
            <input type="text" value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Acme Corp"
              className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-xl text-slate-200 placeholder-slate-600 text-sm focus:outline-none focus:border-accent-purple/50" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Industry</label>
            <select value={industry} onChange={e => setIndustry(e.target.value)}
              className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-xl text-slate-200 text-sm focus:outline-none focus:border-accent-purple/50">
              <option value="">Select industry...</option>
              {INDUSTRIES.map(ind => <option key={ind} value={ind}>{ind}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Description *</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="What does your company do?"
              className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-xl text-slate-200 placeholder-slate-600 text-sm resize-none focus:outline-none focus:border-accent-purple/50" rows={4} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Goals</label>
            <div className="space-y-2">
              {goals.map((goal, i) => (
                <div key={i} className="flex gap-2">
                  <input type="text" value={goal} onChange={e => updateGoal(i, e.target.value)} placeholder={`Goal ${i + 1}...`}
                    className="flex-1 px-4 py-2.5 bg-dark-bg border border-dark-border rounded-xl text-slate-200 placeholder-slate-600 text-sm focus:outline-none focus:border-accent-purple/50" />
                  {goals.length > 1 && (
                    <button onClick={() => removeGoal(i)} className="p-2.5 text-slate-500 hover:text-red-400"><Trash2 className="w-4 h-4" /></button>
                  )}
                </div>
              ))}
              <button onClick={addGoal} className="flex items-center gap-2 text-sm text-slate-400 hover:text-accent-purple">
                <Plus className="w-4 h-4" /> Add goal
              </button>
            </div>
          </div>
        </div>

        <button onClick={handleAnalyze} className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-accent-purple hover:bg-purple-600 text-white font-semibold rounded-xl transition-colors">
          <Sparkles className="w-5 h-5" /> Analyze & Create CEO <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    )
  }

  // ─── Step 2: Analyzing + Creating CEO ───────────────────────────────────────

  if (step === 2) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="flex flex-col items-center justify-center py-20 space-y-6">
          <div className="w-16 h-16 bg-accent-purple/20 rounded-2xl flex items-center justify-center border border-accent-purple/30 animate-pulse">
            <Sparkles className="w-8 h-8 text-accent-purple" />
          </div>
          <div className="text-center">
            <h2 className="text-xl font-bold text-white mb-2">Analyzing & Creating CEO...</h2>
            <p className="text-slate-400 text-sm">AI is designing your org and creating the CEO agent</p>
          </div>
          <div className="flex flex-col items-center gap-2 text-sm text-slate-500">
            {['Analyzing business model', 'Designing org structure', 'Creating CEO agent', 'Generating team plan'].map((s, i) => (
              <div key={i} className="flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> {s}</div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ─── Step 3: Team Plan Review ───────────────────────────────────────────────

  if (step === 3) {
    if (!teamPlan) return null
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <button onClick={() => setStep(1)} className="text-slate-400 hover:text-slate-200"><ArrowLeft className="w-5 h-5" /></button>
          <div>
            <h1 className="text-2xl font-bold text-white">Team Plan</h1>
            <p className="text-sm text-slate-400">CEO created! Review the proposed team before launch.</p>
          </div>
        </div>

        {/* CEO Created Banner */}
        <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-green-400 shrink-0" />
          <div>
            <p className="text-sm font-medium text-green-300">CEO Agent Created</p>
            <p className="text-xs text-green-400/70">{teamPlan.ceoAgent.name} — {teamPlan.ceoAgent.type} · {teamPlan.ceoAgent.jobDescription}</p>
          </div>
        </div>

        {/* AI Reasoning */}
        {teamPlan.reasoning && (
          <div className="bg-dark-card border border-dark-border rounded-xl p-5">
            <h3 className="text-sm font-semibold text-white mb-2">AI Analysis</h3>
            <p className="text-sm text-slate-400">{teamPlan.reasoning}</p>
          </div>
        )}

        {/* Proposed Team */}
        <div>
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">Proposed Team ({editableTeam.length} agents)</p>
          <div className="space-y-3">
            {editableTeam.map((agent, i) => (
              <div key={i} className={`rounded-xl border p-4 ${ROLE_COLORS[agent.role] || ROLE_COLORS.worker}`}>
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${ROLE_BADGE[agent.role] || ROLE_BADGE.worker}`}>{agent.role}</span>
                    <span className="text-xs text-slate-500 font-mono">{agent.type}</span>
                  </div>
                  <button onClick={() => setEditableTeam(t => t.filter((_, idx) => idx !== i))} className="text-slate-500 hover:text-red-400">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3 mb-2">
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">Name</label>
                    <input value={agent.name} onChange={e => setEditableTeam(t => t.map((a, idx) => idx === i ? { ...a, name: e.target.value } : a))}
                      className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-xl text-sm text-slate-200 focus:outline-none focus:border-accent-purple/50" />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">Type</label>
                    <select value={agent.type} onChange={e => setEditableTeam(t => t.map((a, idx) => idx === i ? { ...a, type: e.target.value as AgentType } : a))}
                      className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-xl text-sm text-slate-200 focus:outline-none focus:border-accent-purple/50">
                      {['claude', 'openai', 'http', 'bash', 'internal', 'openclaw', 'claude-code', 'a2a', 'mcp'].map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">Role</label>
                    <select value={agent.role} onChange={e => setEditableTeam(t => t.map((a, idx) => idx === i ? { ...a, role: e.target.value as AgentRole } : a))}
                      className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-xl text-sm text-slate-200 focus:outline-none focus:border-accent-purple/50">
                      {['manager', 'worker', 'specialist'].map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">Reports To</label>
                    <input value={agent.reportsTo} onChange={e => setEditableTeam(t => t.map((a, idx) => idx === i ? { ...a, reportsTo: e.target.value } : a))}
                      className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-xl text-sm text-slate-200 focus:outline-none focus:border-accent-purple/50" />
                  </div>
                </div>
                {agent.jobDescription && <p className="text-xs text-slate-500 mt-2">{agent.jobDescription}</p>}
              </div>
            ))}
          </div>
          <button onClick={() => setEditableTeam(t => [...t, { name: 'New Agent', role: 'worker' as AgentRole, description: '', type: 'internal' as AgentType, config: {}, jobDescription: '', reportsTo: 'ceo' }])}
            className="mt-3 flex items-center gap-2 text-sm text-slate-400 hover:text-accent-purple">
            <Plus className="w-4 h-4" /> Add agent
          </button>
        </div>

        {/* Cost */}
        <div className="bg-dark-card border border-dark-border rounded-xl p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Estimated Monthly Cost</h3>
            <span className="text-lg font-bold text-green-400">~${(teamPlan.estimatedMonthlyCostUsd || 0).toFixed(2)}/month</span>
          </div>
          {teamPlan.recommendation && <p className="text-sm text-slate-400 mt-2">{teamPlan.recommendation}</p>}
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button onClick={() => { setChatMessages([]); setStep(4) }}
            className="flex-1 flex items-center justify-center gap-2 px-6 py-3.5 bg-white/5 hover:bg-white/10 text-slate-200 font-medium rounded-xl border border-dark-border transition-colors">
            <MessageSquare className="w-5 h-5" /> Chat with CEO (Optional)
          </button>
          <button onClick={handleLaunch}
            className="flex-1 flex items-center justify-center gap-2 px-6 py-3.5 bg-accent-purple hover:bg-purple-600 text-white font-semibold rounded-xl transition-colors">
            <Rocket className="w-5 h-5" /> Launch Now
          </button>
        </div>
      </div>
    )
  }

  // ─── Step 4: CEO Chat ───────────────────────────────────────────────────────

  if (step === 4) {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => setStep(3)} className="text-slate-400 hover:text-slate-200"><ArrowLeft className="w-5 h-5" /></button>
            <div>
              <h1 className="text-2xl font-bold text-white">Chat with CEO</h1>
              <p className="text-sm text-slate-400">Refine the team plan with your CEO before launch</p>
            </div>
          </div>
          <button onClick={handleLaunch}
            className="flex items-center gap-2 px-5 py-2.5 bg-accent-purple hover:bg-purple-600 text-white font-medium rounded-xl transition-colors text-sm">
            <Rocket className="w-4 h-4" /> Launch
          </button>
        </div>

        {/* Chat Messages */}
        <div className="bg-dark-card border border-dark-border rounded-xl overflow-hidden" style={{ height: 'calc(100vh - 280px)' }}>
          <div className="h-full flex flex-col">
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {chatMessages.length === 0 && (
                <div className="text-center py-12 text-slate-500">
                  <Bot className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Start a conversation with your CEO.</p>
                  <p className="text-xs mt-1">Ask about the team plan, suggest changes, or discuss strategy.</p>
                </div>
              )}
              {chatMessages.map(msg => (
                <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                  {msg.role === 'assistant' && (
                    <div className="w-8 h-8 rounded-lg bg-yellow-500/20 flex items-center justify-center shrink-0">
                      <Bot className="w-4 h-4 text-yellow-400" />
                    </div>
                  )}
                  <div className={`max-w-[80%] rounded-xl px-4 py-3 text-sm ${
                    msg.role === 'user'
                      ? 'bg-accent-purple/20 text-slate-200 border border-accent-purple/30'
                      : 'bg-dark-bg text-slate-300 border border-dark-border'
                  }`}>
                    <p className="whitespace-pre-wrap">{msg.content.replace(/<plan_update>[\s\S]*?<\/plan_update>/g, '').trim()}</p>
                  </div>
                  {msg.role === 'user' && (
                    <div className="w-8 h-8 rounded-lg bg-accent-purple/20 flex items-center justify-center shrink-0">
                      <UserIcon className="w-4 h-4 text-accent-purple" />
                    </div>
                  )}
                </div>
              ))}
              {chatMutation.isPending && (
                <div className="flex gap-3">
                  <div className="w-8 h-8 rounded-lg bg-yellow-500/20 flex items-center justify-center shrink-0">
                    <Bot className="w-4 h-4 text-yellow-400" />
                  </div>
                  <div className="bg-dark-bg border border-dark-border rounded-xl px-4 py-3">
                    <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Chat Input */}
            <div className="border-t border-dark-border p-4">
              <div className="flex gap-2">
                <input
                  type="text" value={chatInput} onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSendChat()}
                  placeholder="Ask your CEO about the team plan..."
                  className="flex-1 px-4 py-3 bg-dark-bg border border-dark-border rounded-xl text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent-purple/50"
                />
                <button onClick={handleSendChat} disabled={!chatInput.trim() || chatMutation.isPending}
                  className="px-4 py-3 bg-accent-purple hover:bg-purple-600 disabled:opacity-50 text-white rounded-xl transition-colors">
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ─── Step 5: Launching ──────────────────────────────────────────────────────

  if (step === 5) {
    const isDone = !launchMutation.isPending && launchMutation.isSuccess
    return (
      <div className="max-w-2xl mx-auto">
        <div className="flex flex-col items-center justify-center py-20 space-y-6">
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center border ${isDone ? 'bg-green-500/20 border-green-500/30' : 'bg-accent-purple/20 border-accent-purple/30 animate-pulse'}`}>
            {isDone ? <CheckCircle className="w-8 h-8 text-green-400" /> : <Rocket className="w-8 h-8 text-accent-purple" />}
          </div>
          <div className="text-center">
            <h2 className="text-xl font-bold text-white mb-2">{isDone ? 'Organization Launched!' : 'Launching...'}</h2>
            <p className="text-slate-400 text-sm">{isDone ? 'Your AI team is ready. Redirecting...' : 'Creating team agents and identity files'}</p>
          </div>
          {!isDone && (
            <div className="flex flex-col items-center gap-2 text-sm text-slate-500">
              {['Creating team agents', 'Resolving hierarchy', 'Generating AGENT.md files', 'Generating SOUL.md files', 'Generating HEARTBEAT.md files'].map((s, i) => (
                <div key={i} className="flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> {s}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  return null
}
