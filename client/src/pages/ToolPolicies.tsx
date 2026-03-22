import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  Lock,
  Plus,
  Trash2,
  Pencil,
  X,
  ToggleLeft,
  ToggleRight,
  Search,
  CheckCircle2,
  XCircle,
  Bot,
  Building2,
} from 'lucide-react'
import {
  getToolPolicies,
  createToolPolicy,
  updateToolPolicy,
  deleteToolPolicy,
  checkToolPermissionApi,
  getOrganizations,
  getAgents,
  ToolPolicy,
  Agent,
  Organization,
} from '../api/client'
import { useToast } from '../components/Toaster'
import Modal from '../components/Modal'

// ─── Constants ──────────────────────────────────────────────────────────────

const MODE_BADGE: Record<string, string> = {
  read_only: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  draft_only: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  execute: 'bg-green-500/20 text-green-400 border-green-500/30',
  execute_with_approval: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  sandbox_only: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
}

const MODE_LABELS: Record<string, string> = {
  read_only: 'Read Only',
  draft_only: 'Draft Only',
  execute: 'Execute',
  execute_with_approval: 'Approval Required',
  sandbox_only: 'Sandbox Only',
}

const CLASS_BADGE: Record<string, string> = {
  research: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  generation: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  execution: 'bg-red-500/20 text-red-400 border-red-500/30',
  communication: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
  filesystem: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
}

const TOOL_SUGGESTIONS = ['web_search', 'gmail', 'filesystem', 'code_exec', 'api_call', 'database', 'slack', 'whatsapp']
const TOOL_CLASSES = ['research', 'generation', 'execution', 'communication', 'filesystem']
const MODES = ['read_only', 'draft_only', 'execute', 'execute_with_approval', 'sandbox_only']

// ─── Empty Form ─────────────────────────────────────────────────────────────

