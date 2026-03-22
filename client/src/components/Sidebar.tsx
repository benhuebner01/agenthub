import { NavLink } from 'react-router-dom'
import { useState } from 'react'
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
  ClipboardList,
  Settings,
  Sparkles,
  Activity,
  Brain,
  Target,
  Shield,
  GitBranch,
  ChevronDown,
  ChevronRight,
  Wrench,
  Eye,
  BarChart3,
} from 'lucide-react'
import clsx from 'clsx'
import { getProposals } from '../api/client'

interface NavItem {
  to: string
  icon: any
  label: string
  end?: boolean
  badge?: number
}

const mainNavItems: NavItem[] = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/agents', icon: Bot, label: 'Agents' },
  { to: '/organization', icon: Building2, label: 'Organization' },
  { to: '/runs', icon: PlayCircle, label: 'Runs' },
  { to: '/schedules', icon: Clock, label: 'Schedules' },
]

// Grouped under "Operations" — monitoring & observability
const operationsItems: NavItem[] = [
  { to: '/heartbeat', icon: Activity, label: 'Heartbeat' },
  { to: '/logs', icon: ScrollText, label: 'Logs' },
  { to: '/costs', icon: TrendingUp, label: 'Costs' },
  { to: '/budgets', icon: Wallet, label: 'Budgets' },
]

// Grouped under "Runtime" — goals, policies, workflows, memory
const runtimeItems: NavItem[] = [
  { to: '/goals', icon: Target, label: 'Goals & Plans' },
  { to: '/workflows', icon: GitBranch, label: 'Workflows' },
  { to: '/tool-policies', icon: Shield, label: 'Tool Governance' },
  { to: '/memory', icon: Brain, label: 'Memory' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

function NavItemLink({ item }: { item: NavItem }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        clsx(
          'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150',
          isActive
            ? 'bg-accent-purple/20 text-accent-purple border border-accent-purple/30'
            : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
        )
      }
    >
      <item.icon className="w-4.5 h-4.5 shrink-0" size={18} />
      <span className="flex-1">{item.label}</span>
      {item.badge !== undefined && item.badge > 0 && (
        <span className="ml-auto px-1.5 py-0.5 text-xs bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded-full">
          {item.badge}
        </span>
      )}
    </NavLink>
  )
}

function CollapsibleSection({ title, icon: Icon, items, defaultOpen = false }: {
  title: string
  icon: any
  items: NavItem[]
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-300 transition-colors duration-150"
      >
        <Icon size={14} className="shrink-0" />
        <span className="flex-1 text-left">{title}</span>
        {open ? (
          <ChevronDown size={14} className="shrink-0" />
        ) : (
          <ChevronRight size={14} className="shrink-0" />
        )}
      </button>
      <div
        className={clsx(
          'overflow-hidden transition-all duration-300 ease-in-out',
          open ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        <ul className="space-y-1 mt-1">
          {items.map((item) => (
            <li key={item.to}>
              <NavItemLink item={item} />
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}

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
        {/* ── Main Navigation ── */}
        <ul className="space-y-1">
          {mainNavItems.map((item) => (
            <li key={item.to}>
              <NavItemLink item={item} />
            </li>
          ))}

          {/* Proposals with badge */}
          <li>
            <NavLink
              to="/organization"
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150',
                  isActive
                    ? 'bg-accent-purple/20 text-accent-purple border border-accent-purple/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                )
              }
            >
              <ClipboardList size={18} className="shrink-0" />
              <span className="flex-1">Proposals</span>
              {pendingCount > 0 && (
                <span className="ml-auto px-1.5 py-0.5 text-xs bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 rounded-full">
                  {pendingCount}
                </span>
              )}
            </NavLink>
          </li>
        </ul>

        {/* ── Divider ── */}
        <div className="my-4 border-t border-dark-border" />

        {/* ── Operations (monitoring, costs, logs) ── */}
        <CollapsibleSection title="Operations" icon={Eye} items={operationsItems} />

        {/* ── Spacer ── */}
        <div className="my-2" />

        {/* ── Runtime (goals, workflows, policies, memory) ── */}
        <CollapsibleSection title="Runtime" icon={Wrench} items={runtimeItems} />
      </nav>

      {/* Business Setup quick link */}
      <div className="px-3 pb-3">
        <NavLink
          to="/business-setup"
          className="flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-all duration-150 border border-dashed border-dark-border"
        >
          <Sparkles size={16} className="shrink-0 text-yellow-400" />
          <span>AI Business Setup</span>
        </NavLink>
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-dark-border">
        <p className="text-xs text-slate-600">v1.0.0</p>
      </div>
    </aside>
  )
}
