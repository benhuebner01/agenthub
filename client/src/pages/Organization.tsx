import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Building2,
  Play,
  CheckCircle,
  XCircle,
  Users,
  Sparkles,
  ClipboardList,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  getOrganizations,
  getOrgChart,
  getProposals,
  approveProposal,
  rejectProposal,
  runCeo,
  OrgChartNode,
  Proposal,
  Organization,
} from '../api/client'
import { useToast } from '../components/Toaster'

// ─── Role Styles ──────────────────────────────────────────────────────────────

const ROLE_STYLES: Record<string, { border: string; badge: string; bg: string }> = {
  ceo: {
    border: 'border-yellow-500/60',
    badge: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
    bg: 'bg-yellow-500/5',
  },
  manager: {
    border: 'border-purple-500/60',
    badge: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
    bg: 'bg-purple-500/5',
  },
  worker: {
    border: 'border-blue-500/60',
    badge: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
    bg: 'bg-blue-500/5',
  },
  specialist: {
    border: 'border-green-500/60',
    badge: 'bg-green-500/20 text-green-300 border-green-500/30',
    bg: 'bg-green-500/5',
  },
}

const STATUS_DOT: Record<string, string> = {
  active: 'bg-green-500',
  paused: 'bg-yellow-500',
  error: 'bg-red-500',
}

// ─── Org Chart Node ───────────────────────────────────────────────────────────

