import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Bot,
  Clock,
  Zap,
  AlertCircle,
} from 'lucide-react'
import { getHeartbeat, getOrganizations, Run } from '../api/client'
import StatusBadge from '../components/StatusBadge'

function formatTime(dt: string): string {
  return new Date(dt).toLocaleTimeString()
}

function formatDurationMs(ms?: number): string {
  if (!ms) return '-'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

function formatCost(cost: string | number): string {
  const n = typeof cost === 'string' ? parseFloat(cost) : cost
  if (isNaN(n) || n === 0) return '-'
  return `$${n.toFixed(4)}`
}

function HeartbeatEntry({ run }: { run: Run }) {
  const [expanded, setExpanded] = useState(false)

  const isRunning = run.status === 'running' || run.status === 'pending'

  return (
    <div className={`border border-dark-border rounded-xl overflow-hidden transition-colors ${isRunning ? 'border-accent-purple/40 bg-accent-purple/5' : 'bg-dark-card'}`}>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-white/3 transition-colors"
      >
        {/* Pulse for running */}
        {isRunning ? (
          <span className="relative flex h-2.5 w-2.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent-purple opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-accent-purple" />
          </span>
        ) : (
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
            run.status === 'success' ? 'bg-green-500' :
            run.status === 'failed' ? 'bg-red-500' :
            run.status === 'cancelled' ? 'bg-yellow-500' : 'bg-slate-500'
          }`} />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-white truncate">{run.agentName || run.agentId.slice(0, 8)}</span>
            {run.agentRole && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-white/5 border border-dark-border text-slate-500 uppercase">
                {run.agentRole}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-xs text-slate-500">{formatTime(run.createdAt)}</span>
            {run.model && <span className="text-xs text-slate-600 font-mono">{run.model}</span>}
            {run.durationMs && <span className="text-xs text-slate-500">{formatDurationMs(run.durationMs)}</span>}
          </div>
        </div>

        <StatusBadge status={run.status} />

        <div className="text-slate-500">
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-dark-border space-y-3">
          {/* Metadata bar */}
          <div className="flex flex-wrap gap-4 text-xs">
            {run.model && (
              <div className="flex items-center gap-1 text-slate-400">
                <Zap className="w-3 h-3" /> {run.model}
              </div>
            )}
            {run.durationMs && (
              <div className="flex items-center gap-1 text-slate-400">
                <Clock className="w-3 h-3" /> {formatDurationMs(run.durationMs)}
              </div>
            )}
            <div className="flex items-center gap-1 text-slate-400">
              <Bot className="w-3 h-3" /> {run.triggeredBy}
            </div>
            {(run.tokensUsed > 0 || (run.inputTokens && run.inputTokens > 0)) && (
              <div className="text-slate-400">
                Tokens: {run.inputTokens?.toLocaleString() || '?'} in / {run.outputTokens?.toLocaleString() || '?'} out
                {run.tokensUsed > 0 && ` (${run.tokensUsed.toLocaleString()} total)`}
              </div>
            )}
            {formatCost(run.costUsd) !== '-' && (
              <div className="text-slate-400">Cost: {formatCost(run.costUsd)}</div>
            )}
          </div>

          {/* Input */}
          {run.input != null && (
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Input</p>
              <pre className="text-xs text-slate-300 bg-dark-bg border border-dark-border rounded-lg p-3 overflow-auto max-h-32 font-mono">
                {typeof run.input === 'string' ? run.input : JSON.stringify(run.input, null, 2)}
              </pre>
            </div>
          )}

          {/* Output */}
          {run.output != null && (
            <div>
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-1">Output</p>
              <pre className="text-xs text-slate-300 bg-dark-bg border border-dark-border rounded-lg p-3 overflow-auto max-h-32 font-mono">
                {typeof run.output === 'string' ? run.output : JSON.stringify(run.output, null, 2)}
              </pre>
            </div>
          )}

          {/* Error */}
          {run.error && (
            <div>
              <p className="text-xs font-medium text-red-500 uppercase tracking-wider mb-1">Error</p>
              <pre className="text-xs text-red-300 bg-red-500/5 border border-red-500/20 rounded-lg p-3 overflow-auto max-h-32 font-mono">
                {run.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function HeartbeatPage() {
  const [sinceMin, setSinceMin] = useState(5)
  const [orgFilter, setOrgFilter] = useState('')

  const { data: orgsData } = useQuery({
    queryKey: ['organizations'],
    queryFn: getOrganizations,
  })

  const { data, isLoading } = useQuery({
    queryKey: ['heartbeat', sinceMin, orgFilter],
    queryFn: () => getHeartbeat(sinceMin, orgFilter || undefined),
    refetchInterval: 3_000,
  })

  const runs = data?.data ?? []
  const organizations = orgsData?.data ?? []
  const runningCount = runs.filter((r) => r.status === 'running' || r.status === 'pending').length

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="w-6 h-6 text-accent-purple" />
          <div>
            <h1 className="text-2xl font-bold text-white">Heartbeat</h1>
            <p className="text-sm text-slate-400 mt-0.5">
              Live agent activity
              {runningCount > 0 && (
                <span className="ml-2 text-accent-purple font-medium">{runningCount} active</span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500" />
          </span>
          <span className="text-xs text-slate-500">Polling every 3s</span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={sinceMin}
          onChange={(e) => setSinceMin(Number(e.target.value))}
          className="bg-dark-card border border-dark-border rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-accent-purple"
        >
          <option value={2}>Last 2 min</option>
          <option value={5}>Last 5 min</option>
          <option value={15}>Last 15 min</option>
          <option value={30}>Last 30 min</option>
          <option value={60}>Last 1 hour</option>
        </select>

        {organizations.length > 1 && (
          <select
            value={orgFilter}
            onChange={(e) => setOrgFilter(e.target.value)}
            className="bg-dark-card border border-dark-border rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-accent-purple"
          >
            <option value="">All Organizations</option>
            {organizations.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Feed */}
      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <div className="w-8 h-8 border-2 border-accent-purple border-t-transparent rounded-full animate-spin" />
        </div>
      ) : runs.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-slate-500 bg-dark-card border border-dark-border rounded-xl">
          <Activity className="w-10 h-10 mb-3 opacity-40" />
          <p className="text-sm font-medium">No recent activity</p>
          <p className="text-xs mt-1">Agents will appear here when they run</p>
        </div>
      ) : (
        <div className="space-y-2">
          {runs.map((run) => (
            <HeartbeatEntry key={run.id} run={run} />
          ))}
        </div>
      )}
    </div>
  )
}
