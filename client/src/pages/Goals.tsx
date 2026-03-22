import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Target,
  Plus,
  ChevronDown,
  ChevronRight,
  Search,
  Brain,
  Sparkles,
  ShieldCheck,
  UserCheck,
  Zap,
  Trash2,
  Play,
  FastForward,
  XCircle,
  CheckCircle2,
  SkipForward,
  Calendar,
  Building2,
  Bot,
  AlertTriangle,
  Clock,
  X,
} from 'lucide-react'
import {
  getGoals,
  getGoal,
  createGoal,
  updateGoal,
  deleteGoal,
  createPlanStep,
  updatePlanStep,
  deletePlanStep,
  activateGoal,
  advanceGoal,
  getOrganizations,
  getAgents,
  Goal,
  PlanStep,
  Organization,
  Agent,
} from '../api/client'
import { useToast } from '../components/Toaster'
import Modal from '../components/Modal'

// ─── Constants ──────────────────────────────────────────────────────────────

const PRIORITY_BADGE: Record<string, string> = {
  critical: 'bg-red-500/20 text-red-400 border-red-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  medium: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  low: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
}

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  active: 'bg-green-500/20 text-green-400 border-green-500/30',
  in_progress: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  blocked: 'bg-red-500/20 text-red-400 border-red-500/30',
  achieved: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  abandoned: 'bg-gray-500/20 text-gray-500 border-gray-500/30',
}

const STEP_STATUS_BADGE: Record<string, string> = {
  pending: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  ready: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  running: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  blocked: 'bg-red-500/20 text-red-400 border-red-500/30',
  failed: 'bg-red-500/20 text-red-400 border-red-500/30',
  verified: 'bg-green-500/20 text-green-400 border-green-500/30',
  completed: 'bg-green-500/20 text-green-400 border-green-500/30',
  skipped: 'bg-gray-500/20 text-gray-500 border-gray-500/30',
}

const STEP_TYPE_ICONS: Record<string, React.ElementType> = {
  research: Search,
  reasoning: Brain,
  generation: Sparkles,
  validation: ShieldCheck,
  approval: UserCheck,
  action: Zap,
}

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'achieved', label: 'Achieved' },
  { value: 'abandoned', label: 'Abandoned' },
]

function formatDate(dt: string | null): string {
  if (!dt) return '-'
  return new Date(dt).toLocaleDateString()
}

// ─── Add Step Form ──────────────────────────────────────────────────────────

function AddStepForm({ goalId, agents, onDone }: { goalId: string; agents: Agent[]; onDone: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<PlanStep['type']>('action')
  const [assignedAgentId, setAssignedAgentId] = useState('')

  const mutation = useMutation({
    mutationFn: () => createPlanStep(goalId, { title, description: description || null, type, assignedAgentId: assignedAgentId || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['goal', goalId] })
      qc.invalidateQueries({ queryKey: ['goals'] })
      toast.success('Step added')
      setTitle('')
      setDescription('')
      onDone()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  return (
    <div className="bg-dark-bg border border-dark-border rounded-lg p-4 space-y-3">
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Add Step</p>
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Step title..."
        className="w-full px-3 py-2 bg-dark-card border border-dark-border rounded-lg text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent-purple/50"
      />
      <input
        type="text"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description (optional)..."
        className="w-full px-3 py-2 bg-dark-card border border-dark-border rounded-lg text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent-purple/50"
      />
      <div className="flex gap-3">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as PlanStep['type'])}
          className="flex-1 px-3 py-2 bg-dark-card border border-dark-border rounded-lg text-sm text-slate-300"
        >
          <option value="research">Research</option>
          <option value="reasoning">Reasoning</option>
          <option value="generation">Generation</option>
          <option value="validation">Validation</option>
          <option value="approval">Approval</option>
          <option value="action">Action</option>
        </select>
        <select
          value={assignedAgentId}
          onChange={(e) => setAssignedAgentId(e.target.value)}
          className="flex-1 px-3 py-2 bg-dark-card border border-dark-border rounded-lg text-sm text-slate-300"
        >
          <option value="">No agent assigned</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onDone} className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors">Cancel</button>
        <button
          onClick={() => mutation.mutate()}
          disabled={!title.trim() || mutation.isPending}
          className="px-4 py-1.5 bg-accent-purple hover:bg-purple-600 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
        >
          Add Step
        </button>
      </div>
    </div>
  )
}

