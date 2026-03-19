import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Calendar,
  BarChart2,
} from 'lucide-react'
import { getCostSummary, getCostsByAgent, getCostTimeline, getCostProjections } from '../api/client'

function formatCost(n: number): string {
  if (n < 0.001) return `$${n.toFixed(6)}`
  if (n < 1) return `$${n.toFixed(4)}`
  return `$${n.toFixed(2)}`
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
  value: string
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

type Period = 'day' | 'week' | 'month'

export default function Costs() {
  const [period, setPeriod] = useState<Period>('month')

  const { data: summaryData, isLoading: summaryLoading } = useQuery({
    queryKey: ['costSummary'],
    queryFn: getCostSummary,
    refetchInterval: 60_000,
  })

  const { data: agentCostsData, isLoading: agentCostsLoading } = useQuery({
    queryKey: ['costsByAgent', period],
    queryFn: () => getCostsByAgent(period),
    refetchInterval: 60_000,
  })

  const { data: timelineData, isLoading: timelineLoading } = useQuery({
    queryKey: ['costTimeline'],
    queryFn: () => getCostTimeline(),
    refetchInterval: 60_000,
  })

  const { data: projectionsData, isLoading: projectionsLoading } = useQuery({
    queryKey: ['costProjections'],
    queryFn: getCostProjections,
    refetchInterval: 60_000,
  })

  const summary = summaryData?.data
  const agentCosts = agentCostsData?.data ?? []
  const timeline = timelineData?.data ?? []
  const projections = projectionsData?.data ?? []
  const totalProjected = projectionsData?.totalProjectedNextMonth ?? 0

  const totalThisMonth = summary?.totalThisMonth ?? 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Costs</h1>
          <p className="text-sm text-slate-400 mt-1">AI spending analytics and projections</p>
        </div>
        <span className="text-xs text-slate-500">Auto-refreshes every 60s</span>
      </div>

      {/* Top stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={DollarSign}
          label="Today"
          value={summaryLoading ? '...' : formatCost(summary?.totalToday ?? 0)}
          sub="last 24 hours"
          color="bg-blue-500/20 text-blue-400"
        />
        <StatCard
          icon={Calendar}
          label="This Week"
          value={summaryLoading ? '...' : formatCost(summary?.totalThisWeek ?? 0)}
          sub="current week"
          color="bg-green-500/20 text-green-400"
        />
        <StatCard
          icon={TrendingUp}
          label="This Month"
          value={summaryLoading ? '...' : formatCost(totalThisMonth)}
          sub="current month"
          color="bg-accent-purple/20 text-accent-purple"
        />
        <StatCard
          icon={BarChart2}
          label="Projected Next Month"
          value={projectionsLoading ? '...' : formatCost(totalProjected)}
          sub="based on last 30 days"
          color="bg-yellow-500/20 text-yellow-400"
        />
      </div>

      {/* Cost Timeline Chart */}
      <div className="bg-dark-card border border-dark-border rounded-xl p-5">
        <h2 className="text-base font-semibold text-white mb-1">Cost Timeline — Last 30 Days</h2>
        <p className="text-xs text-slate-500 mb-4">Daily spending</p>
        {timelineLoading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-6 h-6 border-2 border-accent-purple border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={timeline} margin={{ top: 0, right: 0, left: -10, bottom: 0 }}>
              <defs>
                <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a4a" />
              <XAxis
                dataKey="date"
                tick={{ fill: '#64748b', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => v.slice(5)}
              />
              <YAxis
                tick={{ fill: '#64748b', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `$${v.toFixed(3)}`}
              />
              <Tooltip
                contentStyle={{
                  background: '#1a1a2e',
                  border: '1px solid #2a2a4a',
                  borderRadius: 8,
                  color: '#e2e8f0',
                  fontSize: 12,
                }}
                formatter={(val: number) => [formatCost(val), 'Cost']}
                cursor={{ stroke: '#7c3aed44' }}
              />
              <Area
                type="monotone"
                dataKey="cost"
                stroke="#7c3aed"
                fill="url(#costGradient)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Cost by Agent Table */}
        <div className="bg-dark-card border border-dark-border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-dark-border flex items-center justify-between">
            <h2 className="text-base font-semibold text-white">Cost by Agent</h2>
            <div className="flex items-center gap-1 bg-dark-bg rounded-lg p-1 border border-dark-border">
              {(['day', 'week', 'month'] as Period[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={`px-3 py-1 text-xs rounded-md transition-colors capitalize ${
                    period === p
                      ? 'bg-accent-purple text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {agentCostsLoading ? (
            <div className="flex items-center justify-center h-48">
              <div className="w-6 h-6 border-2 border-accent-purple border-t-transparent rounded-full animate-spin" />
            </div>
          ) : agentCosts.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-slate-500">
              <p className="text-sm">No cost data for this period</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-dark-border">
                    <th className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Agent</th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Runs</th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Tokens</th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">Cost</th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-dark-border">
                  {agentCosts.map((agent: any) => (
                    <tr key={agent.agentId} className="hover:bg-white/3 transition-colors">
                      <td className="px-5 py-3">
                        <p className="text-slate-200 font-medium truncate max-w-[140px]">{agent.name}</p>
                        <p className="text-xs text-slate-500">{agent.type}</p>
                      </td>
                      <td className="px-5 py-3 text-slate-400 font-mono text-xs">{agent.runs}</td>
                      <td className="px-5 py-3 text-slate-400 font-mono text-xs">{(agent.tokens || 0).toLocaleString()}</td>
                      <td className="px-5 py-3 text-slate-200 font-mono text-xs font-semibold">{formatCost(agent.cost)}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-dark-bg rounded-full overflow-hidden">
                            <div
                              className="h-full bg-accent-purple rounded-full"
                              style={{ width: `${Math.min(100, agent.percentOfTotal || 0).toFixed(1)}%` }}
                            />
                          </div>
                          <span className="text-xs text-slate-500">
                            {(agent.percentOfTotal || 0).toFixed(1)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Projections */}
        <div className="bg-dark-card border border-dark-border rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-dark-border">
            <h2 className="text-base font-semibold text-white">Projected Next Month</h2>
            <p className="text-xs text-slate-500 mt-0.5">Based on last 30 days of spending</p>
          </div>

          {projectionsLoading ? (
            <div className="flex items-center justify-center h-48">
              <div className="w-6 h-6 border-2 border-accent-purple border-t-transparent rounded-full animate-spin" />
            </div>
          ) : projections.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-slate-500">
              <p className="text-sm">No projection data available</p>
            </div>
          ) : (
            <div className="p-5 space-y-4">
              {projections.slice(0, 8).map((proj) => {
                const maxCost = Math.max(...projections.map((p) => p.projectedNextMonthCost), 0.001)
                const pct = (proj.projectedNextMonthCost / maxCost) * 100
                const trend = proj.projectedNextMonthCost > proj.last30DayCost

                return (
                  <div key={proj.agentId}>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm text-slate-300 font-medium truncate max-w-[160px]">{proj.name}</p>
                      <div className="flex items-center gap-1.5">
                        {trend ? (
                          <TrendingUp className="w-3.5 h-3.5 text-yellow-400" />
                        ) : (
                          <TrendingDown className="w-3.5 h-3.5 text-green-400" />
                        )}
                        <span className="text-xs text-slate-300 font-mono">
                          {formatCost(proj.projectedNextMonthCost)}
                        </span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-dark-bg rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent-purple/60 rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Last 30 days: {formatCost(proj.last30DayCost)}
                    </p>
                  </div>
                )
              })}

              <div className="pt-3 border-t border-dark-border flex items-center justify-between">
                <span className="text-sm text-slate-400">Total projected</span>
                <span className="text-base font-bold text-white">{formatCost(totalProjected)}/mo</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