const emptyForm = {
  toolName: '',
  toolClass: '',
  mode: 'execute',
  approvalRequired: false,
  organizationId: '',
  allowedAgentIds: [] as string[],
  deniedAgentIds: [] as string[],
  maxCallsPerRun: '',
  maxCallsPerDay: '',
  maxCostPerCallUsd: '',
  requiredConditions: [] as string[],
  forbiddenConditions: [] as string[],
  postconditions: [] as string[],
  enabled: true,
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function ToolPolicies() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const [filterOrgId, setFilterOrgId] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [conditionInput, setConditionInput] = useState({ required: '', forbidden: '', post: '' })

  // Test permission state
  const [testAgentId, setTestAgentId] = useState('')
  const [testToolName, setTestToolName] = useState('')
  const [testResult, setTestResult] = useState<{ allowed: boolean; mode: string; approvalRequired: boolean; reason?: string } | null>(null)

  // ─── Queries ────────────────────────────────────────────────────────────
  const { data: policies = [], isLoading } = useQuery({
    queryKey: ['tool-policies', filterOrgId],
    queryFn: () => getToolPolicies(filterOrgId ? { organizationId: filterOrgId } : undefined),
  })

  const { data: orgsData } = useQuery({
    queryKey: ['organizations'],
    queryFn: getOrganizations,
  })
  const orgs: Organization[] = orgsData?.data ?? []

  const { data: agentsData } = useQuery({
    queryKey: ['agents'],
    queryFn: () => getAgents(),
  })
  const agents: Agent[] = agentsData?.data ?? []

  // ─── Mutations ──────────────────────────────────────────────────────────
  const createMut = useMutation({
    mutationFn: createToolPolicy,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['tool-policies'] }); toast('Policy created', 'success'); setShowModal(false) },
    onError: (e: Error) => toast(e.message, 'error'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ToolPolicy> }) => updateToolPolicy(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['tool-policies'] }); toast('Policy updated', 'success'); setShowModal(false) },
    onError: (e: Error) => toast(e.message, 'error'),
  })

  const deleteMut = useMutation({
    mutationFn: deleteToolPolicy,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['tool-policies'] }); toast('Policy deleted', 'success') },
    onError: (e: Error) => toast(e.message, 'error'),
  })

  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateToolPolicy(id, { enabled } as any),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tool-policies'] }),
    onError: (e: Error) => toast(e.message, 'error'),
  })

  // ─── Handlers ───────────────────────────────────────────────────────────
  const openCreate = () => {
    setEditingId(null)
    setForm(emptyForm)
    setShowModal(true)
  }

  const openEdit = (p: ToolPolicy) => {
    setEditingId(p.id)
    setForm({
      toolName: p.toolName,
      toolClass: p.toolClass || '',
      mode: p.mode,
      approvalRequired: p.approvalRequired,
      organizationId: p.organizationId || '',
      allowedAgentIds: p.allowedAgentIds || [],
      deniedAgentIds: p.deniedAgentIds || [],
      maxCallsPerRun: p.maxCallsPerRun != null ? String(p.maxCallsPerRun) : '',
      maxCallsPerDay: p.maxCallsPerDay != null ? String(p.maxCallsPerDay) : '',
      maxCostPerCallUsd: p.maxCostPerCallUsd != null ? String(p.maxCostPerCallUsd) : '',
      requiredConditions: p.requiredConditions || [],
      forbiddenConditions: p.forbiddenConditions || [],
      postconditions: p.postconditions || [],
      enabled: p.enabled,
    })
    setShowModal(true)
  }

  const handleSave = () => {
    if (!form.toolName.trim()) { toast('Tool name is required', 'error'); return }
    const data: any = {
      toolName: form.toolName.trim(),
      toolClass: form.toolClass || null,
      mode: form.mode,
      approvalRequired: form.approvalRequired,
      organizationId: form.organizationId || null,
      allowedAgentIds: form.allowedAgentIds.length > 0 ? form.allowedAgentIds : null,
      deniedAgentIds: form.deniedAgentIds.length > 0 ? form.deniedAgentIds : null,
      maxCallsPerRun: form.maxCallsPerRun ? parseInt(form.maxCallsPerRun) : null,
      maxCallsPerDay: form.maxCallsPerDay ? parseInt(form.maxCallsPerDay) : null,
      maxCostPerCallUsd: form.maxCostPerCallUsd ? parseFloat(form.maxCostPerCallUsd) : null,
      requiredConditions: form.requiredConditions.length > 0 ? form.requiredConditions : null,
      forbiddenConditions: form.forbiddenConditions.length > 0 ? form.forbiddenConditions : null,
      postconditions: form.postconditions.length > 0 ? form.postconditions : null,
      enabled: form.enabled,
    }
    if (editingId) {
      updateMut.mutate({ id: editingId, data })
    } else {
      createMut.mutate(data)
    }
  }

  const handleTestPermission = async () => {
    if (!testAgentId || !testToolName) { toast('Select an agent and enter a tool name', 'error'); return }
    try {
      const result = await checkToolPermissionApi({ agentId: testAgentId, toolName: testToolName })
      setTestResult(result)
    } catch (e: any) {
      toast(e.message, 'error')
    }
  }

  const addCondition = (type: 'required' | 'forbidden' | 'post') => {
    const key = type === 'required' ? 'required' : type === 'forbidden' ? 'forbidden' : 'post'
    const formKey = type === 'required' ? 'requiredConditions' : type === 'forbidden' ? 'forbiddenConditions' : 'postconditions'
    const val = conditionInput[key].trim()
    if (!val) return
    setForm(f => ({ ...f, [formKey]: [...f[formKey], val] }))
    setConditionInput(c => ({ ...c, [key]: '' }))
  }

  const removeCondition = (type: 'requiredConditions' | 'forbiddenConditions' | 'postconditions', idx: number) => {
    setForm(f => ({ ...f, [type]: f[type].filter((_, i) => i !== idx) }))
  }

  const toggleAgentSelection = (list: 'allowedAgentIds' | 'deniedAgentIds', agentId: string) => {
    setForm(f => {
      const current = f[list]
      if (current.includes(agentId)) {
        return { ...f, [list]: current.filter(id => id !== agentId) }
      }
      return { ...f, [list]: [...current, agentId] }
    })
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="w-7 h-7 text-accent-purple" />
          <div>
            <h1 className="text-2xl font-bold text-white">Tool Governance</h1>
            <p className="text-sm text-slate-400">Manage tool access policies for agents</p>
          </div>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2.5 bg-accent-purple hover:bg-accent-purple/80 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={16} />
          New Policy
        </button>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-3">
        <Building2 size={16} className="text-slate-400" />
        <select
          value={filterOrgId}
          onChange={e => setFilterOrgId(e.target.value)}
          className="bg-dark-card border border-dark-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-accent-purple/50"
        >
          <option value="">All Organizations</option>
          {orgs.map(o => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
        <span className="text-sm text-slate-500">{policies.length} {policies.length === 1 ? 'policy' : 'policies'}</span>
      </div>

      {/* Policy Cards */}
      {isLoading ? (
        <div className="text-center py-12 text-slate-400">Loading policies...</div>
      ) : policies.length === 0 ? (
        <div className="text-center py-16 bg-dark-card border border-dark-border rounded-xl">
          <ShieldCheck className="w-12 h-12 text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400 text-lg mb-1">No tool policies defined</p>
          <p className="text-slate-500 text-sm">All tools are open by default. Create a policy to restrict access.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {policies.map((p: ToolPolicy) => (
            <div key={p.id} className={`bg-dark-card border rounded-xl p-5 transition-all ${p.enabled ? 'border-dark-border' : 'border-dark-border/50 opacity-60'}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="text-lg font-bold text-white">{p.toolName}</h3>
                    {p.toolClass && (
                      <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${CLASS_BADGE[p.toolClass] || 'bg-slate-500/20 text-slate-400 border-slate-500/30'}`}>
                        {p.toolClass}
                      </span>
                    )}
                    <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${MODE_BADGE[p.mode] || ''}`}>
                      {MODE_LABELS[p.mode] || p.mode}
                    </span>
                    {p.approvalRequired && (
                      <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border bg-orange-500/20 text-orange-400 border-orange-500/30">
                        <Lock size={10} /> Approval
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-400">
                    {p.maxCallsPerRun != null && (
                      <span>Max {p.maxCallsPerRun}/run</span>
                    )}
                    {p.maxCallsPerDay != null && (
                      <span>Max {p.maxCallsPerDay}/day</span>
                    )}
                    {p.maxCostPerCallUsd != null && (
                      <span>Max ${p.maxCostPerCallUsd}/call</span>
                    )}
                    {p.allowedAgentIds && p.allowedAgentIds.length > 0 && (
                      <span className="text-green-400">{p.allowedAgentIds.length} allowed agent{p.allowedAgentIds.length !== 1 ? 's' : ''}</span>
                    )}
                    {p.deniedAgentIds && p.deniedAgentIds.length > 0 && (
                      <span className="text-red-400">{p.deniedAgentIds.length} denied agent{p.deniedAgentIds.length !== 1 ? 's' : ''}</span>
                    )}
                    {p.organizationId && (
                      <span className="text-slate-500">Org: {orgs.find(o => o.id === p.organizationId)?.name || p.organizationId.slice(0, 8)}</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => toggleMut.mutate({ id: p.id, enabled: !p.enabled })}
                    className="p-1.5 text-slate-400 hover:text-slate-200 transition-colors"
                    title={p.enabled ? 'Disable' : 'Enable'}
                  >
                    {p.enabled ? <ToggleRight size={20} className="text-green-400" /> : <ToggleLeft size={20} />}
                  </button>
                  <button
                    onClick={() => openEdit(p)}
                    className="p-1.5 text-slate-400 hover:text-accent-purple transition-colors"
                    title="Edit"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    onClick={() => { if (confirm('Delete this policy?')) deleteMut.mutate(p.id) }}
                    className="p-1.5 text-slate-400 hover:text-red-400 transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Test Permission Section */}
      <div className="bg-dark-card border border-dark-border rounded-xl p-6">
        <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
          <Search size={18} className="text-accent-purple" />
          Test Permission
        </h2>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-slate-400 mb-1">Agent</label>
            <select
              value={testAgentId}
              onChange={e => { setTestAgentId(e.target.value); setTestResult(null) }}
              className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-accent-purple/50"
            >
              <option value="">Select agent...</option>
              {agents.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs text-slate-400 mb-1">Tool Name</label>
            <input
              value={testToolName}
              onChange={e => { setTestToolName(e.target.value); setTestResult(null) }}
              placeholder="e.g. web_search"
              list="tool-suggestions-test"
              className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-accent-purple/50"
            />
            <datalist id="tool-suggestions-test">
              {TOOL_SUGGESTIONS.map(t => <option key={t} value={t} />)}
            </datalist>
          </div>
          <button
            onClick={handleTestPermission}
            className="px-4 py-2 bg-accent-purple hover:bg-accent-purple/80 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Check
          </button>
        </div>
        {testResult && (
          <div className={`mt-4 flex items-center gap-3 p-3 rounded-lg border ${testResult.allowed ? 'bg-green-500/10 border-green-500/30' : 'bg-red-500/10 border-red-500/30'}`}>
            {testResult.allowed ? (
              <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />
            ) : (
              <XCircle className="w-5 h-5 text-red-400 shrink-0" />
            )}
            <div>
              <span className={`font-medium ${testResult.allowed ? 'text-green-400' : 'text-red-400'}`}>
                {testResult.allowed ? 'Allowed' : 'Denied'}
              </span>
              <span className="text-slate-400 text-sm ml-2">
                Mode: {MODE_LABELS[testResult.mode] || testResult.mode}
                {testResult.approvalRequired && ' (needs approval)'}
              </span>
              {testResult.reason && (
                <p className="text-sm text-slate-400 mt-1">{testResult.reason}</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Create/Edit Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editingId ? 'Edit Policy' : 'New Policy'}>
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          {/* Tool Name */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Tool Name *</label>
            <input
              value={form.toolName}
              onChange={e => setForm(f => ({ ...f, toolName: e.target.value }))}
              placeholder="e.g. web_search"
              list="tool-suggestions"
              className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-accent-purple/50"
            />
            <datalist id="tool-suggestions">
              {TOOL_SUGGESTIONS.map(t => <option key={t} value={t} />)}
            </datalist>
          </div>

          {/* Tool Class */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Tool Class</label>
            <select
              value={form.toolClass}
              onChange={e => setForm(f => ({ ...f, toolClass: e.target.value }))}
              className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-accent-purple/50"
            >
              <option value="">None</option>
              {TOOL_CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          {/* Mode */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Mode</label>
            <select
              value={form.mode}
              onChange={e => setForm(f => ({ ...f, mode: e.target.value }))}
              className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-accent-purple/50"
            >
              {MODES.map(m => <option key={m} value={m}>{MODE_LABELS[m]}</option>)}
            </select>
          </div>

          {/* Organization */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Organization (optional)</label>
            <select
              value={form.organizationId}
              onChange={e => setForm(f => ({ ...f, organizationId: e.target.value }))}
              className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-accent-purple/50"
            >
              <option value="">Global (all orgs)</option>
              {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>

          {/* Approval Required */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, approvalRequired: !f.approvalRequired }))}
              className={`relative w-10 h-5 rounded-full transition-colors ${form.approvalRequired ? 'bg-accent-purple' : 'bg-dark-border'}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${form.approvalRequired ? 'left-5' : 'left-0.5'}`} />
            </button>
            <span className="text-sm text-slate-300">Approval Required</span>
          </div>

          {/* Enabled */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setForm(f => ({ ...f, enabled: !f.enabled }))}
              className={`relative w-10 h-5 rounded-full transition-colors ${form.enabled ? 'bg-green-500' : 'bg-dark-border'}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${form.enabled ? 'left-5' : 'left-0.5'}`} />
            </button>
            <span className="text-sm text-slate-300">Enabled</span>
          </div>

          {/* Rate Limits */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Max Calls/Run</label>
              <input
                type="number"
                value={form.maxCallsPerRun}
                onChange={e => setForm(f => ({ ...f, maxCallsPerRun: e.target.value }))}
                placeholder="Unlimited"
                className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-accent-purple/50"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Max Calls/Day</label>
              <input
                type="number"
                value={form.maxCallsPerDay}
                onChange={e => setForm(f => ({ ...f, maxCallsPerDay: e.target.value }))}
                placeholder="Unlimited"
                className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-accent-purple/50"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Max $/Call</label>
              <input
                type="number"
                step="0.01"
                value={form.maxCostPerCallUsd}
                onChange={e => setForm(f => ({ ...f, maxCostPerCallUsd: e.target.value }))}
                placeholder="Unlimited"
                className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-accent-purple/50"
              />
            </div>
          </div>

          {/* Allowed Agents */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Allowed Agents (empty = all)</label>
            <div className="flex flex-wrap gap-2 p-2 bg-dark-bg border border-dark-border rounded-lg min-h-[40px]">
              {form.allowedAgentIds.map(id => {
                const a = agents.find(ag => ag.id === id)
                return (
                  <span key={id} className="flex items-center gap-1 px-2 py-0.5 text-xs bg-green-500/20 text-green-400 border border-green-500/30 rounded-full">
                    <Bot size={10} /> {a?.name || id.slice(0, 8)}
                    <button onClick={() => toggleAgentSelection('allowedAgentIds', id)} className="ml-0.5 hover:text-white"><X size={10} /></button>
                  </span>
                )
              })}
            </div>
            <select
              value=""
              onChange={e => { if (e.target.value) toggleAgentSelection('allowedAgentIds', e.target.value) }}
              className="w-full mt-1 bg-dark-bg border border-dark-border rounded-lg px-3 py-1.5 text-xs text-slate-400 focus:outline-none"
            >
              <option value="">+ Add allowed agent...</option>
              {agents.filter(a => !form.allowedAgentIds.includes(a.id)).map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          {/* Denied Agents */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Denied Agents</label>
            <div className="flex flex-wrap gap-2 p-2 bg-dark-bg border border-dark-border rounded-lg min-h-[40px]">
              {form.deniedAgentIds.map(id => {
                const a = agents.find(ag => ag.id === id)
                return (
                  <span key={id} className="flex items-center gap-1 px-2 py-0.5 text-xs bg-red-500/20 text-red-400 border border-red-500/30 rounded-full">
                    <Bot size={10} /> {a?.name || id.slice(0, 8)}
                    <button onClick={() => toggleAgentSelection('deniedAgentIds', id)} className="ml-0.5 hover:text-white"><X size={10} /></button>
                  </span>
                )
              })}
            </div>
            <select
              value=""
              onChange={e => { if (e.target.value) toggleAgentSelection('deniedAgentIds', e.target.value) }}
              className="w-full mt-1 bg-dark-bg border border-dark-border rounded-lg px-3 py-1.5 text-xs text-slate-400 focus:outline-none"
            >
              <option value="">+ Add denied agent...</option>
              {agents.filter(a => !form.deniedAgentIds.includes(a.id)).map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>

          {/* Required Conditions */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Required Conditions</label>
            <div className="space-y-1 mb-1">
              {form.requiredConditions.map((c, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-slate-300">
                  <span className="flex-1 bg-dark-bg border border-dark-border rounded px-2 py-1">{c}</span>
                  <button onClick={() => removeCondition('requiredConditions', i)} className="text-slate-500 hover:text-red-400"><X size={12} /></button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={conditionInput.required}
                onChange={e => setConditionInput(c => ({ ...c, required: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCondition('required') } }}
                placeholder="Add condition..."
                className="flex-1 bg-dark-bg border border-dark-border rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none"
              />
              <button onClick={() => addCondition('required')} className="px-2 py-1 text-xs bg-dark-border rounded hover:bg-dark-border/80 text-slate-300">Add</button>
            </div>
          </div>

          {/* Forbidden Conditions */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Forbidden Conditions</label>
            <div className="space-y-1 mb-1">
              {form.forbiddenConditions.map((c, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-slate-300">
                  <span className="flex-1 bg-dark-bg border border-dark-border rounded px-2 py-1">{c}</span>
                  <button onClick={() => removeCondition('forbiddenConditions', i)} className="text-slate-500 hover:text-red-400"><X size={12} /></button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={conditionInput.forbidden}
                onChange={e => setConditionInput(c => ({ ...c, forbidden: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCondition('forbidden') } }}
                placeholder="Add condition..."
                className="flex-1 bg-dark-bg border border-dark-border rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none"
              />
              <button onClick={() => addCondition('forbidden')} className="px-2 py-1 text-xs bg-dark-border rounded hover:bg-dark-border/80 text-slate-300">Add</button>
            </div>
          </div>

          {/* Postconditions */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Postconditions</label>
            <div className="space-y-1 mb-1">
              {form.postconditions.map((c, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-slate-300">
                  <span className="flex-1 bg-dark-bg border border-dark-border rounded px-2 py-1">{c}</span>
                  <button onClick={() => removeCondition('postconditions', i)} className="text-slate-500 hover:text-red-400"><X size={12} /></button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                value={conditionInput.post}
                onChange={e => setConditionInput(c => ({ ...c, post: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCondition('post') } }}
                placeholder="Add postcondition..."
                className="flex-1 bg-dark-bg border border-dark-border rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none"
              />
              <button onClick={() => addCondition('post')} className="px-2 py-1 text-xs bg-dark-border rounded hover:bg-dark-border/80 text-slate-300">Add</button>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-dark-border">
          <button
            onClick={() => setShowModal(false)}
            className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={createMut.isPending || updateMut.isPending}
            className="px-4 py-2 bg-accent-purple hover:bg-accent-purple/80 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {createMut.isPending || updateMut.isPending ? 'Saving...' : editingId ? 'Update' : 'Create'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
