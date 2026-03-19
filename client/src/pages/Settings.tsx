import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Settings,
  Bot,
  Plus,
  Trash2,
  Check,
  Send,
  Eye,
  EyeOff,
} from 'lucide-react'
import {
  getAgents,
  getTelegramRoutes,
  setTelegramRoute,
  addTelegramCommandRoute,
  removeTelegramCommandRoute,
  Agent,
  TelegramRoutes,
} from '../api/client'
import { useToast } from '../components/Toaster'

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-dark-card border border-dark-border rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-dark-border">
        <h2 className="text-base font-semibold text-white">{title}</h2>
        {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

// ─── Telegram Routing Section ─────────────────────────────────────────────────

function TelegramSection({ agents }: { agents: Agent[] }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [newCommand, setNewCommand] = useState('')
  const [newCommandAgent, setNewCommandAgent] = useState('')

  const { data: routesData, isLoading } = useQuery({
    queryKey: ['telegramRoutes'],
    queryFn: getTelegramRoutes,
  })

  const routes: TelegramRoutes = routesData?.data ?? { defaultAgentId: null, commandRoutes: {} }
  const agentMap = new Map(agents.map((a) => [a.id, a]))

  const setDefaultMutation = useMutation({
    mutationFn: (agentId: string) => setTelegramRoute(agentId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['telegramRoutes'] })
      toast.success('Default Telegram agent updated')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const addRouteMutation = useMutation({
    mutationFn: () => {
      const cmd = newCommand.startsWith('/') ? newCommand : `/${newCommand}`
      return addTelegramCommandRoute(cmd, newCommandAgent)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['telegramRoutes'] })
      toast.success('Command route added')
      setNewCommand('')
      setNewCommandAgent('')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const removeRouteMutation = useMutation({
    mutationFn: (command: string) => removeTelegramCommandRoute(command),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['telegramRoutes'] })
      toast.success('Route removed')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-24">
        <div className="w-5 h-5 border-2 border-accent-purple border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Default Agent */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">
          Default Agent <span className="text-slate-500 font-normal">(handles free-text messages)</span>
        </label>
        <div className="flex gap-3">
          <select
            defaultValue={routes.defaultAgentId || ''}
            onChange={(e) => {
              if (e.target.value) setDefaultMutation.mutate(e.target.value)
            }}
            className="flex-1 px-4 py-2.5 bg-dark-bg border border-dark-border rounded-xl text-sm text-slate-200 focus:outline-none focus:border-accent-purple/50"
          >
            <option value="">No default agent</option>
            {agents.filter((a) => a.status === 'active').map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.type})
              </option>
            ))}
          </select>
          {routes.defaultAgentId && (
            <div className="flex items-center gap-2 px-3 py-2.5 bg-green-500/10 border border-green-500/20 rounded-xl">
              <Check className="w-4 h-4 text-green-400" />
              <span className="text-xs text-green-400">Active</span>
            </div>
          )}
        </div>
        {routes.defaultAgentId && (
          <p className="text-xs text-slate-500 mt-2">
            Current: <span className="text-slate-300">{agentMap.get(routes.defaultAgentId)?.name || routes.defaultAgentId}</span>
          </p>
        )}
      </div>

      {/* Command Routes */}
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-3">
          Command Routes <span className="text-slate-500 font-normal">(e.g. /research → Research Agent)</span>
        </label>

        {Object.keys(routes.commandRoutes).length === 0 ? (
          <p className="text-xs text-slate-500 mb-3">No command routes configured. Add one below.</p>
        ) : (
          <div className="space-y-2 mb-3">
            {Object.entries(routes.commandRoutes).map(([command, agentId]) => {
              const agent = agentMap.get(agentId)
              return (
                <div
                  key={command}
                  className="flex items-center justify-between px-4 py-3 bg-dark-bg border border-dark-border rounded-xl"
                >
                  <div className="flex items-center gap-3">
                    <code className="text-sm font-mono text-accent-purple">{command}</code>
                    <span className="text-slate-500 text-sm">→</span>
                    <div className="flex items-center gap-1.5">
                      <Bot className="w-3.5 h-3.5 text-slate-400" />
                      <span className="text-sm text-slate-300">{agent?.name || agentId}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => removeRouteMutation.mutate(command)}
                    disabled={removeRouteMutation.isPending}
                    className="p-1.5 text-slate-500 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              )
            })}
          </div>
        )}

        {/* Add new route */}
        <div className="flex gap-2">
          <input
            type="text"
            value={newCommand}
            onChange={(e) => setNewCommand(e.target.value)}
            placeholder="/command"
            className="w-36 px-3 py-2.5 bg-dark-bg border border-dark-border rounded-xl text-sm text-slate-200 font-mono placeholder-slate-600 focus:outline-none focus:border-accent-purple/50"
          />
          <select
            value={newCommandAgent}
            onChange={(e) => setNewCommandAgent(e.target.value)}
            className="flex-1 px-3 py-2.5 bg-dark-bg border border-dark-border rounded-xl text-sm text-slate-200 focus:outline-none focus:border-accent-purple/50"
          >
            <option value="">Select agent...</option>
            {agents.filter((a) => a.status === 'active').map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
          <button
            onClick={() => addRouteMutation.mutate()}
            disabled={!newCommand || !newCommandAgent || addRouteMutation.isPending}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-accent-purple hover:bg-purple-600 disabled:opacity-50 text-white text-sm rounded-xl transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add
          </button>
        </div>
        <p className="text-xs text-slate-600 mt-2">
          Tip: In Telegram, use /bind research Research-Agent to add routes via bot.
        </p>
      </div>

      {/* Bot Commands Info */}
      <div className="bg-dark-bg border border-dark-border rounded-xl p-4">
        <p className="text-xs font-medium text-slate-400 mb-2">Telegram Bot Commands</p>
        <div className="grid grid-cols-2 gap-1 text-xs text-slate-500 font-mono">
          {[
            ['/route list', 'List agents'],
            ['/route set <agent>', 'Set default'],
            ['/routes', 'Show routes'],
            ['/bind <cmd> <agent>', 'Add command route'],
            ['/settings', 'Show config'],
            ['/run <agent> [input]', 'Run an agent'],
          ].map(([cmd, desc]) => (
            <div key={cmd} className="flex gap-2">
              <span className="text-accent-purple">{cmd}</span>
              <span className="text-slate-600">— {desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Security Section ─────────────────────────────────────────────────────────

function SecuritySection() {
  const [showSecret, setShowSecret] = useState(false)

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">API Secret Key</label>
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <input
              type={showSecret ? 'text' : 'password'}
              defaultValue="(stored in .env file)"
              readOnly
              className="w-full px-4 py-2.5 bg-dark-bg border border-dark-border rounded-xl text-sm text-slate-400 font-mono focus:outline-none pr-10"
            />
            <button
              onClick={() => setShowSecret(!showSecret)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <p className="text-xs text-slate-600 mt-2">
          Set API_SECRET in your .env file. Required in X-API-Key header for write operations.
        </p>
      </div>

      <div className="bg-dark-bg border border-dark-border rounded-xl p-4">
        <p className="text-xs font-medium text-slate-400 mb-2">Security Notes</p>
        <ul className="text-xs text-slate-500 space-y-1 list-disc list-inside">
          <li>All GET requests are public (read-only without auth)</li>
          <li>POST/PUT/DELETE require X-API-Key header</li>
          <li>Telegram bot uses authorized user IDs from TELEGRAM_AUTHORIZED_USERS</li>
          <li>API keys are stored in .env file on the server</li>
        </ul>
      </div>
    </div>
  )
}

// ─── AI Providers Section ─────────────────────────────────────────────────────

function AIProvidersSection() {
  return (
    <div className="space-y-4">
      {[
        {
          name: 'Anthropic (Claude)',
          envKey: 'ANTHROPIC_API_KEY',
          models: ['claude-sonnet-4-6', 'claude-opus-4-6', 'claude-haiku-4-5'],
          color: 'text-orange-400',
        },
        {
          name: 'OpenAI',
          envKey: 'OPENAI_API_KEY',
          models: ['gpt-4o', 'gpt-4o-mini', 'o3', 'o4-mini'],
          color: 'text-green-400',
        },
      ].map((provider) => (
        <div key={provider.name} className="bg-dark-bg border border-dark-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <p className={`text-sm font-semibold ${provider.color}`}>{provider.name}</p>
            <span className="text-xs text-slate-500 font-mono">{provider.envKey}</span>
          </div>
          <p className="text-xs text-slate-500 mb-2">
            Set in your .env file on the server. Available models:
          </p>
          <div className="flex flex-wrap gap-1">
            {provider.models.map((m) => (
              <span key={m} className="text-xs px-2 py-0.5 bg-dark-card border border-dark-border rounded text-slate-400 font-mono">
                {m}
              </span>
            ))}
          </div>
        </div>
      ))}

      <p className="text-xs text-slate-600">
        To change API keys, edit your .env file and restart the server.
      </p>
    </div>
  )
}

// ─── Main Settings Page ───────────────────────────────────────────────────────

export default function SettingsPage() {
  const { data: agentsData } = useQuery({
    queryKey: ['agents'],
    queryFn: () => import('../api/client').then((m) => m.getAgents()),
  })

  const agents = agentsData?.data ?? []

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Settings className="w-6 h-6 text-slate-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <p className="text-sm text-slate-400 mt-0.5">Configure AgentHub</p>
        </div>
      </div>

      <Section title="Security" description="API key and access control">
        <SecuritySection />
      </Section>

      <Section title="AI Providers" description="Configure your AI API keys">
        <AIProvidersSection />
      </Section>

      <Section
        title="Telegram Routing"
        description="Route Telegram messages to agents"
      >
        <TelegramSection agents={agents} />
      </Section>

      <Section title="Appearance" description="UI customization (coming soon)">
        <div className="flex items-center justify-center h-20 text-slate-600">
          <p className="text-sm">More settings coming soon...</p>
        </div>
      </Section>
    </div>
  )
}
