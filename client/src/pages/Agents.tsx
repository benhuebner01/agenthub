import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  Play,
  Pencil,
  Trash2,
  Pause,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  Bot,
  Globe,
  Terminal,
  Cpu,
  Building2,
  Send,
  Download,
  FileText,
  Loader2,
  MessageSquare,
} from 'lucide-react'
import {
  getAgents,
  getOrganizations,
  deleteAgent,
  updateAgent,
  runAgent,
  getAgentRuns,
  getAgentSoulMd,
  Agent,
} from '../api/client'
import { useToast } from '../components/Toaster'
import StatusBadge from '../components/StatusBadge'
import Modal from '../components/Modal'
import AgentForm from '../components/AgentForm'

const TYPE_ICONS: Record<string, React.ElementType> = {
  http: Globe,
  claude: Cpu,
  openai: Cpu,
  bash: Terminal,
}

const ROLE_BADGE: Record<string, string> = {
  ceo: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  manager: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  worker: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  specialist: 'bg-green-500/20 text-green-300 border-green-500/30',
}

function formatDate(dt: string | null): string {
  if (!dt) return '-'
  return new Date(dt).toLocaleString()
}

function AgentRow({
  agent,
  orgMap,
}: {
  agent: Agent & { parentAgentName?: string | null; childrenCount?: number }
  orgMap: Map<string, string>
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const [expanded, setExpanded] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const [showChat, setShowChat] = useState(false)
  const [chatInput, setChatInput] = useState('What is 2+2?')
  const [chatResponse, setChatResponse] = useState<string | null>(null)
  const [chatLoading, setChatLoading] = useState(false)
  const [docsLoading, setDocsLoading] = useState(false)

  const Icon = TYPE_ICONS[agent.type] ?? Bot

  const { data: agentRunsData, isLoading: runsLoading } = useQuery({
    queryKey: ['agentRuns', agent.id],
    queryFn: () => getAgentRuns(agent.id, 5, 0),
    enabled: expanded,
  })

  const handleTestChat = async () => {
    if (!chatInput.trim()) return
    setChatLoading(true)
    setChatResponse(null)
    try {
      const result = await runAgent(agent.id, chatInput.trim())
      const run = result.data
      // Poll for completion (simple approach: wait then fetch)
      setChatResponse(
        run.output
          ? typeof run.output === 'string' ? run.output : JSON.stringify(run.output, null, 2)
          : run.error || `Run started (status: ${run.status}). Check Runs page for result.`
      )
      qc.invalidateQueries({ queryKey: ['runs'] })
      qc.invalidateQueries({ queryKey: ['agentRuns', agent.id] })
    } catch (err: any) {
      setChatResponse(`Error: ${err.message}`)
    } finally {
      setChatLoading(false)
    }
  }

  const handleDownloadDocs = async () => {
    setDocsLoading(true)
    try {
      const r = await getAgentSoulMd(agent.id)
      const d = r.data
      const files = [
        { name: 'SOUL.md', content: d.soulMd },
        { name: 'HEARTBEAT.md', content: d.heartbeatMd },
        { name: 'BOOTSTRAP.md', content: d.bootstrapMd },
      ]
      for (const f of files) {
        const blob = new Blob([f.content], { type: 'text/markdown' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${agent.name.replace(/\s+/g, '_')}_${f.name}`
        a.click()
        URL.revokeObjectURL(url)
      }
      toast.success('Files downloaded')
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setDocsLoading(false)
    }
  }

  const deleteMutation = useMutation({
    mutationFn: () => deleteAgent(agent.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] })
      toast.success(`Agent "${agent.name}" deleted`)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const toggleMutation = useMutation({
    mutationFn: () =>
      updateAgent(agent.id, {
        status: agent.status === 'paused' ? 'active' : 'paused',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['agents'] })
      toast.success(`Agent ${agent.status === 'paused' ? 'resumed' : 'paused'}`)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const runMutation = useMutation({
    mutationFn: () => runAgent(agent.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['runs'] })
      qc.invalidateQueries({ queryKey: ['agentRuns', agent.id] })
      toast.success(`Agent "${agent.name}" triggered`)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const orgName = agent.organizationId ? orgMap.get(agent.organizationId) : null

  return (
    <>
      <tr className="border-b border-dark-border hover:bg-white/3 transition-colors">
        <td className="px-5 py-3">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-2 text-left"
          >
            {expanded ? (
              <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
            ) : (
              <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
            )}
            <div>
              <div className="flex items-center gap-2">
                <p className="text-slate-200 font-medium">{agent.name}</p>
                {agent.role && agent.role !== 'worker' && (
                  <span className={`text-xs px-1.5 py-0.5 rounded border font-medium ${ROLE_BADGE[agent.role] || ''}`}>
                    {agent.role.toUpperCase()}
                  </span>
                )}
              </div>
              {agent.description && (
                <p className="text-xs text-slate-500 mt-0.5 max-w-xs truncate">
                  {agent.description}
                </p>
              )}
              {agent.parentAgentName && (
                <p className="text-xs text-slate-600 mt-0.5">
                  Reports to: {agent.parentAgentName}
                </p>
              )}
            </div>
          </button>
        </td>
        <td className="px-5 py-3">
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
            <Icon className="w-3.5 h-3.5" />
            {agent.type}
          </span>
        </td>
        <td className="px-5 py-3">
          <StatusBadge status={agent.status} />
        </td>
        <td className="px-5 py-3">
          {orgName ? (
            <span className="inline-flex items-center gap-1 text-xs text-slate-400">
              <Building2 className="w-3 h-3" />
              {orgName}
            </span>
          ) : (
            <span className="text-xs text-slate-600">—</span>
          )}
        </td>
        <td className="px-5 py-3 text-xs text-slate-500">{formatDate(agent.createdAt)}</td>
        <td className="px-5 py-3">
          <div className="flex items-center gap-1">
            <button
              onClick={() => runMutation.mutate()}
              disabled={runMutation.isPending || agent.status === 'paused'}
              title="Run now"
              className="p-1.5 rounded-lg text-slate-400 hover:text-green-400 hover:bg-green-500/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <Play className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowChat((v) => !v)}
              title="Test / Chat"
              className="p-1.5 rounded-lg text-slate-400 hover:text-accent-purple hover:bg-accent-purple/10 transition-colors"
            >
              <MessageSquare className="w-4 h-4" />
            </button>
            <button
              onClick={handleDownloadDocs}
              disabled={docsLoading}
              title="Download SOUL/HEARTBEAT/BOOTSTRAP files"
              className="p-1.5 rounded-lg text-slate-400 hover:text-cyan-400 hover:bg-cyan-500/10 disabled:opacity-30 transition-colors"
            >
              {docsLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            </button>
            <button
              onClick={() => setEditOpen(true)}
              title="Edit"
              className="p-1.5 rounded-lg text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              onClick={() => toggleMutation.mutate()}
              disabled={toggleMutation.isPending}
              title={agent.status === 'paused' ? 'Resume' : 'Pause'}
              className="p-1.5 rounded-lg text-slate-400 hover:text-yellow-400 hover:bg-yellow-500/10 disabled:opacity-30 transition-colors"
            >
              {agent.status === 'paused' ? (
                <RotateCcw className="w-4 h-4" />
              ) : (
                <Pause className="w-4 h-4" />
              )}
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              title="Delete"
              className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </td>
      </tr>

      {/* Expanded runs */}
      {expanded && (
        <tr className="border-b border-dark-border bg-dark-bg/50">
          <td colSpan={6} className="px-10 py-4">
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">
              Last 5 Runs
            </p>
            {runsLoading ? (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <div className="w-4 h-4 border border-accent-purple border-t-transparent rounded-full animate-spin" />
                Loading...
              </div>
            ) : !agentRunsData?.data.length ? (
              <p className="text-xs text-slate-500">No runs yet for this agent.</p>
            ) : (
              <div className="space-y-1.5">
                {agentRunsData.data.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center gap-4 text-xs bg-dark-card rounded-lg px-3 py-2 border border-dark-border"
                  >
                    <StatusBadge status={r.status} />
                    <span className="text-slate-400 font-mono">{r.id.slice(0, 8)}...</span>
                    <span className="text-slate-500">{r.triggeredBy}</span>
                    <span className="text-slate-500 ml-auto">
                      {r.createdAt ? formatDate(r.createdAt) : '-'}
                    </span>
                    {r.error && (
                      <span className="text-red-400 truncate max-w-xs">{r.error}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </td>
        </tr>
      )}

      {/* Test / Chat Panel */}
      {showChat && (
        <tr className="border-b border-dark-border bg-accent-purple/5">
          <td colSpan={6} className="px-6 py-4">
            <div className="max-w-2xl">
              <p className="text-xs font-medium text-accent-purple uppercase tracking-wider mb-2">
                Test Agent
              </p>
              <div className="flex gap-2 mb-3">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleTestChat()}
                  placeholder="Type a message to test this agent..."
                  className="flex-1 px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent-purple/50"
                />
                <button
                  onClick={handleTestChat}
                  disabled={chatLoading || !chatInput.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 bg-accent-purple hover:bg-purple-600 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
                >
                  {chatLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Send
                </button>
              </div>
              {chatResponse && (
                <div className="bg-dark-bg border border-dark-border rounded-lg p-3">
                  <p className="text-xs font-medium text-slate-500 mb-1">Response</p>
                  <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap max-h-48 overflow-auto">
                    {chatResponse}
                  </pre>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}

      {/* Edit Modal */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit Agent" maxWidth="max-w-3xl">
        <AgentForm agent={agent} onClose={() => setEditOpen(false)} />
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete Agent"
        maxWidth="max-w-sm"
      >
        <p className="text-sm text-slate-300 mb-4">
          Are you sure you want to delete{' '}
          <strong className="text-white">"{agent.name}"</strong>? This will also remove all
          associated schedules.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => {
              deleteMutation.mutate()
              setConfirmDelete(false)
            }}
            disabled={deleteMutation.isPending}
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

export default function Agents() {
  const [createOpen, setCreateOpen] = useState(false)
  const [filterOrgId, setFilterOrgId] = useState<string>('')
  const [filterRole, setFilterRole] = useState<string>('')

  const { data, isLoading, error } = useQuery({
    queryKey: ['agents', { organizationId: filterOrgId || undefined, role: filterRole || undefined }],
    queryFn: () => getAgents({ organizationId: filterOrgId || undefined, role: filterRole || undefined }),
    refetchInterval: 30_000,
  })

  const { data: orgsData } = useQuery({
    queryKey: ['organizations'],
    queryFn: getOrganizations,
  })

  const agents = data?.data ?? []
  const orgs = orgsData?.data ?? []
  const orgMap = new Map(orgs.map((o) => [o.id, o.name]))

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Agents</h1>
          <p className="text-sm text-slate-400 mt-1">
            {data ? `${data.total} agent${data.total !== 1 ? 's' : ''}` : 'Loading...'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {orgs.length > 0 && (
            <select
              value={filterOrgId}
              onChange={(e) => setFilterOrgId(e.target.value)}
              className="px-3 py-2 bg-dark-card border border-dark-border rounded-lg text-sm text-slate-300"
            >
              <option value="">All Organizations</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          )}
          <select
            value={filterRole}
            onChange={(e) => setFilterRole(e.target.value)}
            className="px-3 py-2 bg-dark-card border border-dark-border rounded-lg text-sm text-slate-300"
          >
            <option value="">All Roles</option>
            <option value="ceo">CEO</option>
            <option value="manager">Manager</option>
            <option value="worker">Worker</option>
            <option value="specialist">Specialist</option>
          </select>
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-accent-purple hover:bg-purple-600 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Agent
          </button>
        </div>
      </div>

      <div className="bg-dark-card border border-dark-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-2 border-accent-purple border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-48 text-red-400">
            <p className="text-sm">Failed to load agents. Check your connection.</p>
          </div>
        ) : agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-500">
            <Bot className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm font-medium">No agents yet</p>
            <p className="text-xs mt-1">Create your first agent to get started</p>
            <button
              onClick={() => setCreateOpen(true)}
              className="mt-4 flex items-center gap-2 px-4 py-2 bg-accent-purple/20 hover:bg-accent-purple/30 text-accent-purple text-sm rounded-lg border border-accent-purple/30 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Create Agent
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-border">
                  <th className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Name
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Organization
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Created
                  </th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => (
                  <AgentRow key={agent.id} agent={agent} orgMap={orgMap} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create Agent" maxWidth="max-w-3xl">
        <AgentForm onClose={() => setCreateOpen(false)} />
      </Modal>
    </div>
  )
}
