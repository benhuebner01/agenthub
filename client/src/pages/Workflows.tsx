import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  GitBranch,
  Plus,
  Trash2,
  Pencil,
  Play,
  Pause,
  ArrowRight,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  ChevronRight,
  Search,
  Bot,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react'
import {
  getWorkflows,
  getWorkflow,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  startWorkflowRun,
  getOrganizations,
  getAgents,
  Workflow,
  WorkflowStepDef,
  WorkflowRun,
  Agent,
  Organization,
} from '../api/client'
import { useToast } from '../components/Toaster'
import Modal from '../components/Modal'

// ─── Constants ──────────────────────────────────────────────────────────────

const TRIGGER_BADGE: Record<string, string> = {
  manual: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  schedule: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  event: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  goal_activated: 'bg-green-500/20 text-green-400 border-green-500/30',
}

const TRIGGER_LABELS: Record<string, string> = {
  manual: 'Manual',
  schedule: 'Schedule',
  event: 'Event',
  goal_activated: 'Goal Activated',
}

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  active: 'bg-green-500/20 text-green-400 border-green-500/30',
  paused: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  archived: 'bg-gray-500/20 text-gray-500 border-gray-500/30',
}

const RUN_STATUS_BADGE: Record<string, string> = {
  pending: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  running: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  completed: 'bg-green-500/20 text-green-400 border-green-500/30',
  failed: 'bg-red-500/20 text-red-400 border-red-500/30',
  cancelled: 'bg-gray-500/20 text-gray-500 border-gray-500/30',
}

const PAYLOAD_TRANSFORMS = [
  { value: 'full', label: 'Full Output' },
  { value: 'summary', label: 'Summary Only' },
  { value: 'filtered', label: 'Filtered Fields' },
]

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'archived', label: 'Archived' },
]

function formatDate(dt: string | null | undefined): string {
  if (!dt) return '-'
  return new Date(dt).toLocaleString()
}

function generateStepId(): string {
  return 'step_' + Math.random().toString(36).slice(2, 10)
}

// ─── Empty Forms ────────────────────────────────────────────────────────────

const emptyWorkflow = {
  name: '',
  description: '',
  organizationId: '',
  trigger: 'manual' as const,
  steps: [] as WorkflowStepDef[],
}

