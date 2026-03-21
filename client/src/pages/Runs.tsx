import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, XCircle, PlayCircle, Zap, Clock, Bot, Wrench, ScrollText } from 'lucide-react'
import { getRuns, getRun, getAgents, cancelRun, Run } from '../api/client'
import { useToast } from '../components/Toaster'
import StatusBadge from '../components/StatusBadge'

const PAGE_SIZE = 50

function formatDate(dt: string | null): string {
  if (!dt) return '-'
  return new Date(dt).toLocaleString()
}

function formatDuration(start: string | null, end: string | null): string {
  if (!start || !end) return '-'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

function formatCost(cost: string | number): string {
  const n = typeof cost === 'string' ? parseFloat(cost) : cost
  if (isNaN(n)) return '$0.0000'
  return `$${n.toFixed(4)}`
}

function formatDurationMs(ms?: number): string {
  if (!ms) return '-'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

function RunRow({ run }: { run: Run }) {
  const [expanded, setExpanded] = useState(false)
  const qc = useQueryClient()
  const toast = useToast()

  // Fetch full detail (with toolCalls + auditLogs) when expanded
  const { data: detailData } = useQuery({
    queryKey: ['run', run.id],
    queryFn: () => getRun(run.id),
    enabled: expanded,
  })
  const detail = detailData?.data

  const cancelMutation = useMutation({
    mutationFn: () => cancelRun(run.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['runs'] })
      toast.success('Run cancelled')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const canCancel = run.status === 'pending' || run.status === 'running'
  const displayRun = detail || run

  return (
    <>
      <tr className="border-b border-dark-border hover:bg-white/3 transition-colors">
        <td className="px-5 py-3">
          <button
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200 transition-colors"
          >
            {expanded ? (
              <ChevronDown className="w-4 h-4 shrink-0" />
            ) : (
              <ChevronRight className="w-4 h-4 shrink-0" />
            )}
            <code className="text-xs font-mono">{run.id.slice(0, 8)}...</code>
          </button>
        </td>
        <td className="px-5 py-3">
          <p className="text-slate-200 text-sm">{run.agentName ?? run.agentId.slice(0, 8)}</p>
          <p className="text-xs text-slate-500">{run.agentType}{run.model ? ` · ${run.model}` : ''}</p>
        </td>
        <td className="px-5 py-3">
          <StatusBadge status={run.status} />
        </td>
        <td className="px-5 py-3 text-xs text-slate-400 capitalize">{run.triggeredBy}</td>
        <td className="px-5 py-3 text-xs text-slate-400">{formatDate(run.startedAt)}</td>
        <td className="px-5 py-3 text-xs text-slate-400 font-mono">
          {run.durationMs ? formatDurationMs(run.durationMs) : formatDuration(run.startedAt, run.completedAt)}
        </td>
        <td className="px-5 py-3 text-xs text-slate-400 font-mono">
          {run.tokensUsed > 0 ? run.tokensUsed.toLocaleString() : '-'}
        </td>
        <td className="px-5 py-3 text-xs text-slate-400 font-mono">
          {formatCost(run.costUsd)}
        </td>
        <td className="px-5 py-3">
          {canCancel && (
            <button
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
              title="Cancel run"
              className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-30 transition-colors"
            >
              <XCircle className="w-4 h-4" />
            </button>
          )}
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-dark-border bg-dark-bg/60">
          <td colSpan={9} className="px-6 py-4 space-y-4">
            {/* Metadata bar */}
            <div className="flex flex-wrap gap-4 text-xs">
              {displayRun.model && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-dark-card border border-dark-border rounded-lg text-slate-300">
                  <Zap className="w-3 h-3 text-accent-purple" /> {displayRun.model}
                </div>
              )}
              {displayRun.durationMs && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-dark-card border border-dark-border rounded-lg text-slate-300">
                  <Clock className="w-3 h-3 text-blue-400" /> {formatDurationMs(displayRun.durationMs)}
                </div>
              )}
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-dark-card border border-dark-border rounded-lg text-slate-300">
                <Bot className="w-3 h-3 text-green-400" /> {displayRun.triggeredBy}
              </div>
            </div>

            {/* Token breakdown */}
            {(displayRun.inputTokens || displayRun.outputTokens || displayRun.tokensUsed > 0) && (
              <div className="bg-dark-card border border-dark-border rounded-lg p-3">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Token Usage</p>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-lg font-bold text-blue-400">{(displayRun.inputTokens || 0).toLocaleString()}</p>
                    <p className="text-xs text-slate-500">Input</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-purple-400">{(displayRun.outputTokens || 0).toLocaleString()}</p>
                    <p className="text-xs text-slate-500">Output</p>
                  </div>
                  <div>
                    <p className="text-lg font-bold text-slate-300">{displayRun.tokensUsed.toLocaleString()}</p>
                    <p className="text-xs text-slate-500">Total</p>
                  </div>
                </div>
              </div>
            )}

            {/* Input / Output / Error panels */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {displayRun.input != null && (
                <div>
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Input</p>
                  <pre className="text-xs text-slate-300 bg-dark-bg border border-dark-border rounded-lg p-3 overflow-auto max-h-48 font-mono">
                    {typeof displayRun.input === 'string' ? displayRun.input : JSON.stringify(displayRun.input, null, 2)}
                  </pre>
                </div>
              )}
              {displayRun.output != null && (
                <div>
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2">Output</p>
                  <pre className="text-xs text-slate-300 bg-dark-bg border border-dark-border rounded-lg p-3 overflow-auto max-h-48 font-mono">
                    {typeof displayRun.output === 'string' ? displayRun.output : JSON.stringify(displayRun.output, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            {displayRun.error && (
              <div>
                <p className="text-xs font-medium text-red-500 uppercase tracking-wider mb-2">Error</p>
                <pre className="text-xs text-red-300 bg-red-500/5 border border-red-500/20 rounded-lg p-3 overflow-auto max-h-40 font-mono">
                  {displayRun.error}
                </pre>
              </div>
            )}

            {/* Tool Calls */}
            {detail?.toolCalls && detail.toolCalls.length > 0 && (
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Wrench className="w-3 h-3" /> Tool Calls ({detail.toolCalls.length})
                </p>
                <div className="space-y-1.5">
                  {detail.toolCalls.map((tc: any) => (
                    <div key={tc.id} className="flex items-center gap-3 px-3 py-2 bg-dark-card border border-dark-border rounded-lg text-xs">
                      <span className="font-mono text-accent-purple font-medium">{tc.toolName}</span>
                      {tc.durationMs > 0 && <span className="text-slate-500">{tc.durationMs}ms</span>}
                      <span className="text-slate-600 truncate flex-1">
                        {tc.input ? (typeof tc.input === 'string' ? tc.input.slice(0, 80) : JSON.stringify(tc.input).slice(0, 80)) : ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Audit Logs */}
            {detail?.auditLogs && detail.auditLogs.length > 0 && (
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <ScrollText className="w-3 h-3" /> Audit Log ({detail.auditLogs.length})
                </p>
                <div className="space-y-1">
                  {detail.auditLogs.map((log: any) => (
                    <div key={log.id} className="flex items-center gap-3 px-3 py-1.5 text-xs">
                      <span className="text-slate-600 shrink-0">{new Date(log.createdAt).toLocaleTimeString()}</span>
                      <span className="font-medium text-slate-400">{log.eventType}</span>
                      {log.data && (
                        <span className="text-slate-600 truncate">
                          {typeof log.data === 'string' ? log.data.slice(0, 60) : JSON.stringify(log.data).slice(0, 60)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {displayRun.input == null && displayRun.output == null && !displayRun.error && (
              <p className="text-xs text-slate-500">No details available for this run.</p>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

export default function Runs() {
  const [page, setPage] = useState(0)
  const [agentFilter, setAgentFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const { data: agentsData } = useQuery({
    queryKey: ['agents'],
    queryFn: getAgents,
  })

  const { data, isLoading, error } = useQuery({
    queryKey: ['runs', { page, agentFilter, statusFilter }],
    queryFn: () =>
      getRuns({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        agentId: agentFilter || undefined,
        status: statusFilter || undefined,
      }),
    refetchInterval: 5_000,
  })

  const runs = data?.data ?? []
  const hasNext = runs.length === PAGE_SIZE

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">Runs</h1>
        <p className="text-sm text-slate-400 mt-1">Auto-refreshes every 5s</p>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3">
        <select
          value={agentFilter}
          onChange={(e) => { setAgentFilter(e.target.value); setPage(0) }}
          className="bg-dark-card border border-dark-border rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-accent-purple"
        >
          <option value="">All Agents</option>
          {agentsData?.data.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); setPage(0) }}
          className="bg-dark-card border border-dark-border rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-accent-purple"
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="running">Running</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div className="bg-dark-card border border-dark-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-2 border-accent-purple border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-48 text-red-400">
            <p className="text-sm">Failed to load runs.</p>
          </div>
        ) : runs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-500">
            <PlayCircle className="w-10 h-10 mb-3 opacity-40" />
            <p className="text-sm font-medium">No runs found</p>
            <p className="text-xs mt-1">
              {agentFilter || statusFilter ? 'Try adjusting your filters' : 'Trigger an agent to see runs here'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-dark-border">
                  {['ID', 'Agent', 'Status', 'Triggered By', 'Started', 'Duration', 'Tokens', 'Cost', ''].map(
                    (h) => (
                      <th
                        key={h}
                        className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider whitespace-nowrap"
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <RunRow key={run.id} run={run} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {!isLoading && (page > 0 || hasNext) && (
        <div className="flex items-center justify-between">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-4 py-2 text-sm text-slate-400 bg-dark-card border border-dark-border rounded-lg hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Previous
          </button>
          <span className="text-sm text-slate-500">Page {page + 1}</span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={!hasNext}
            className="px-4 py-2 text-sm text-slate-400 bg-dark-card border border-dark-border rounded-lg hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