function OrgNode({
  node,
  onSelect,
  selected,
}: {
  node: OrgChartNode
  onSelect: (node: OrgChartNode) => void
  selected: OrgChartNode | null
}) {
  const styles = ROLE_STYLES[node.role] || ROLE_STYLES.worker
  const isSelected = selected?.id === node.id

  return (
    <div className="flex flex-col items-center">
      <button
        onClick={() => onSelect(node)}
        className={`w-48 rounded-xl border-2 p-3 text-left transition-all duration-150 ${styles.border} ${styles.bg} ${
          isSelected ? 'ring-2 ring-white/30 shadow-lg scale-105' : 'hover:scale-102 hover:shadow-md'
        }`}
      >
        <div className="flex items-start justify-between mb-1.5">
          <span className={`text-xs px-1.5 py-0.5 rounded border font-medium uppercase tracking-wider ${styles.badge}`}>
            {node.role}
          </span>
          <span className={`w-2 h-2 rounded-full mt-1 ${STATUS_DOT[node.status] || 'bg-slate-500'}`} />
        </div>
        <p className="text-sm font-semibold text-white truncate">{node.name}</p>
        {node.jobDescription && (
          <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{node.jobDescription}</p>
        )}
        <p className="text-xs text-slate-600 mt-1">{node.type}</p>
      </button>

      {node.children.length > 0 && (
        <>
          {/* Vertical connector */}
          <div className="w-px h-6 bg-dark-border" />
          {/* Horizontal connector bar */}
          {node.children.length > 1 && (
            <div
              className="h-px bg-dark-border"
              style={{ width: `${node.children.length * 12}rem` }}
            />
          )}
          <div className="flex gap-12 items-start">
            {node.children.map((child) => (
              <div key={child.id} className="flex flex-col items-center">
                <div className="w-px h-6 bg-dark-border" />
                <OrgNode node={child} onSelect={onSelect} selected={selected} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Proposal Card ────────────────────────────────────────────────────────────

function ProposalCard({ proposal }: { proposal: Proposal }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [rejectReason, setRejectReason] = useState('')
  const [showReject, setShowReject] = useState(false)

  const approveMutation = useMutation({
    mutationFn: () => approveProposal(proposal.id),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['proposals'] })
      qc.invalidateQueries({ queryKey: ['agents'] })
      toast.success(data.newAgent ? `Proposal approved! New agent "${data.newAgent.name}" created.` : 'Proposal approved!')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const rejectMutation = useMutation({
    mutationFn: () => rejectProposal(proposal.id, rejectReason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['proposals'] })
      toast.success('Proposal rejected')
      setShowReject(false)
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const typeColors: Record<string, string> = {
    hire_agent: 'text-green-400 bg-green-500/10 border-green-500/20',
    strategy: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    budget_increase: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
    restructure: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  }

  return (
    <div className="bg-dark-card border border-dark-border rounded-xl p-4">
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs px-2 py-0.5 rounded border font-medium ${typeColors[proposal.type] || 'text-slate-400 bg-dark-bg border-dark-border'}`}>
              {proposal.type.replace('_', ' ')}
            </span>
          </div>
          <p className="text-sm font-semibold text-white">{proposal.title}</p>
        </div>
        {proposal.estimatedCostUsd != null && (
          <p className="text-xs text-slate-400 ml-2 whitespace-nowrap">~${proposal.estimatedCostUsd}/mo</p>
        )}
      </div>

      {proposal.reasoning && (
        <p className="text-xs text-slate-400 mb-3 line-clamp-3">{proposal.reasoning}</p>
      )}

      {showReject ? (
        <div className="space-y-2">
          <textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Reason for rejection (optional)"
            className="w-full px-3 py-2 bg-dark-bg border border-dark-border rounded-lg text-sm text-slate-200 placeholder-slate-600 resize-none"
            rows={2}
          />
          <div className="flex gap-2">
            <button
              onClick={() => rejectMutation.mutate()}
              disabled={rejectMutation.isPending}
              className="flex-1 px-3 py-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
            >
              Confirm Reject
            </button>
            <button
              onClick={() => setShowReject(false)}
              className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-slate-300 text-xs rounded-lg border border-dark-border"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={() => approveMutation.mutate()}
            disabled={approveMutation.isPending}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-green-600/20 hover:bg-green-600/30 disabled:opacity-50 text-green-400 text-xs font-medium rounded-lg border border-green-600/30 transition-colors"
          >
            <CheckCircle className="w-3.5 h-3.5" />
            Approve
          </button>
          <button
            onClick={() => setShowReject(true)}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-red-600/10 hover:bg-red-600/20 text-red-400 text-xs font-medium rounded-lg border border-red-600/20 transition-colors"
          >
            <XCircle className="w-3.5 h-3.5" />
            Reject
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Agent Detail Panel ───────────────────────────────────────────────────────

function AgentDetailPanel({
  node,
  onClose,
}: {
  node: OrgChartNode
  onClose: () => void
}) {
  const styles = ROLE_STYLES[node.role] || ROLE_STYLES.worker

  return (
    <div className="fixed inset-y-0 right-0 w-80 bg-dark-sidebar border-l border-dark-border z-50 flex flex-col shadow-2xl">
      <div className="flex items-center justify-between px-5 py-4 border-b border-dark-border">
        <h3 className="text-base font-semibold text-white">Agent Details</h3>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-200 text-lg leading-none"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        <div className={`rounded-xl border-2 p-4 ${styles.border} ${styles.bg}`}>
          <div className="flex items-center gap-2 mb-2">
            <span className={`text-xs px-2 py-0.5 rounded border font-medium uppercase ${styles.badge}`}>
              {node.role}
            </span>
            <span className={`w-2 h-2 rounded-full ${STATUS_DOT[node.status] || 'bg-slate-500'}`} />
            <span className="text-xs text-slate-400 capitalize">{node.status}</span>
          </div>
          <p className="text-lg font-bold text-white">{node.name}</p>
          {node.description && (
            <p className="text-sm text-slate-400 mt-1">{node.description}</p>
          )}
        </div>

        {node.jobDescription && (
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Job Description</p>
            <p className="text-sm text-slate-300">{node.jobDescription}</p>
          </div>
        )}

        <div>
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Type</p>
          <p className="text-sm text-slate-300 font-mono">{node.type}</p>
        </div>

        {node.children.length > 0 && (
          <div>
            <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">
              Direct Reports ({node.children.length})
            </p>
            <div className="space-y-1">
              {node.children.map((c) => (
                <div key={c.id} className="flex items-center gap-2 text-sm text-slate-400">
                  <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[c.status] || 'bg-slate-500'}`} />
                  {c.name}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main Organization Page ───────────────────────────────────────────────────

export default function OrganizationPage() {
  const navigate = useNavigate()
  const toast = useToast()
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<OrgChartNode | null>(null)
  const [ceoInput, setCeoInput] = useState('')
  const [showCeoRun, setShowCeoRun] = useState(false)

  const { data: orgsData, isLoading: orgsLoading } = useQuery({
    queryKey: ['organizations'],
    queryFn: getOrganizations,
    refetchInterval: 30_000,
  })

  const organizations = orgsData?.data ?? []
  const activeOrgId = selectedOrgId || organizations[0]?.id || null

  const { data: chartData, isLoading: chartLoading } = useQuery({
    queryKey: ['orgChart', activeOrgId],
    queryFn: () => getOrgChart(activeOrgId!),
    enabled: !!activeOrgId,
    refetchInterval: 30_000,
  })

  const { data: proposalsData } = useQuery({
    queryKey: ['proposals', 'pending'],
    queryFn: () => getProposals('pending'),
    refetchInterval: 15_000,
  })

  const pendingProposals = proposalsData?.data ?? []
  const chart = chartData?.data?.chart ?? []
  const org = chartData?.data?.organization ?? null

  const ceoRunMutation = useMutation({
    mutationFn: () => runCeo(activeOrgId!, ceoInput),
    onSuccess: () => {
      toast.success('CEO agent ran successfully. Check for new proposals.')
      setShowCeoRun(false)
      setCeoInput('')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  if (orgsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-accent-purple border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (organizations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-80 space-y-4">
        <Building2 className="w-16 h-16 text-slate-600" />
        <div className="text-center">
          <h2 className="text-xl font-bold text-white mb-2">No Organization Yet</h2>
          <p className="text-slate-400 text-sm mb-6">
            Set up your AI business with a CEO and team agents.
          </p>
          <button
            onClick={() => navigate('/business-setup')}
            className="flex items-center gap-2 px-6 py-3 bg-accent-purple hover:bg-purple-600 text-white font-medium rounded-xl transition-colors"
          >
            <Sparkles className="w-4 h-4" />
            Set Up Your AI Business
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Organization</h1>
          <p className="text-sm text-slate-400 mt-1">
            {org ? org.name : 'Loading...'}
            {org?.industry && ` · ${org.industry}`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {organizations.length > 1 && (
            <select
              value={activeOrgId || ''}
              onChange={(e) => setSelectedOrgId(e.target.value)}
              className="px-3 py-2 bg-dark-card border border-dark-border rounded-lg text-sm text-slate-200"
            >
              {organizations.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          )}
          <button
            onClick={() => setShowCeoRun(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300 text-sm font-medium rounded-lg border border-yellow-500/30 transition-colors"
          >
            <Play className="w-4 h-4" />
            Run CEO
          </button>
          <button
            onClick={() => navigate('/business-setup')}
            className="flex items-center gap-2 px-4 py-2.5 bg-accent-purple hover:bg-purple-600 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Building2 className="w-4 h-4" />
            New Org
          </button>
        </div>
      </div>

      {/* CEO Run Dialog */}
      {showCeoRun && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-dark-card border border-dark-border rounded-2xl p-6 max-w-lg w-full">
            <h3 className="text-lg font-bold text-white mb-2">Run CEO Agent</h3>
            <p className="text-sm text-slate-400 mb-4">
              The CEO will analyze your organization and may propose changes or improvements.
            </p>
            <textarea
              value={ceoInput}
              onChange={(e) => setCeoInput(e.target.value)}
              placeholder="What should the CEO focus on? (leave empty for general review)"
              className="w-full px-4 py-3 bg-dark-bg border border-dark-border rounded-xl text-sm text-slate-200 placeholder-slate-600 resize-none mb-4"
              rows={3}
            />
            <div className="flex gap-3">
              <button
                onClick={() => ceoRunMutation.mutate()}
                disabled={ceoRunMutation.isPending}
                className="flex-1 px-4 py-2.5 bg-yellow-500 hover:bg-yellow-600 disabled:opacity-50 text-black font-medium text-sm rounded-lg transition-colors"
              >
                {ceoRunMutation.isPending ? 'Running...' : 'Run CEO'}
              </button>
              <button
                onClick={() => setShowCeoRun(false)}
                className="px-4 py-2.5 bg-white/5 hover:bg-white/10 text-slate-300 text-sm rounded-lg border border-dark-border"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        {/* Org Chart */}
        <div className="xl:col-span-3 bg-dark-card border border-dark-border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-dark-border">
            <h2 className="text-base font-semibold text-white">Org Chart</h2>
            <p className="text-xs text-slate-500 mt-0.5">Click any agent to view details</p>
          </div>

          {chartLoading ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-8 h-8 border-2 border-accent-purple border-t-transparent rounded-full animate-spin" />
            </div>
          ) : chart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-500">
              <Users className="w-10 h-10 mb-3 opacity-40" />
              <p className="text-sm">No agents in this organization</p>
            </div>
          ) : (
            <div className="p-8 overflow-x-auto">
              <div className="flex flex-col items-center min-w-max mx-auto">
                {chart.map((rootNode) => (
                  <OrgNode
                    key={rootNode.id}
                    node={rootNode}
                    onSelect={setSelectedNode}
                    selected={selectedNode}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Legend */}
          <div className="px-5 py-3 border-t border-dark-border flex items-center gap-6">
            {Object.entries(ROLE_STYLES).map(([role, styles]) => (
              <div key={role} className="flex items-center gap-1.5">
                <div className={`w-3 h-3 rounded border ${styles.border} ${styles.bg}`} />
                <span className="text-xs text-slate-500 capitalize">{role}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Proposals Panel */}
        <div className="xl:col-span-1">
          <div className="bg-dark-card border border-dark-border rounded-xl overflow-hidden">
            <div className="px-4 py-4 border-b border-dark-border flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">Proposals</h2>
              {pendingProposals.length > 0 && (
                <span className="px-2 py-0.5 text-xs bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded-full">
                  {pendingProposals.length}
                </span>
              )}
            </div>

            {pendingProposals.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-slate-500 px-4">
                <ClipboardList className="w-8 h-8 mb-2 opacity-40" />
                <p className="text-sm text-center">No pending proposals</p>
                <p className="text-xs text-center mt-1 opacity-70">Run CEO to generate proposals</p>
              </div>
            ) : (
              <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
                {pendingProposals.map((proposal) => (
                  <ProposalCard key={proposal.id} proposal={proposal} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Agent Detail Side Panel */}
      {selectedNode && (
        <>
          <div
            className="fixed inset-0 bg-black/20 z-40"
            onClick={() => setSelectedNode(null)}
          />
          <AgentDetailPanel node={selectedNode} onClose={() => setSelectedNode(null)} />
        </>
      )}
    </div>
  )
}

