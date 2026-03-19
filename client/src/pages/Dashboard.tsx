import { useQuery } from '@tanstack/react-query'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import { Bot, PlayCircle, TrendingUp, DollarSign } from 'lucide-react'
import { getAgents, getRuns, getBudgets, Run } from '../api/client'
import StatusBadge from '../components/StatusBadge'

function formatDuration(start: string | null, end: string | null): string {
  if (!start || !end) return '-'
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

function formatCost(cost: string | number): string {
  const n = typeof cost === 'string' ? parseFloat(cost) : cost
  if (isNaN(n)) return '$0.00'
  return `$${n.toFixed(4)}`
}

function buildRunsPerDay(runs: Run[]): { date: string; runs: number }[] {
  const now = new Date()
  const days: { date: string; runs: number }[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(now.getDate() - i)
    days.push({
      date: d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      runs: 0,
    })
  }
  const cutoff = new Date(now)
  cutoff.setDate(now.getDate() - 6)
  cutoff.setHours(0, 0, 0, 0)

  runs.forEach((r) => {
    if (!r.createdAt) return
    const d = new Date(r.createdAt)
    if (d < cutoff) return
    const idx = Math.floor((d.getTime() - cutoff.getTime()) / 86400000)
    if (idx >= 0 && idx < 7) days[idx].runs++
  })
  return days
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: React.ElementType
  label: string
  value: string | number
  sub?: string
  color: string
}) {
  return (
    <div className="bg-dark-card border border-dark-border rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-400">{label}</p>
        <div className={`p-2 rounded-lg ${color}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
      <p className="text-2xl font-bold text-white">{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </div>
  )
}

export default function Dashboard() {
  const { data: agentsData, isLoading: agentsLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: getAgents,
    refetchInterval: 30_000,
  })

  const { data: runsData, isLoading: runsLoading } = useQuery({
    queryKey: ['runs', { limit: 200 }],
    queryFn: () => getRuns({ limit: 200 }),
    refetchInterval: 10_000,
  })

  const { data: budgetsData } = useQuery({
    queryKey: ['budgets'],
    queryFn: getBudgets,
    refetchInterval: 30_000,
  })

  const agents = agentsData?.data ?? []
  const runs = runsData?.data ?? []
  const budgets = budgetsData?.data ?? []

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const runsToday = runs.filter(
    (r) => r.createdAt && new Date(r.createdAt) >= today
  ).length

  const activeRuns = runs.filter(
    (r) => r.status === 'running' || r.status === 'pending'
  ).length

  const totalCost = runs.reduce((sum, r) => {
    const cost = typeof r.costUsd === 'string' ? parseFloat(r.costUsd) : r.costUsd
    return sum + (isNaN(cost) ? 0 : cost)
  }, 0)

  const chartData = buildRunsPerDay(runs)
  const recentRuns = runs.slice(0, 10)

  const isLoading = agentsLoading || runsLoading

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-sm text-slate-400 mt-1">Overview of your AI agent ecosystem</p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Bot}
          label="Total Agents"
          value={isLoading ? '...' : agents.length}
          sub={`${agents.filter((a) => a.status === 'active').length} active`}
          color="bg-accent-purple/20 text-accent-purple"
        />
        <StatCard
          icon={PlayCircle}
          label="Active Runs"
          value={isLoading ? '...' : activeRuns}
          sub="running or pending"
          color="bg-blue-500/20 text-blue-400"
        />
        <StatCard
          icon={TrendingUp}
          label="Runs Today"
          value={isLoading ? '...' : runsToday}
          sub="last 24 hours"
          color="bg-green-500/20 text-green-400"
        />
        <StatCard
          icon={DollarSign}
          label="Total Cost"
          value={isLoading ? '...' : `$${totalCost.toFixed(4)}`}
          sub="all time"
          color="bg-yellow-500/20 text-yellow-400"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Recent runs table */}
        <div className="lg:col-span-2 bg-dark-card border border-dark-border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-dark-border">
            <h2 className="text-base font-semibold text-white">Recent Runs</h2>
            <p className="text-xs text-slate-500 mt-0.5">Auto-refreshes every 10s</p>
          </div>
          {runsLoading ? (
            <div className="flex items-center justify-center h-40">
              <div className="w-6 h-6 border-2 border-accent-purple border-t-transparent rounded-full animate-spin" />
            </div>
          ) : recentRuns.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-slate-500">
              <PlayCircle className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">No runs yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-dark-border">
                    <th className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Agent
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Duration
                    </th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">
                      Cost
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-border">
                  {recentRuns.map((run) => (
                    <tr key={run.id} className="hover:bg-white/3 transition-colors">
                      <td className="px-5 py-3">
                        <p className="text-slate-200 font-medium truncate max-w-[140px]">
                          {run.agentName ?? run.agentId.slice(0, 8)}
                        </p>
                        <p className="text-xs text-slate-500">{run.triggeredBy}</p>
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={run.status} />
                      </td>
                      <td className="px-5 py-3 text-slate-400 font-mono text-xs">
                        {formatDuration(run.startedAt, run.completedAt)}
                      </td>
                      <td className="px-5 py-3 text-slate-400 font-mono text-xs">
                        {formatCost(run.costUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Budget overview */}
        <div className="bg-dark-card border border-dark-border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-dark-border">
            <h2 className="text-base font-semibold text-white">Budgets</h2>
          </div>
          {budgets.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-slate-500">
              <DollarSign className="w-8 h-8 mb-2 opacity-40" />
              <p className="text-sm">No budgets configured</p>
            </div>
          ) : (
            <div className="p-4 space-y-4">
              {budgets.map((b) => {
                const limit = parseFloat(String(b.limitUsd))
                const spend = parseFloat(String(b.currentSpend))
                const pct = limit > 0 ? Math.min(100, (spend / limit) * 100) : 0
                const barColor =
                  pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-yellow-500' : 'bg-green-500'

                return (
                  <div key={b.id}>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm text-slate-300 font-medium truncate max-w-[120px]">
                        {b.agentName}
                      </p>
                      <span className="text-xs text-slate-500 capitalize">{b.period}</span>
                    </div>
                    <div className="h-2 bg-dark-bg rounded-full overflow-hidden mb-1">
                      <div
                        className={`h-full rounded-full transition-all ${barColor}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-slate-500">
                      <span>${spend.toFixed(2)}</span>
                      <span>${limit.toFixed(2)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Runs per day chart */}
      <div className="bg-dark-card border border-dark-border rounded-xl p-5">
        <h2 className="text-base font-semibold text-white mb-1">Runs — Last 7 Days</h2>
        <p className="text-xs text-slate-500 mb-4">Daily run volume</p>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2a4a" />
            <XAxis
              dataKey="date"
              tick={{ fill: '#64748b', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: '#64748b', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={{
                background: '#1a1a2e',
                border: '1px solid #2a2a4a',
                borderRadius: 8,
                color: '#e2e8f0',
                fontSize: 12,
              }}
              cursor={{ fill: '#7c3aed22' }}
            />
            <Bar dataKey="runs" fill="#7c3aed" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