const emptyStep: WorkflowStepDef = {
  id: '',
  agentId: '',
  action: '',
  payloadTransform: 'full',
  payloadFields: [],
  onSuccess: '',
  onFailure: 'abort',
  maxRetries: 0,
  timeoutMs: 30000,
  approvalRequired: false,
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function Workflows() {
  const qc = useQueryClient()
  const toast = useToast()

  const [statusFilter, setStatusFilter] = useState('')
  const [orgFilter, setOrgFilter] = useState('')
  const [search, setSearch] = useState('')

  const [showBuilder, setShowBuilder] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyWorkflow)

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)

  // Data queries
  const { data: workflows = [], isLoading } = useQuery({
    queryKey: ['workflows', orgFilter],
    queryFn: () => getWorkflows(orgFilter ? { organizationId: orgFilter } : undefined),
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

  // Detail query for expanded workflow
  const { data: expandedWorkflow } = useQuery({
    queryKey: ['workflow', expandedId],
    queryFn: () => getWorkflow(expandedId!),
    enabled: !!expandedId,
  })

  // Mutations
  const createMut = useMutation({
    mutationFn: () => createWorkflow({
      name: form.name,
      description: form.description || undefined,
      organizationId: form.organizationId || undefined,
      trigger: form.trigger,
      steps: form.steps,
    } as any),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflows'] })
      toast.success('Workflow created')
      closeBuilder()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const updateMut = useMutation({
    mutationFn: () => updateWorkflow(editingId!, {
      name: form.name,
      description: form.description || undefined,
      organizationId: form.organizationId || undefined,
      trigger: form.trigger,
      steps: form.steps,
    } as any),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflows'] })
      qc.invalidateQueries({ queryKey: ['workflow', editingId] })
      toast.success('Workflow updated')
      closeBuilder()
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMut = useMutation({
    mutationFn: deleteWorkflow,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflows'] })
      toast.success('Workflow deleted')
      if (expandedId) setExpandedId(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const runMut = useMutation({
    mutationFn: (id: string) => startWorkflowRun(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflows'] })
      if (expandedId) qc.invalidateQueries({ queryKey: ['workflow', expandedId] })
      toast.success('Workflow run started')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => updateWorkflow(id, { status } as any),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflows'] })
      toast.success('Status updated')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // Helpers
  const closeBuilder = useCallback(() => {
    setShowBuilder(false)
    setEditingId(null)
    setForm(emptyWorkflow)
  }, [])

  const openCreate = () => {
    setEditingId(null)
    setForm(emptyWorkflow)
    setShowBuilder(true)
  }

  const openEdit = (wf: Workflow) => {
    setEditingId(wf.id)
    setForm({
      name: wf.name,
      description: wf.description || '',
      organizationId: wf.organizationId || '',
      trigger: wf.trigger,
      steps: (wf.steps || []) as WorkflowStepDef[],
    })
    setShowBuilder(true)
  }

  const addStep = () => {
    const newStep: WorkflowStepDef = {
      ...emptyStep,
      id: generateStepId(),
    }
    setForm(f => ({ ...f, steps: [...f.steps, newStep] }))
  }

  const updateStep = (idx: number, updates: Partial<WorkflowStepDef>) => {
    setForm(f => ({
      ...f,
      steps: f.steps.map((s, i) => i === idx ? { ...s, ...updates } : s),
    }))
  }

  const removeStep = (idx: number) => {
    setForm(f => ({
      ...f,
      steps: f.steps.filter((_, i) => i !== idx),
    }))
  }

  const moveStep = (idx: number, dir: -1 | 1) => {
    const target = idx + dir
    if (target < 0 || target >= form.steps.length) return
    setForm(f => {
      const steps = [...f.steps]
      ;[steps[idx], steps[target]] = [steps[target], steps[idx]]
      return { ...f, steps }
    })
  }

  const agentName = (id: string) => agents.find(a => a.id === id)?.name || id.slice(0, 8)

  // Filtered workflows
  const filtered = workflows.filter((wf: Workflow) => {
    if (statusFilter && wf.status !== statusFilter) return false
    if (search && !wf.name.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <GitBranch className="w-6 h-6 text-accent-purple" />
          <h1 className="text-2xl font-bold text-white">Workflows</h1>
          <span className="text-sm text-slate-500">({filtered.length})</span>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-accent-purple hover:bg-accent-purple/80 text-white rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={16} /> New Workflow
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search workflows..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 pr-4 py-2 bg-dark-card border border-dark-border rounded-lg text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-accent-purple/50 w-64"
          />
        </div>

        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-2 bg-dark-card border border-dark-border rounded-lg text-sm text-slate-200 focus:outline-none focus:border-accent-purple/50"
        >
          {STATUS_OPTIONS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>

        <select
          value={orgFilter}
          onChange={e => setOrgFilter(e.target.value)}
          className="px-3 py-2 bg-dark-card border border-dark-border rounded-lg text-sm text-slate-200 focus:outline-none focus:border-accent-purple/50"
        >
          <option value="">All Organizations</option>
          {orgs.map(o => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </select>
      </div>

      {/* Workflow List */}
      {isLoading ? (
        <div className="text-center py-12 text-slate-500">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <GitBranch className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-400 mb-2">No workflows yet</h3>
          <p className="text-sm text-slate-600">Build automated agent handoff chains</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((wf: Workflow) => (
            <div
              key={wf.id}
              className="bg-dark-card border border-dark-border rounded-xl overflow-hidden"
            >
              {/* Card Header */}
              <div className="p-4 flex items-center gap-4">
                <button
                  onClick={() => setExpandedId(expandedId === wf.id ? null : wf.id)}
                  className="text-slate-400 hover:text-white transition-colors shrink-0"
                >
                  {expandedId === wf.id ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm font-semibold text-white truncate">{wf.name}</h3>
                    <span className={`px-2 py-0.5 text-xs rounded-full border ${STATUS_BADGE[wf.status] || ''}`}>
                      {wf.status}
                    </span>
                    <span className={`px-2 py-0.5 text-xs rounded-full border ${TRIGGER_BADGE[wf.trigger] || ''}`}>
                      {TRIGGER_LABELS[wf.trigger] || wf.trigger}
                    </span>
                  </div>
                  {wf.description && (
                    <p className="text-xs text-slate-500 truncate">{wf.description}</p>
                  )}

                  {/* Step chain visualization */}
                  {(wf.steps && wf.steps.length > 0) && (
                    <div className="flex items-center gap-1 mt-2">
                      {(wf.steps as WorkflowStepDef[]).map((step, i) => (
                        <div key={step.id} className="flex items-center gap-1">
                          <div
                            className="w-6 h-6 rounded-full bg-accent-purple/20 border border-accent-purple/40 flex items-center justify-center"
                            title={`${agentName(step.agentId)}: ${step.action}`}
                          >
                            <span className="text-[10px] text-accent-purple font-bold">{i + 1}</span>
                          </div>
                          {i < (wf.steps as WorkflowStepDef[]).length - 1 && (
                            <ArrowRight size={12} className="text-slate-600" />
                          )}
                        </div>
                      ))}
                      <span className="text-xs text-slate-600 ml-2">
                        {(wf.steps as WorkflowStepDef[]).length} step{(wf.steps as WorkflowStepDef[]).length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  {wf.status === 'active' ? (
                    <button
                      onClick={() => statusMut.mutate({ id: wf.id, status: 'paused' })}
                      className="p-1.5 text-yellow-400 hover:bg-yellow-500/10 rounded-lg transition-colors"
                      title="Pause"
                    >
                      <Pause size={16} />
                    </button>
                  ) : wf.status !== 'archived' ? (
                    <button
                      onClick={() => statusMut.mutate({ id: wf.id, status: 'active' })}
                      className="p-1.5 text-green-400 hover:bg-green-500/10 rounded-lg transition-colors"
                      title="Activate"
                    >
                      <Play size={16} />
                    </button>
                  ) : null}
                  <button
                    onClick={() => runMut.mutate(wf.id)}
                    className="p-1.5 text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                    title="Run Now"
                    disabled={runMut.isPending}
                  >
                    <RefreshCw size={16} className={runMut.isPending ? 'animate-spin' : ''} />
                  </button>
                  <button
                    onClick={() => openEdit(wf)}
                    className="p-1.5 text-slate-400 hover:bg-white/5 rounded-lg transition-colors"
                    title="Edit"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    onClick={() => { if (confirm('Delete this workflow?')) deleteMut.mutate(wf.id) }}
                    className="p-1.5 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              {/* Expanded Detail */}
              {expandedId === wf.id && expandedWorkflow && (
                <div className="border-t border-dark-border p-4 space-y-4">
                  {/* Steps detail */}
                  <div>
                    <h4 className="text-sm font-medium text-slate-300 mb-3">Steps Pipeline</h4>
                    {(!expandedWorkflow.steps || expandedWorkflow.steps.length === 0) ? (
                      <p className="text-xs text-slate-600">No steps defined</p>
                    ) : (
                      <div className="space-y-2">
                        {(expandedWorkflow.steps as WorkflowStepDef[]).map((step, i) => (
                          <div key={step.id} className="flex items-start gap-3">
                            <div className="flex flex-col items-center">
                              <div className="w-8 h-8 rounded-full bg-accent-purple/20 border border-accent-purple/40 flex items-center justify-center">
                                <span className="text-xs text-accent-purple font-bold">{i + 1}</span>
                              </div>
                              {i < (expandedWorkflow.steps as WorkflowStepDef[]).length - 1 && (
                                <div className="w-px h-6 bg-dark-border mt-1" />
                              )}
                            </div>
                            <div className="flex-1 bg-dark-bg rounded-lg p-3 border border-dark-border">
                              <div className="flex items-center gap-2 mb-1">
                                <Bot size={14} className="text-slate-400" />
                                <span className="text-xs font-medium text-slate-200">
                                  {agentName(step.agentId)}
                                </span>
                                {step.approvalRequired && (
                                  <span className="px-1.5 py-0.5 text-[10px] bg-orange-500/20 text-orange-400 border border-orange-500/30 rounded-full">
                                    Approval Required
                                  </span>
                                )}
                                <span className="text-[10px] text-slate-600">
                                  Payload: {step.payloadTransform || 'full'}
                                </span>
                              </div>
                              <p className="text-xs text-slate-400">{step.action}</p>
                              <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-600">
                                {step.onFailure && <span>On fail: {step.onFailure}</span>}
                                {step.maxRetries ? <span>Retries: {step.maxRetries}</span> : null}
                                {step.timeoutMs ? <span>Timeout: {step.timeoutMs}ms</span> : null}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Runs */}
                  <div>
                    <h4 className="text-sm font-medium text-slate-300 mb-3">Recent Runs</h4>
                    {(!expandedWorkflow.runs || expandedWorkflow.runs.length === 0) ? (
                      <p className="text-xs text-slate-600">No runs yet</p>
                    ) : (
                      <div className="space-y-2">
                        {expandedWorkflow.runs.map((run: WorkflowRun) => (
                          <div key={run.id} className="bg-dark-bg rounded-lg border border-dark-border overflow-hidden">
                            <div
                              className="p-3 flex items-center gap-3 cursor-pointer hover:bg-white/[0.02]"
                              onClick={() => setExpandedRunId(expandedRunId === run.id ? null : run.id)}
                            >
                              {expandedRunId === run.id ? <ChevronDown size={14} className="text-slate-500" /> : <ChevronRight size={14} className="text-slate-500" />}
                              <span className="text-xs font-mono text-slate-500">{run.id.slice(0, 8)}</span>
                              <span className={`px-2 py-0.5 text-[10px] rounded-full border ${RUN_STATUS_BADGE[run.status] || ''}`}>
                                {run.status}
                              </span>
                              {run.currentStepId && (
                                <span className="text-[10px] text-slate-600">
                                  Step: {run.currentStepId}
                                </span>
                              )}
                              <span className="text-[10px] text-slate-600 ml-auto">
                                {formatDate(run.startedAt)} {run.completedAt ? `- ${formatDate(run.completedAt)}` : ''}
                              </span>
                            </div>
                            {expandedRunId === run.id && run.stepResults && (
                              <div className="border-t border-dark-border p-3">
                                <p className="text-xs text-slate-400 mb-2">Step Results:</p>
                                <pre className="text-[10px] text-slate-500 bg-black/30 rounded p-2 overflow-x-auto max-h-40">
                                  {JSON.stringify(run.stepResults, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Builder Modal */}
      <Modal open={showBuilder} onClose={closeBuilder} title={editingId ? 'Edit Workflow' : 'New Workflow'} maxWidth="max-w-3xl">
        <div className="space-y-5">
          {/* Basic Fields */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Name *</label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Research & Write Pipeline"
                className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-accent-purple/50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Organization</label>
              <select
                value={form.organizationId}
                onChange={e => setForm(f => ({ ...f, organizationId: e.target.value }))}
                className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-sm text-slate-200 focus:outline-none focus:border-accent-purple/50"
              >
                <option value="">None (standalone)</option>
                {orgs.map(o => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Description</label>
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="What does this workflow accomplish?"
              rows={2}
              className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-accent-purple/50 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Trigger Type</label>
            <select
              value={form.trigger}
              onChange={e => setForm(f => ({ ...f, trigger: e.target.value as any }))}
              className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-sm text-slate-200 focus:outline-none focus:border-accent-purple/50"
            >
              <option value="manual">Manual</option>
              <option value="schedule">Schedule</option>
              <option value="event">Event</option>
              <option value="goal_activated">Goal Activated</option>
            </select>
          </div>

          {/* Step Builder */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-slate-300 flex items-center gap-2">
                <GitBranch size={14} /> Steps Pipeline
              </h3>
              <span className="text-xs text-slate-600">{form.steps.length} step{form.steps.length !== 1 ? 's' : ''}</span>
            </div>

            {form.steps.length === 0 ? (
              <div className="text-center py-8 border border-dashed border-dark-border rounded-lg">
                <p className="text-sm text-slate-600 mb-2">No steps yet</p>
                <p className="text-xs text-slate-700">Add steps to define the agent handoff chain</p>
              </div>
            ) : (
              <div className="space-y-3">
                {form.steps.map((step, idx) => (
                  <div key={step.id} className="bg-dark-bg rounded-lg border border-dark-border p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full bg-accent-purple/20 border border-accent-purple/40 flex items-center justify-center">
                          <span className="text-[10px] text-accent-purple font-bold">{idx + 1}</span>
                        </div>
                        <span className="text-xs font-medium text-slate-300">Step {idx + 1}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => moveStep(idx, -1)}
                          disabled={idx === 0}
                          className="p-1 text-slate-500 hover:text-slate-300 disabled:opacity-30 transition-colors"
                          title="Move up"
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          onClick={() => moveStep(idx, 1)}
                          disabled={idx === form.steps.length - 1}
                          className="p-1 text-slate-500 hover:text-slate-300 disabled:opacity-30 transition-colors"
                          title="Move down"
                        >
                          <ArrowDown size={14} />
                        </button>
                        <button
                          onClick={() => removeStep(idx)}
                          className="p-1 text-red-400 hover:text-red-300 transition-colors"
                          title="Remove step"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="block text-[10px] font-medium text-slate-500 mb-1">Agent *</label>
                        <select
                          value={step.agentId}
                          onChange={e => updateStep(idx, { agentId: e.target.value })}
                          className="w-full px-2 py-1.5 bg-dark-card border border-dark-border rounded text-xs text-slate-200 focus:outline-none focus:border-accent-purple/50"
                        >
                          <option value="">Select agent...</option>
                          {agents.map(a => (
                            <option key={a.id} value={a.id}>{a.name} ({a.role})</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-slate-500 mb-1">Payload Transform</label>
                        <select
                          value={step.payloadTransform || 'full'}
                          onChange={e => updateStep(idx, { payloadTransform: e.target.value })}
                          className="w-full px-2 py-1.5 bg-dark-card border border-dark-border rounded text-xs text-slate-200 focus:outline-none focus:border-accent-purple/50"
                        >
                          {PAYLOAD_TRANSFORMS.map(pt => (
                            <option key={pt.value} value={pt.value}>{pt.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {step.payloadTransform === 'filtered' && (
                      <div className="mb-3">
                        <label className="block text-[10px] font-medium text-slate-500 mb-1">Filtered Fields (comma-separated)</label>
                        <input
                          type="text"
                          value={(step.payloadFields || []).join(', ')}
                          onChange={e => updateStep(idx, { payloadFields: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                          placeholder="e.g. summary, title, data"
                          className="w-full px-2 py-1.5 bg-dark-card border border-dark-border rounded text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-accent-purple/50"
                        />
                      </div>
                    )}

                    <div className="mb-3">
                      <label className="block text-[10px] font-medium text-slate-500 mb-1">Action Description *</label>
                      <textarea
                        value={step.action}
                        onChange={e => updateStep(idx, { action: e.target.value })}
                        placeholder="What should this agent do?"
                        rows={2}
                        className="w-full px-2 py-1.5 bg-dark-card border border-dark-border rounded text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-accent-purple/50 resize-none"
                      />
                    </div>

                    <div className="grid grid-cols-4 gap-3">
                      <div>
                        <label className="block text-[10px] font-medium text-slate-500 mb-1">On Success</label>
                        <select
                          value={step.onSuccess || ''}
                          onChange={e => updateStep(idx, { onSuccess: e.target.value || undefined })}
                          className="w-full px-2 py-1.5 bg-dark-card border border-dark-border rounded text-xs text-slate-200 focus:outline-none focus:border-accent-purple/50"
                        >
                          <option value="">Next / End</option>
                          {form.steps.filter((_, i) => i !== idx).map((s, i) => (
                            <option key={s.id} value={s.id}>Step: {s.id.slice(0, 8)}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-slate-500 mb-1">On Failure</label>
                        <select
                          value={step.onFailure || 'abort'}
                          onChange={e => updateStep(idx, { onFailure: e.target.value })}
                          className="w-full px-2 py-1.5 bg-dark-card border border-dark-border rounded text-xs text-slate-200 focus:outline-none focus:border-accent-purple/50"
                        >
                          <option value="abort">Abort</option>
                          <option value="retry">Retry</option>
                          {form.steps.filter((_, i) => i !== idx).map(s => (
                            <option key={s.id} value={s.id}>Skip to: {s.id.slice(0, 8)}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-slate-500 mb-1">Max Retries</label>
                        <input
                          type="number"
                          min={0}
                          max={10}
                          value={step.maxRetries || 0}
                          onChange={e => updateStep(idx, { maxRetries: parseInt(e.target.value) || 0 })}
                          className="w-full px-2 py-1.5 bg-dark-card border border-dark-border rounded text-xs text-slate-200 focus:outline-none focus:border-accent-purple/50"
                        />
                      </div>
                      <div className="flex items-end pb-0.5">
                        <button
                          onClick={() => updateStep(idx, { approvalRequired: !step.approvalRequired })}
                          className={`flex items-center gap-1.5 text-xs px-2 py-1.5 rounded border transition-colors ${
                            step.approvalRequired
                              ? 'bg-orange-500/10 text-orange-400 border-orange-500/30'
                              : 'bg-dark-card text-slate-500 border-dark-border hover:text-slate-300'
                          }`}
                        >
                          {step.approvalRequired ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
                          Approval
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <button
              onClick={addStep}
              className="w-full mt-3 flex items-center justify-center gap-2 px-4 py-2.5 border border-dashed border-dark-border rounded-lg text-sm text-slate-500 hover:text-slate-300 hover:border-accent-purple/30 transition-colors"
            >
              <Plus size={16} /> Add Step
            </button>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-dark-border">
            <button
              onClick={closeBuilder}
              className="px-4 py-2 text-sm text-slate-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => editingId ? updateMut.mutate() : createMut.mutate()}
              disabled={!form.name || createMut.isPending || updateMut.isPending}
              className="px-4 py-2 bg-accent-purple hover:bg-accent-purple/80 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {editingId ? 'Save Changes' : 'Create Workflow'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
