import { NavLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  LayoutDashboard,
  Bot,
  Clock,
  PlayCircle,
  Wallet,
  ScrollText,
  Building2,
  TrendingUp,
  Settings,
  Sparkles,
} from 'lucide-react'
import clsx from 'clsx'
import { getProposals } from '../api/client'

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/agents', icon: Bot, label: 'Agents', end: false },
  { to: '/organization', icon: Building2, label: 'Organization', end: false },
  { to: '/schedules', icon: Clock, label: 'Schedules', end: false },
  { to: '/runs', icon: PlayCircle, label: 'Runs', end: false },
  { to: '/budgets', icon: Wallet, label: 'Budgets', end: false },
  { to: '/costs', icon: TrendingUp, label: 'Costs', end: false },
  { to: '/logs', icon: ScrollText, label: 'Logs', end: false },
  { to: '/settings', icon: Settings, label: 'Settings', end: false },
]

export default function Sidebar() {
  const { data: proposalsData } = useQuery({
    queryKey: ['proposals', 'pending'],
    queryFn: () => getProposals('pending'),
    refetchInterval: 30_000,
  })

  const pendingCount = proposalsData?.data?.length ?? 0

  return (
    <aside className="fixed top-0 left-0 h-full w-60 bg-dark-sidebar border-r border-dark-border flex flex-col z-30">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-dark-border">
        <div className="flex items-center gap-2">
          <span className="text-2xl">⚡</span>
          <div>
            <h1 className="text-base font-bold text-white leading-none">AgentHub</h1>
            <p className="text-xs text-slate-500 mt-0.5">AI Orchestration</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        <ul className="space-y-1">
          {navItems.map(({ to, icon: Icon, label, end }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  clsx(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                    isActive
                      ? 'bg-accent-purple/20 text-accent-purple border border-accent-purple/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                  )
                }
              >
                <Icon className="w-4.5 h-4.5 shrink-0" size={18} />
                <span className="flex-1">{label}</span>
                {label === 'Organization' && pendingCount > 0 && (
                  <span className="ml-auto px-1.5 py-0.5 text-xs bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded-full">
                    {pendingCount}
                  </span>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* Business Setup quick link */}
      <div className="px-3 pb-3">
        <NavLink
          to="/business-setup"
          className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-all duration-150 border border-dashed border-dark-border"
        >
          <Sparkles size={16} className="shrink-0 text-yellow-400" />
          <span>Business Setup</span>
        </NavLink>
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-dark-border">
        <p className="text-xs text-slate-600">v1.0.0</p>
      </div>
    </aside>
  )
}