// ─── Step Row ───────────────────────────────────────────────────────────────

function StepRow({ step, goalId, agents }: { step: PlanStep; goalId: string; agents: Agent[] }) {
  const qc = useQueryClient()
  const toast = useToast()
  const Icon = STEP_TYPE_ICONS[step.type] || Zap
  const agentName = step.assignedAgentId ? agents.find((a) => a.id === step.assignedAgentId)?.name : null

  const updateMut = useMutation({
    mutationFn: (data: Partial<PlanStep>) => updatePlanStep(goalId, step.id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['goal', goalId] })
      qc.invalidateQueries({ queryKey: ['goals'] })
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteMut = useMutation({
    mutationFn: () => deletePlanStep(goalId, step.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['goal', goalId] })
      qc.invalidateQueries({ queryKey: ['goals'] })
      toast.success('Step deleted')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const isRunning = step.status === 'running'
  const isTerminal = ['completed', 'verified', 'skipped', 'failed'].includes(step.status)

  return (
    <div className={`flex items-center gap-3 px-4 py-3 bg-dark-card border border-dark-border rounded-lg transition-all ${step.status === 'skipped' ? 'opacity-50 line-through' : ''} ${isRunning ? 'ring-1 ring-blue-500/40' : ''}`}>
      <span className="text-xs font-mono text-slate-600 w-6 text-right shrink-0">#{step.order}</span>
      <Icon className="w-4 h-4 shrink-0 text-slate-400" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-200 truncate">{step.title}</p>
        {step.description && <p className="text-xs text-slate-500 truncate mt-0.5">{step.description}</p>}
        {agentName && (
          <span className="inline-flex items-center gap-1 text-xs text-slate-500 mt-0.5">
            <Bot className="w-3 h-3" /> {agentName}
          </span>
        )}
        {step.dependsOn && step.dependsOn.length > 0 && (
          <span className="text-xs text-slate-600 ml-2">depends on {step.dependsOn.length} step(s)</span>
        )}
      </div>
      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border shrink-0 ${STEP_STATUS_BADGE[step.status] || STEP_STATUS_BADGE.pending}`}>
        {isRunning && (
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-400" />
          </span>
        )}
        {step.status}
      </span>
      {!isTerminal && (
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => updateMut.mutate({ status: 'completed' })}
            disabled={updateMut.isPending}
            title="Mark Complete"
            className="p-1 rounded text-slate-500 hover:text-green-400 hover:bg-green-500/10 transition-colors"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => updateMut.mutate({ status: 'failed' })}
            disabled={updateMut.isPending}
            title="Mark Failed"
            className="p-1 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <XCircle className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => updateMut.mutate({ status: 'skipped' })}
            disabled={updateMut.isPending}
            title="Skip"
            className="p-1 rounded text-slate-500 hover:text-gray-400 hover:bg-gray-500/10 transition-colors"
          >
            <SkipForward className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      <button
        onClick={() => deleteMut.mutate()}
        disabled={deleteMut.isPending}
        title="Delete step"
        className="p-1 rounded text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ─── Goal Detail Panel ──────────────────────────────────────────────────────

function GoalDetail({ goalId, agents, orgMap, onClose }: { goalId: string; agents: Agent[]; orgMap: Map<string, string>; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [showAddStep, setShowAddStep] = useState(false)

  const { data: goal, isLoading } = useQuery({
    queryKey: ['goal', goalId],
    queryFn: () => getGoal(goalId),
  })

  const activateMut = useMutation({
    mutationFn: () => activateGoal(goalId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['goal', goalId] })
      qc.invalidateQueries({ queryKey: ['goals'] })
      toast.success('Goal activated')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const advanceMut = useMutation({
    mutationFn: () => advanceGoal(goalId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['goal', goalId] })
      qc.invalidateQueries({ queryKey: ['goals'] })
      toast.success('Plan advanced')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const abandonMut = useMutation({
    mutationFn: () => updateGoal(goalId, { status: 'abandoned' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['goal', goalId] })
      qc.invalidateQueries({ queryKey: ['goals'] })
      toast.success('Goal abandoned')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  if (isLoading || !goal) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-8 h-8 border-2 border-accent-purple border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const steps = (goal.steps || []).sort((a, b) => a.order - b.order)
  const completedSteps = steps.filter((s) => ['completed', 'verified'].includes(s.status)).length
  const orgName = goal.organizationId ? orgMap.get(goal.organizationId) : null
  const agentName = goal.agentId ? agents.find((a) => a.id === goal.agentId)?.name : null
  const canActivate = goal.status === 'draft'
  const canAdvance = ['active', 'in_progress'].includes(goal.status)
  const canAbandon = !['achieved', 'abandoned'].includes(goal.status)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${PRIORITY_BADGE[goal.priority]}`}>
            {goal.priority}
          </span>
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_BADGE[goal.status]}`}>
            {goal.status.replace('_', ' ')}
          </span>
        </div>
        {goal.description && <p className="text-sm text-slate-400 mt-2">{goal.description}</p>}
        <div className="flex flex-wrap gap-4 mt-3 text-xs text-slate-500">
          {orgName && (
            <span className="inline-flex items-center gap-1"><Building2 className="w-3 h-3" /> {orgName}</span>
          )}
          {agentName && (
            <span className="inline-flex items-center gap-1"><Bot className="w-3 h-3" /> {agentName}</span>
          )}
          {goal.deadline && (
            <span className="inline-flex items-center gap-1"><Calendar className="w-3 h-3" /> Deadline: {formatDate(goal.deadline)}</span>
          )}
          {goal.measurableTarget && (
            <span className="inline-flex items-center gap-1"><Target className="w-3 h-3" /> {goal.measurableTarget}</span>
          )}
        </div>
      </div>

      {/* Progress */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-slate-500">Progress</span>
          <span className="text-xs text-slate-400">{goal.progress}%</span>
        </div>
        <div className="w-full h-2 bg-dark-bg rounded-full overflow-hidden">
          <div
            className="h-full bg-accent-purple rounded-full transition-all duration-500"
            style={{ width: `${goal.progress}%` }}
          />
        </div>
      </div>

      {/* Success Criteria */}
      {goal.successCriteria && goal.successCriteria.length > 0 && (
        <div>
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Success Criteria</p>
          <ul className="space-y-1">
            {goal.successCriteria.map((c, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-green-500 shrink-0" />
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Constraints */}
      {goal.constraints && goal.constraints.length > 0 && (
        <div>
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Constraints</p>
          <ul className="space-y-1">
            {goal.constraints.map((c, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-yellow-500 shrink-0" />
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Plan Steps */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">
            Plan Steps ({completedSteps}/{steps.length} completed)
          </p>
          <button
            onClick={() => setShowAddStep(true)}
            className="flex items-center gap-1 text-xs text-accent-purple hover:text-purple-400 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add Step
          </button>
        </div>
        {steps.length === 0 && !showAddStep ? (
          <p className="text-sm text-slate-500">No steps yet. Add steps to create a plan.</p>
        ) : (
          <div className="space-y-2">
            {steps.map((step) => (
              <StepRow key={step.id} step={step} goalId={goalId} agents={agents} />
            ))}
          </div>
        )}
        {showAddStep && (
          <div className="mt-3">
            <AddStepForm goalId={goalId} agents={agents} onDone={() => setShowAddStep(false)} />
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-3 pt-2 border-t border-dark-border">
        {canActivate && (
          <button
            onClick={() => activateMut.mutate()}
            disabled={activateMut.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
          >
            <Play className="w-4 h-4" /> Activate Goal
          </button>
        )}
        {canAdvance && (
          <button
            onClick={() => advanceMut.mutate()}
            disabled={advanceMut.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
          >
            <FastForward className="w-4 h-4" /> Advance Plan
          </button>
        )}
        {canAbandon && (
          <button
            onClick={() => abandonMut.mutate()}
            disabled={abandonMut.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-red-500/10 text-slate-400 hover:text-red-400 text-sm rounded-lg border border-dark-border transition-colors ml-auto"
          >
            <XCircle className="w-4 h-4" /> Abandon
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Create Goal Form ───────────────────────────────────────────────────────

function CreateGoalForm({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<Goal['priority']>('medium')
  const [organizationId, setOrganizationId] = useState('')
  const [agentId, setAgentId] = useState('')
  const [deadline, setDeadline] = useState('')
  const [measurableTarget, setMeasurableTarget] = useState('')
  const [successCriteria, setSuccessCriteria] = useState<string[]>([])
  const [newCriteria, setNewCriteria] = useState('')
  const [constraints, setConstraints] = useState<string[]>([])
  const [newConstraint, setNewConstraint] = useState('')

  const { data: orgsData } = useQuery({ queryKey: ['organizations'], queryFn: getOrganizations })
  const orgs = orgsData?.data ?? []

  const agentParams = organizationId ? { organizationId } : undefined
  const { data: agentsData } = useQuery({
    queryKey: ['agents', { organizationId: organizationId || undefined }],
    queryFn: () => getAgents(agentParams),
  })
  const agents = agentsData?.data ?? []

  const mutation = useMutation({
    mutationFn: () =>
      createGoal({
        title,
        description: description || null,
        priority,
        organizationId: organizationId || null,
        agentId: agentId || null,
        deadline: deadline || null,
        measurableTarget: measurableTarget || null,
        successCriteria: successCriteria.length > 0 ? successCriteria : null,
        constraints: constraints.length > 0 ? constraints : null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['goals'] })
      toast.success('Goal created')
      onClose()
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const addCriteria = () => {
    if (newCriteria.trim()) {
      setSuccessCriteria([...successCriteria, newCriteria.trim()])
      setNewCriteria('')
    }
  }

  const addConstraint = () => {
    if (newConstraint.trim()) {
      setConstraints([...constraints, newConstraint.trim()])
      setNewConstraint('')
    }
  }

  return (
    <div className="space-y-4">
      {/* Title */}
      <div>
        <label className="block text-xs text-slate-400 mb-1">Title *</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What should your agents achieve?"
          className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent-purple/50"
        />
      </div>

      {/* Description */}
      <div>
        <label className="block text-xs text-slate-400 mb-1">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Describe the goal in detail..."
          className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent-purple/50 resize-none"
        />
      </div>

      {/* Priority + Deadline row */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Priority</label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value as Goal['priority'])}
            className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-sm text-slate-300"
          >
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Deadline</label>
          <input
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-sm text-slate-300 focus:outline-none focus:border-accent-purple/50"
          />
        </div>
      </div>

      {/* Organization + Agent */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-slate-400 mb-1">Organization</label>
          <select
            value={organizationId}
            onChange={(e) => { setOrganizationId(e.target.value); setAgentId('') }}
            className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-sm text-slate-300"
          >
            <option value="">None</option>
            {orgs.map((o: Organization) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-slate-400 mb-1">Assigned Agent</label>
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-sm text-slate-300"
          >
            <option value="">None</option>
            {agents.map((a: Agent) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Measurable Target */}
      <div>
        <label className="block text-xs text-slate-400 mb-1">Measurable Target</label>
        <input
          type="text"
          value={measurableTarget}
          onChange={(e) => setMeasurableTarget(e.target.value)}
          placeholder="e.g. Increase revenue by 20%"
          className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent-purple/50"
        />
      </div>

      {/* Success Criteria */}
      <div>
        <label className="block text-xs text-slate-400 mb-1">Success Criteria</label>
        <div className="space-y-1.5 mb-2">
          {successCriteria.map((c, i) => (
            <div key={i} className="flex items-center gap-2 text-sm text-slate-300 bg-dark-bg rounded-lg px-3 py-1.5 border border-dark-border">
              <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0" />
              <span className="flex-1">{c}</span>
              <button onClick={() => setSuccessCriteria(successCriteria.filter((_, j) => j !== i))} className="text-slate-600 hover:text-red-400 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={newCriteria}
            onChange={(e) => setNewCriteria(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addCriteria()}
            placeholder="Add a success criterion..."
            className="flex-1 px-3 py-1.5 bg-dark-bg border border-dark-border rounded-lg text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent-purple/50"
          />
          <button onClick={addCriteria} className="px-3 py-1.5 text-xs text-accent-purple hover:text-purple-400 border border-dark-border rounded-lg transition-colors">
            Add
          </button>
        </div>
      </div>

      {/* Constraints */}
      <div>
        <label className="block text-xs text-slate-400 mb-1">Constraints</label>
        <div className="space-y-1.5 mb-2">
          {constraints.map((c, i) => (
            <div key={i} className="flex items-center gap-2 text-sm text-slate-300 bg-dark-bg rounded-lg px-3 py-1.5 border border-dark-border">
              <AlertTriangle className="w-3.5 h-3.5 text-yellow-500 shrink-0" />
              <span className="flex-1">{c}</span>
              <button onClick={() => setConstraints(constraints.filter((_, j) => j !== i))} className="text-slate-600 hover:text-red-400 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={newConstraint}
            onChange={(e) => setNewConstraint(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addConstraint()}
            placeholder="Add a constraint..."
            className="flex-1 px-3 py-1.5 bg-dark-bg border border-dark-border rounded-lg text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent-purple/50"
          />
          <button onClick={addConstraint} className="px-3 py-1.5 text-xs text-accent-purple hover:text-purple-400 border border-dark-border rounded-lg transition-colors">
            Add
          </button>
        </div>
      </div>

      {/* Buttons */}
      <div className="flex gap-3 pt-2">
        <button
          onClick={() => mutation.mutate()}
          disabled={!title.trim() || mutation.isPending}
          className="flex-1 px-4 py-2.5 bg-accent-purple hover:bg-purple-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          Create Goal
        </button>
        <button
          onClick={onClose}
          className="px-4 py-2.5 bg-white/5 hover:bg-white/10 text-slate-300 text-sm font-medium rounded-lg border border-dark-border transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Goal Card ──────────────────────────────────────────────────────────────

function GoalCard({ goal, orgMap, agentMap, onSelect, isSelected }: {
  goal: Goal
  orgMap: Map<string, string>
  agentMap: Map<string, string>
  onSelect: (id: string | null) => void
  isSelected: boolean
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const deleteMut = useMutation({
    mutationFn: () => deleteGoal(goal.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['goals'] })
      toast.success('Goal deleted')
      onSelect(null)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const steps = goal.steps || []
  const completedSteps = steps.filter((s) => ['completed', 'verified'].includes(s.status)).length
  const orgName = goal.organizationId ? orgMap.get(goal.organizationId) : null
  const agentName = goal.agentId ? agentMap.get(goal.agentId) : null

  return (
    <>
      <div
        onClick={() => onSelect(isSelected ? null : goal.id)}
        className={`bg-dark-card border rounded-xl p-5 cursor-pointer transition-all duration-200 hover:border-accent-purple/40 ${isSelected ? 'border-accent-purple/60 ring-1 ring-accent-purple/20' : 'border-dark-border'}`}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="text-sm font-semibold text-slate-200 truncate">{goal.title}</h3>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border shrink-0 ${PRIORITY_BADGE[goal.priority]}`}>
                {goal.priority}
              </span>
            </div>
            {goal.description && (
              <p className="text-xs text-slate-500 line-clamp-2 mt-1">{goal.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2 ml-3 shrink-0">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_BADGE[goal.status]}`}>
              {goal.status.replace('_', ' ')}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmDelete(true) }}
              title="Delete"
              className="p-1 rounded text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-slate-500">{goal.progress}% complete</span>
            {steps.length > 0 && (
              <span className="text-xs text-slate-500">{completedSteps}/{steps.length} steps</span>
            )}
          </div>
          <div className="w-full h-1.5 bg-dark-bg rounded-full overflow-hidden">
            <div
              className="h-full bg-accent-purple rounded-full transition-all duration-500"
              style={{ width: `${goal.progress}%` }}
            />
          </div>
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-3 text-xs text-slate-500">
          {orgName && (
            <span className="inline-flex items-center gap-1">
              <Building2 className="w-3 h-3" /> {orgName}
            </span>
          )}
          {agentName && (
            <span className="inline-flex items-center gap-1">
              <Bot className="w-3 h-3" /> {agentName}
            </span>
          )}
          {goal.deadline && (
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3 h-3" /> {formatDate(goal.deadline)}
            </span>
          )}
          <span className="ml-auto text-slate-600">
            {isSelected ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </span>
        </div>
      </div>

      {/* Delete confirm */}
      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete Goal" maxWidth="max-w-sm">
        <p className="text-sm text-slate-300 mb-4">
          Are you sure you want to delete <strong className="text-white">"{goal.title}"</strong>? This will also remove all plan steps.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => { deleteMut.mutate(); setConfirmDelete(false) }}
            disabled={deleteMut.isPending}
            className="flex-1 px-4 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Delete
          </button>
          <button
            onClick={() => setConfirmDelete(false)}
            className="px-4 py-2.5 bg-white/5 hover:bg-white/10 text-slate-300 text-sm font-medium rounded-lg border border-dark-border transition-colors"
          >
            Cancel
          </button>
        </div>
      </Modal>
    </>
  )
}

