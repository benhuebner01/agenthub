import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ScrollText, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react'
import { getRuns, getAgents, Run } from '../api/client'
import clsx from 'clsx'

function formatDate(dt: string | null | undefined): string {
  if (!dt) return '-'
  return new Date(dt).toLocaleString()
}

const EVENT_COLORS: Record<string, string> = {
  success: 'text-green-400 bg-green-500/10 border-green-500/20',
  failed: 'text-red-400 bg-red-500/10 border-red-500/20',
  error: 'text-red-400 bg-red-500/10 border-red-500/20',
  running: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  pending: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  cancelled: 'text-slate-400 bg-slate-500/10 border-slate-500/20',
}

function LogEntry({ run }: { run: Run }) {
  const [expanded, setExpanded] = useState(false)

  const colorClass =
    EVENT_COLORS[run.status] ?? 'text-slate-400 bg-slate-500/10 border-slate-500/20'

  const hasDetail =
    (run as unknown as Record<string, unknown>).input !== undefined ||
    (run as unknown as Record<string, unknown>).output !== undefined ||
    run.error

  return (
    <div className={clsx('border rounded-lg overflow-hidden', colorClass.includes('green') ? 'border-green-500/15' : colorClass.includes('red') ? 'border-red-500/15' : 'border-dark-border')}>
      <div
        className={clsx(
          'flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-white/3 transition-colors',
          hasDetail ? '' : 'cursor-default'
        )}
        onClick={() => hasDetail && setExpanded((v) => !v)}
      >
        {hasDetail ? (
          expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          )
        ) : (
          <span className="w-3.5 h-3.5 shrink-0" />
        )}

        {/* Timestamp */}
        <span className="text-xs text-slate-500 font-mono whitespace-nowrap w-36 shrink-0">
          {run.createdAt ? formatDate(run.createdAt) : '-'}
        </span>

        {/* Agent */}
        <span className="text-xs text-slate-400 w-32 shrink-0 truncate">
          {run.agentName ?? run.agentId.slice(0, 8)}
        </span>

        {/* Event / status badge */}
        <span
          className={clsx(
            'text-xs px-2 py-0.5 rounded-full border font-medium shrink-0 capitalize',
            colorClass
          )}
        >
          {run.status}
        </span>

        {/* Triggered by */}
        <span className="text-xs text-slate-500 capitalize shrink-0">{run.triggeredBy}</span>

        {/* Cost */}
        {run.costUsd && parseFloat(String(run.costUsd)) > 0 && (
          <span className="text-xs text-slate-500 font-mono ml-auto shrink-0">
            ${parseFloat(String(run.costUsd)).toFixed(4)}
          </span>
        )}

        {/* Error snippet */}
        {run.error && (
          <span className="text-xs text-red-400 truncate max-w-xs ml-auto">{run.error}</span>
        )}
      </div>

      {expanded && (
        <div className="border-t border-dark-border px-4 py-3 bg-dark-bg/50">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">
                Run Details
              </p>
              <div className="text-xs text-slate-400 space-y-1 font-mono">
                <p>
                  ID: <span className="text-slate-300">{run.id}</span>
                </p>
                <p>
                  Tokens:{' '}
                  <span className="text-slate-300">{run.tokensUsed?.toLocaleString() ?? '0'}</span>
                </p>
                {run.startedAt && (
                  <p>
                    Started: <span className="text-slate-300">{formatDate(run.startedAt)}</span>
                  </p>
                )}
                {run.completedAt && (
                  <p>
                    Completed:{' '}
                    <span className="text-slate-300">{formatDate(run.completedAt)}</span>
                  </p>
                )}
              </div>
            </div>
            {run.error && (
              <div>
                <p className="text-xs font-medium text-red-500 uppercase tracking-wider mb-1.5">
                  Error
                </p>
                <pre className="text-xs text-red-300 bg-red-500/5 border border-red-500/20 rounded p-2 overflow-auto max-h-32 font-mono whitespace-pre-wrap">
                  {run.error}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function Logs() {
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [agentFilter, setAgentFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const { data: agentsData } = useQuery({
    queryKey: ['agents'],
    queryFn: getAgents,
  })

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['logs', agentFilter, statusFilter],
    queryFn: () =>
      getRuns({
        limit: 100,
        offset: 0,
        agentId: agentFilter || undefined,
        status: statusFilter || undefined,
      }),
    refetchInterval: autoRefresh ? 5_000 : false,
  })

  const manualRefetch = useCallback(() => {
    refetch()
  }, [refetch])

  const runs = data?.data ?? []

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Logs</h1>
          <p className="text-sm text-slate-400 mt-1">Run history and audit trail</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setAutoRefresh((v) => !v)}
            className={clsx(
              'flex items-center gap-2 px-3 py-2 text-sm rounded-lg border transition-colors',
              autoRefresh
                ? 'bg-accent-purple/20 text-accent-purple border-accent-purple/30 hover:bg-accent-purple/30'
                : 'bg-dark-card text-slate-400 border-dark-border hover:bg-white/5'
            )}
          >
            <RefreshCw className={clsx('w-3.5 h-3.5', autoRefresh && 'animate-spin [animation-duration:3s]')} />
            {autoRefresh ? 'Auto-refresh on' : 'Auto-refresh off'}
          </button>
          <button
            onClick={manualRefetch}
            disabled={isFetching}
            className="p-2 rounded-lg bg-dark-card border border-dark-border text-slate-400 hover:text-slate-200 hover:bg-white/5 disabled:opacity-40 transition-colors"
            title="Refresh now"
          >
            <RefreshCw className={clsx('w-4 h-4', isFetching && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
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
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-dark-card border border-dark-border rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-accent-purple"
        >
          <option value="">All Events</option>
          <option value="running">Running</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
          <option value="cancelled">Cancelled</option>
          <option value="pending">Pending</option>
        </select>
      </div>

      {/* Log list */}
      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-2 border-accent-purple border-t-transparent rounded-full animate-spin" />
        </div>
      ) : error ? (
        <div className="flex items-center justify-center h-48 text-red-400">
          <p className="text-sm">Failed to load logs.</p>
        </div>
      ) : runs.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 bg-dark-card border border-dark-border rounded-xl text-slate-500">
          <ScrollText className="w-10 h-10 mb-3 opacity-40" />
          <p className="text-sm font-medium">No logs found</p>
          <p className="text-xs mt-1">
            {agentFilter || statusFilter ? 'Try adjusting your filters' : 'Logs will appear here as agents run'}
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {runs.map((run) => (
            <LogEntry key={run.id} run={run} />
          ))}
        </div>
      )}

      {runs.length > 0 && (
        <p className="text-xs text-slate-600 text-center">
          Showing {runs.length} most recent entries
        </p>
      )}
    </div>
  )
}
