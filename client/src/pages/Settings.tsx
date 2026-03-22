import { useState, useEffect } from 'react'
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
  Key,
  Shield,
  Loader2,
  ToggleLeft,
  ToggleRight,
  FlaskConical,
  Zap,
  Brain,
  Clock,
  ShieldOff,
  Play,
} from 'lucide-react'
import {
  getAgents,
  getTelegramRoutes,
  setTelegramRoute,
  addTelegramCommandRoute,
  removeTelegramCommandRoute,
  getApiKeys,
  addApiKey,
  deleteApiKey,
  testApiKeyById,
  toggleApiKey,
  getAssistantSettings,
  setAssistantSettings,
  getTelegramStatus,
  setTelegramToken,
  getAutonomySettings,
  updateAutonomySettings,
  triggerCeoCycle,
  Agent,
  TelegramRoutes,
  ApiKeyEntry,
  AutonomySettings,
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

// ─── Assistant Config Section ─────────────────────────────────────────────────

function AssistantSection() {
  const toast = useToast()
  const [provider, setProvider] = useState('anthropic')
  const [model, setModel] = useState('')
  const [saving, setSaving] = useState(false)

  const { data: settingsData } = useQuery({
    queryKey: ['assistantSettings'],
    queryFn: getAssistantSettings,
  })

  useEffect(() => {
    if (settingsData?.data) {
      setProvider(settingsData.data.provider || 'anthropic')
      setModel(settingsData.data.model || '')
    }
  }, [settingsData])

  const handleSave = async () => {
    setSaving(true)
    try {
      await setAssistantSettings(provider, model)
      toast.success('Assistant settings saved')
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">Provider</label>
        <select value={provider} onChange={(e) => setProvider(e.target.value)}
          className="w-full px-4 py-2.5 bg-dark-bg border border-dark-border rounded-xl text-sm text-slate-200 focus:outline-none focus:border-accent-purple/50">
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="openai">OpenAI (GPT)</option>
        </select>
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-2">Model</label>
        <input type="text" value={model} onChange={(e) => setModel(e.target.value)}
          placeholder={provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o'}
          className="w-full px-4 py-2.5 bg-dark-bg border border-dark-border rounded-xl text-sm text-slate-200 placeholder-slate-600 font-mono focus:outline-none focus:border-accent-purple/50" />
        <p className="text-xs text-slate-500 mt-1">Leave empty to use default model. Uses API keys from the API Keys section.</p>
      </div>
      <button onClick={handleSave} disabled={saving}
        className="flex items-center gap-2 px-4 py-2.5 bg-accent-purple hover:bg-purple-600 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
        Save Settings
      </button>
    </div>
  )
}

// ─── Telegram Token Input ────────────────────────────────────────────────────

function TelegramTokenInput() {
  const toast = useToast()
  const [token, setToken] = useState('')
  const [showToken, setShowToken] = useState(false)
  const [saving, setSaving] = useState(false)

  const { data: statusData } = useQuery({
    queryKey: ['telegramStatus'],
    queryFn: getTelegramStatus,
  })

  const status = statusData?.data

  const handleSave = async () => {
    if (!token.trim()) return
    setSaving(true)
    try {
      await setTelegramToken(token.trim())
      toast.success('Telegram token saved. Restart server to connect.')
      setToken('')
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${status?.connected ? 'bg-green-500' : 'bg-red-500'}`} />
        <span className="text-xs text-slate-400">
          {status?.connected ? `Connected (${status.token})` : 'Not connected'}
        </span>
      </div>
      <div className="flex gap-2">
        <input
          type={showToken ? 'text' : 'password'}
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Enter new bot token from @BotFather..."
          className="flex-1 px-3 py-2.5 bg-dark-bg border border-dark-border rounded-xl text-sm text-slate-200 placeholder-slate-600 font-mono focus:outline-none focus:border-accent-purple/50"
        />
        <button onClick={() => setShowToken(!showToken)} className="px-2.5 text-slate-400 hover:text-slate-200">
          {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
        <button onClick={handleSave} disabled={!token.trim() || saving}
          className="px-4 py-2.5 bg-accent-purple hover:bg-purple-600 disabled:opacity-50 text-white text-sm rounded-xl transition-colors">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save'}
        </button>
      </div>
      <p className="text-xs text-slate-600">Get a bot token from <a href="https://t.me/BotFather" target="_blank" rel="noopener" className="text-accent-purple hover:underline">@BotFather</a> on Telegram. Server restart required after changing.</p>
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
      {/* Telegram Bot Token */}
      <div className="mb-6 pb-6 border-b border-dark-border">
        <label className="block text-sm font-medium text-slate-300 mb-2">Bot Token</label>
        <TelegramTokenInput />
      </div>

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

// ─── API Keys Section ─────────────────────────────────────────────────────────

function ApiKeysSection() {
  const qc = useQueryClient()
  const toast = useToast()
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newProvider, setNewProvider] = useState('anthropic')
  const [newKey, setNewKey] = useState('')
  const [testingId, setTestingId] = useState<string | null>(null)

  const { data: keysData, isLoading } = useQuery({
    queryKey: ['apiKeys'],
    queryFn: getApiKeys,
  })

  const keys: ApiKeyEntry[] = keysData?.data ?? []

  const addMutation = useMutation({
    mutationFn: () => addApiKey(newName, newProvider, newKey),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['apiKeys'] })
      toast.success('API key added securely')
      setShowAdd(false)
      setNewName('')
      setNewProvider('anthropic')
      setNewKey('')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteApiKey(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['apiKeys'] })
      toast.success('API key removed')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => toggleApiKey(id, isActive),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['apiKeys'] })
      toast.success('API key updated')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const handleTest = async (id: string) => {
    setTestingId(id)
    try {
      const result = await testApiKeyById(id)
      if (result.valid) {
        toast.success(`Key is valid! ${result.model ? `Model: ${result.model}` : result.modelCount ? `${result.modelCount} models available` : ''}`)
      } else {
        toast.error(`Key test failed: ${result.error || 'Unknown error'}`)
      }
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setTestingId(null)
    }
  }

  const providerColors: Record<string, string> = {
    anthropic: 'text-orange-400 border-orange-500/30 bg-orange-500/10',
    openai: 'text-green-400 border-green-500/30 bg-green-500/10',
    custom: 'text-blue-400 border-blue-500/30 bg-blue-500/10',
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-24">
        <div className="w-5 h-5 border-2 border-accent-purple border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Existing keys */}
      {keys.length === 0 ? (
        <div className="text-center py-6">
          <Key className="w-8 h-8 text-slate-600 mx-auto mb-2" />
          <p className="text-sm text-slate-500">No API keys stored yet</p>
          <p className="text-xs text-slate-600 mt-1">Keys are encrypted at rest with AES-256-GCM</p>
        </div>
      ) : (
        <div className="space-y-2">
          {keys.map((k) => (
            <div key={k.id} className="flex items-center gap-3 px-4 py-3 bg-dark-bg border border-dark-border rounded-xl">
              <span className={`text-xs px-2 py-0.5 rounded border font-medium ${providerColors[k.provider] || providerColors.custom}`}>
                {k.provider}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-200 truncate">{k.name}</p>
                <p className="text-xs text-slate-500 font-mono">••••••••{k.keyHint}</p>
              </div>
              <button
                onClick={() => toggleMutation.mutate({ id: k.id, isActive: !k.isActive })}
                className="text-slate-400 hover:text-slate-200 transition-colors"
                title={k.isActive ? 'Disable' : 'Enable'}
              >
                {k.isActive ? (
                  <ToggleRight className="w-5 h-5 text-green-400" />
                ) : (
                  <ToggleLeft className="w-5 h-5 text-slate-500" />
                )}
              </button>
              <button
                onClick={() => handleTest(k.id)}
                disabled={testingId === k.id}
                className="p-1.5 text-slate-400 hover:text-accent-purple transition-colors disabled:opacity-50"
                title="Test key"
              >
                {testingId === k.id ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <FlaskConical className="w-4 h-4" />
                )}
              </button>
              <button
                onClick={() => deleteMutation.mutate(k.id)}
                disabled={deleteMutation.isPending}
                className="p-1.5 text-slate-500 hover:text-red-400 transition-colors"
                title="Delete key"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add new key */}
      {showAdd ? (
        <div className="bg-dark-bg border border-dark-border rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Name</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="My Anthropic Key"
                className="w-full px-3 py-2 bg-dark-card border border-dark-border rounded-lg text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent-purple/50"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Provider</label>
              <select
                value={newProvider}
                onChange={(e) => setNewProvider(e.target.value)}
                className="w-full px-3 py-2 bg-dark-card border border-dark-border rounded-lg text-sm text-slate-200 focus:outline-none focus:border-accent-purple/50"
              >
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai">OpenAI</option>
                <option value="custom">Custom</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">API Key</label>
            <input
              type="password"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="sk-..."
              className="w-full px-3 py-2 bg-dark-card border border-dark-border rounded-lg text-sm text-slate-200 placeholder-slate-600 font-mono focus:outline-none focus:border-accent-purple/50"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => addMutation.mutate()}
              disabled={!newName || !newKey || addMutation.isPending}
              className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 bg-accent-purple hover:bg-purple-600 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
            >
              {addMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
              Encrypt & Save
            </button>
            <button
              onClick={() => { setShowAdd(false); setNewKey('') }}
              className="px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-300 text-sm rounded-lg border border-dark-border"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-dark-bg border border-dashed border-dark-border rounded-xl text-sm text-slate-400 hover:text-slate-200 hover:border-accent-purple/50 transition-colors w-full justify-center"
        >
          <Plus className="w-4 h-4" />
          Add API Key
        </button>
      )}

      <div className="bg-dark-bg border border-dark-border rounded-xl p-3">
        <p className="text-xs text-slate-500">
          <Shield className="w-3 h-3 inline mr-1" />
          Keys are encrypted with AES-256-GCM at rest. Only the last 4 characters are visible.
          Fallback: keys from .env file are still used if no DB key exists for a provider.
        </p>
      </div>
    </div>
  )
}

// ─── Main Settings Page ───────────────────────────────────────────────────────

// ─── Appearance Section ──────────────────────────────────────────────────────

const TEXT_SIZES = [
  { value: 'xs', label: 'Extra Small', scale: '0.85' },
  { value: 'sm', label: 'Small', scale: '0.925' },
  { value: 'md', label: 'Medium (Default)', scale: '1' },
  { value: 'lg', label: 'Large', scale: '1.1' },
  { value: 'xl', label: 'Extra Large', scale: '1.2' },
]

function AutonomySection() {
  const toast = useToast()
  const queryClient = useQueryClient()

  const { data: settings, isLoading } = useQuery({
    queryKey: ['autonomy-settings'],
    queryFn: getAutonomySettings,
  })

  const updateMutation = useMutation({
    mutationFn: (data: Partial<AutonomySettings>) => updateAutonomySettings(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['autonomy-settings'] })
      toast('Autonomy settings updated')
    },
    onError: (err: any) => toast(`Error: ${err.message}`, 'error'),
  })

  const triggerMutation = useMutation({
    mutationFn: triggerCeoCycle,
    onSuccess: () => toast('CEO cycle triggered'),
    onError: (err: any) => toast(`Error: ${err.message}`, 'error'),
  })

  if (isLoading || !settings) return <div className="text-sm text-slate-500">Loading...</div>

  const toggles: { key: keyof AutonomySettings; label: string; description: string; icon: any; danger?: boolean }[] = [
    {
      key: 'approvalGates',
      label: 'Approval Gates',
      description: settings.approvalGates === 'on'
        ? 'ON — Agents must wait for human approval where policies require it'
        : 'OFF — Full autonomy: all approval requirements are bypassed',
      icon: settings.approvalGates === 'on' ? Shield : ShieldOff,
      danger: settings.approvalGates === 'off',
    },
    {
      key: 'ceoAutoPilot',
      label: 'CEO Auto-Pilot',
      description: settings.ceoAutoPilot === 'on'
        ? `ON — CEO runs every ${settings.ceoIntervalMinutes} min, reviews goals & proposes actions`
        : 'OFF — CEO only runs when manually triggered',
      icon: Brain,
    },
    {
      key: 'autoExecuteGoals',
      label: 'Auto-Execute Goal Steps',
      description: settings.autoExecuteGoals === 'on'
        ? 'ON — Ready steps are automatically executed during CEO cycles'
        : 'OFF — Steps must be manually triggered via Dashboard or API',
      icon: Zap,
    },
  ]

  return (
    <div className="space-y-4">
      {toggles.map(({ key, label, description, icon: Icon, danger }) => (
        <div key={key} className={`flex items-center justify-between p-4 rounded-xl border ${danger ? 'bg-red-500/5 border-red-500/20' : 'bg-dark-bg border-dark-border'}`}>
          <div className="flex items-center gap-3 flex-1">
            <div className={`p-2 rounded-lg ${danger ? 'bg-red-500/20 text-red-400' : 'bg-accent-purple/20 text-accent-purple'}`}>
              <Icon className="w-4 h-4" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-200">{label}</p>
              <p className="text-xs text-slate-500 mt-0.5">{description}</p>
            </div>
          </div>
          <button
            onClick={() => updateMutation.mutate({ [key]: settings[key] === 'on' ? 'off' : 'on' } as any)}
            className="shrink-0 ml-4"
          >
            {settings[key] === 'on' ? (
              <ToggleRight className="w-8 h-8 text-accent-purple" />
            ) : (
              <ToggleLeft className="w-8 h-8 text-slate-600" />
            )}
          </button>
        </div>
      ))}

      {/* CEO Interval */}
      {settings.ceoAutoPilot === 'on' && (
        <div className="flex items-center gap-4 p-4 bg-dark-bg border border-dark-border rounded-xl">
          <div className="p-2 rounded-lg bg-accent-purple/20 text-accent-purple">
            <Clock className="w-4 h-4" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-slate-200">CEO Interval</p>
            <p className="text-xs text-slate-500">How often the CEO reviews and acts</p>
          </div>
          <select
            value={settings.ceoIntervalMinutes}
            onChange={e => updateMutation.mutate({ ceoIntervalMinutes: parseInt(e.target.value) } as any)}
            className="px-3 py-1.5 bg-dark-card border border-dark-border rounded-lg text-sm text-slate-200"
          >
            <option value="5">5 min</option>
            <option value="15">15 min</option>
            <option value="30">30 min</option>
            <option value="60">1 hour</option>
            <option value="120">2 hours</option>
            <option value="360">6 hours</option>
            <option value="1440">24 hours</option>
          </select>
        </div>
      )}

      {/* Rate limit */}
      <div className="flex items-center gap-4 p-4 bg-dark-bg border border-dark-border rounded-xl">
        <div className="p-2 rounded-lg bg-accent-purple/20 text-accent-purple">
          <Zap className="w-4 h-4" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-slate-200">Max Auto-Runs / Hour</p>
          <p className="text-xs text-slate-500">Safety limit for automated execution</p>
        </div>
        <select
          value={settings.maxAutoRunsPerHour}
          onChange={e => updateMutation.mutate({ maxAutoRunsPerHour: parseInt(e.target.value) } as any)}
          className="px-3 py-1.5 bg-dark-card border border-dark-border rounded-lg text-sm text-slate-200"
        >
          <option value="5">5</option>
          <option value="10">10</option>
          <option value="20">20</option>
          <option value="50">50</option>
          <option value="100">100</option>
        </select>
      </div>

      {/* Manual trigger */}
      <button
        onClick={() => triggerMutation.mutate()}
        disabled={triggerMutation.isPending}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-accent-purple/10 hover:bg-accent-purple/20 text-accent-purple border border-accent-purple/30 rounded-xl text-sm font-medium transition-colors"
      >
        {triggerMutation.isPending ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Play className="w-4 h-4" />
        )}
        Trigger CEO Cycle Now
      </button>
    </div>
  )
}

function AppearanceSection() {
  const [textSize, setTextSize] = useState(() => localStorage.getItem('agenthub-text-size') || 'md')

  useEffect(() => {
    localStorage.setItem('agenthub-text-size', textSize)
    const scale = TEXT_SIZES.find((s) => s.value === textSize)?.scale || '1'
    document.documentElement.style.fontSize = `${parseFloat(scale) * 16}px`
  }, [textSize])

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-300 mb-3">Text Size</label>
        <div className="grid grid-cols-5 gap-2">
          {TEXT_SIZES.map((size) => (
            <button
              key={size.value}
              onClick={() => setTextSize(size.value)}
              className={`px-3 py-2.5 rounded-lg border text-center transition-colors ${
                textSize === size.value
                  ? 'border-accent-purple/60 bg-accent-purple/10 text-slate-200'
                  : 'border-dark-border text-slate-400 hover:border-slate-500 hover:text-slate-300'
              }`}
            >
              <p className="text-xs font-semibold">{size.label}</p>
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Changes the base font size of the entire control panel. Takes effect immediately.
        </p>
      </div>

      {/* Preview */}
      <div className="bg-dark-bg border border-dark-border rounded-xl p-4">
        <p className="text-xs text-slate-500 uppercase tracking-wider mb-2">Preview</p>
        <p className="text-sm text-slate-300">This is how your panel text will look at the selected size.</p>
        <p className="text-xs text-slate-500 mt-1">Smaller text like labels, timestamps, and descriptions.</p>
      </div>
    </div>
  )
}

export default function SettingsPage() {
  const { data: agentsData } = useQuery({
    queryKey: ['agents'],
    queryFn: () => import('../api/client').then((m) => m.getAgents()),
  })

  const agents = agentsData?.data ?? []

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <Settings className="w-6 h-6 text-slate-400" />
        <div>
          <h1 className="text-2xl font-bold text-white">Settings</h1>
          <p className="text-sm text-slate-400 mt-0.5">Configure AgentHub</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Section title="AgentHub Assistant" description="Configure the built-in AI assistant (bottom-right chat)">
          <AssistantSection />
        </Section>

        <Section title="Security" description="API key and access control">
          <SecuritySection />
        </Section>
      </div>

      <Section title="API Keys" description="Securely manage your AI provider API keys">
        <ApiKeysSection />
      </Section>

      <Section
        title="Telegram Routing"
        description="Route Telegram messages to agents"
      >
        <TelegramSection agents={agents} />
      </Section>

      <Section title="Autonomy & CEO Auto-Pilot" description="Control how much freedom your AI agents have">
        <AutonomySection />
      </Section>

      <Section title="Appearance" description="Customize the control panel look and feel">
        <AppearanceSection />
      </Section>
    </div>
  )
}