// ─── Main Goals Page ────────────────────────────────────────────────────────

export default function Goals() {
  const [createOpen, setCreateOpen] = useState(false)
  const [filterStatus, setFilterStatus] = useState('')
  const [filterOrgId, setFilterOrgId] = useState('')
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(null)

  const { data: goalsData, isLoading, error } = useQuery({
    queryKey: ['goals', { status: filterStatus || undefined, organizationId: filterOrgId || undefined }],
    queryFn: () => getGoals({ status: filterStatus || undefined, organizationId: filterOrgId || undefined }),
    refetchInterval: 15_000,
  })

  const { data: orgsData } = useQuery({ queryKey: ['organizations'], queryFn: getOrganizations })
  const { data: agentsData } = useQuery({ queryKey: ['agents'], queryFn: () => getAgents() })

  const goals = Array.isArray(goalsData) ? goalsData : []
  const orgs = orgsData?.data ?? []
  const agents = agentsData?.data ?? []
  const orgMap = new Map(orgs.map((o: Organization) => [o.id, o.name]))
  const agentMap = new Map(agents.map((a: Agent) => [a.id, a.name]))

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Target className="w-6 h-6 text-accent-purple" />
            <h1 className="text-2xl font-bold text-white">Goals & Plans</h1>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            {isLoading ? 'Loading...' : `${goals.length} goal${goals.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-3 py-2 bg-dark-card border border-dark-border rounded-lg text-sm text-slate-300"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {orgs.length > 0 && (
            <select
              value={filterOrgId}
              onChange={(e) => setFilterOrgId(e.target.value)}
              className="px-3 py-2 bg-dark-card border border-dark-border rounded-lg text-sm text-slate-300"
            >
              <option value="">All Organizations</option>
              {orgs.map((o: Organization) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          )}
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-accent-purple hover:bg-purple-600 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Goal
          </button>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-2 border-accent-purple border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="bg-dark-card border border-dark-border rounded-xl flex items-center justify-center h-48 text-red-400">
          <p className="text-sm">Failed to load goals. Check your connection.</p>
        </div>
      ) : goals.length === 0 ? (
        <div className="bg-dark-card border border-dark-border rounded-xl flex flex-col items-center justify-center py-16 text-slate-500">
          <Target className="w-14 h-14 mb-4 opacity-30" />
          <p className="text-sm font-medium text-slate-300">No goals yet</p>
          <p className="text-xs mt-1 mb-6 text-slate-500 max-w-sm text-center">
            Define what your agents should achieve and create structured plans to get there.
          </p>
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-accent-purple hover:bg-purple-600 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Target className="w-4 h-4" />
            Create First Goal
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Goal list */}
          <div className="space-y-3">
            {goals.map((goal: Goal) => (
              <GoalCard
                key={goal.id}
                goal={goal}
                orgMap={orgMap}
                agentMap={agentMap}
                onSelect={setSelectedGoalId}
                isSelected={selectedGoalId === goal.id}
              />
            ))}
          </div>

          {/* Detail panel */}
          <div className="lg:sticky lg:top-20 lg:self-start">
            {selectedGoalId ? (
              <div className="bg-dark-card border border-dark-border rounded-xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-slate-100">Goal Details</h2>
                  <button
                    onClick={() => setSelectedGoalId(null)}
                    className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/10 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <GoalDetail
                  goalId={selectedGoalId}
                  agents={agents}
                  orgMap={orgMap}
                  onClose={() => setSelectedGoalId(null)}
                />
              </div>
            ) : (
              <div className="bg-dark-card border border-dark-border rounded-xl flex flex-col items-center justify-center py-16 text-slate-500">
                <Target className="w-10 h-10 mb-3 opacity-20" />
                <p className="text-sm text-slate-400">Select a goal to view details</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create Modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create Goal" maxWidth="max-w-2xl">
        <CreateGoalForm onClose={() => setCreateOpen(false)} />
      </Modal>
    </div>
  )
}
