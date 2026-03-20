import React, { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Eye,
  EyeOff,
  ChevronRight,
  ChevronLeft,
  Check,
  RefreshCw,
  Copy,
  Globe,
  Bot,
  Zap,
  Terminal,
  Send,
  CheckCircle,
  AlertCircle,
  Loader2,
  Database,
  Server,
} from 'lucide-react'
import {
  getSetupStatus,
  completeSetup,
  saveApiKeys,
  saveTelegramConfig,
  testTelegram,
  createAgent,
  getPresets,
  discoverOpenclaw,
  AgentPreset,
} from '../api/client'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SetupStatus {
  complete: boolean
  dbMode: 'sqlite' | 'postgres'
  schedulerMode: 'cron' | 'bullmq'
  steps: {
    apiKeys: boolean
    telegram: boolean
    firstAgent: boolean
  }
}

type AgentType = 'http' | 'claude' | 'openai' | 'bash'

// ─── Helper: generate random API secret ───────────────────────────────────────

function generateSecret(len = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  const arr = new Uint8Array(len)
  crypto.getRandomValues(arr)
  for (let i = 0; i < len; i++) {
    result += chars[arr[i] % chars.length]
  }
  return result
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProgressBar({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {Array.from({ length: total }).map((_, i) => (
        <React.Fragment key={i}>
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold transition-all duration-300 ${
              i < current
                ? 'bg-accent-purple text-white'
                : i === current
                ? 'bg-accent-purple/30 border-2 border-accent-purple text-accent-purple'
                : 'bg-dark-border text-slate-500'
            }`}
          >
            {i < current ? <Check className="w-4 h-4" /> : i + 1}
          </div>
          {i < total - 1 && (
            <div
              className={`h-0.5 w-8 transition-all duration-300 ${
                i < current ? 'bg-accent-purple' : 'bg-dark-border'
              }`}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  )
}

function PasswordInput({
  value,
  onChange,
  placeholder,
  className = '',
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2.5 pr-10 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent-purple transition-colors ${className}`}
      />
      <button
        type="button"
        onClick={() => setShow((v) => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
      >
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  )
}

// ─── Step 0: Welcome ──────────────────────────────────────────────────────────

function StepWelcome({
  status,
  onNext,
}: {
  status: SetupStatus | null
  onNext: () => void
}) {
  return (
    <div className="text-center space-y-6">
      <div className="flex justify-center">
        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-accent-purple to-accent-blue flex items-center justify-center shadow-lg shadow-accent-purple/30">
          <Zap className="w-10 h-10 text-white" />
        </div>
      </div>

      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Welcome to AgentHub</h1>
        <p className="text-slate-400 text-base">
          Let's get you set up in under 2 minutes
        </p>
      </div>

      {status && (
        <div className="bg-dark-bg border border-dark-border rounded-xl p-4 text-left space-y-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Deployment detected
          </p>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent-purple/10 border border-accent-purple/20 flex items-center justify-center">
              <Database className="w-4 h-4 text-accent-purple" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-200">
                {status.dbMode === 'postgres' ? 'PostgreSQL' : 'SQLite'} Database
              </p>
              <p className="text-xs text-slate-500">
                {status.dbMode === 'postgres'
                  ? 'Production mode — full persistence'
                  : 'Simple mode — local file storage'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-accent-blue/10 border border-accent-blue/20 flex items-center justify-center">
              <Server className="w-4 h-4 text-accent-blue" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-200">
                {status.schedulerMode === 'bullmq' ? 'BullMQ' : 'node-cron'} Scheduler
              </p>
              <p className="text-xs text-slate-500">
                {status.schedulerMode === 'bullmq'
                  ? 'Redis-backed distributed queues'
                  : 'In-process cron scheduling'}
              </p>
            </div>
          </div>
        </div>
      )}

      <button
        onClick={onNext}
        className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-accent-purple hover:bg-purple-600 text-white font-medium rounded-xl transition-colors shadow-lg shadow-accent-purple/25"
      >
        Get Started
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  )
}

// ─── Step 1: Security ─────────────────────────────────────────────────────────

function StepSecurity({
  onNext,
  onBack,
}: {
  onNext: () => void
  onBack: () => void
}) {
  const [secret, setSecret] = useState(() => generateSecret())
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)

  const copyAndContinue = async () => {
    try {
      await navigator.clipboard.writeText(secret)
      setCopied(true)
    } catch {
      // Clipboard API may fail in some browsers — continue anyway
    }
    setSaving(true)
    try {
      await saveApiKeys({ apiSecret: secret } as any)
      localStorage.setItem('agenthub_api_key', secret)
    } catch (err) {
      console.warn('[Setup] Failed to persist API secret:', err)
      // Still set it locally
      localStorage.setItem('agenthub_api_key', secret)
    }
    setSaving(false)
    onNext()
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-1">Secure your installation</h2>
        <p className="text-slate-400 text-sm">
          This API secret protects your AgentHub from unauthorized access.
        </p>
      </div>

      <div className="bg-dark-bg border border-dark-border rounded-xl p-4 space-y-3">
        <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider">
          API Secret
        </label>
        <PasswordInput
          value={secret}
          onChange={setSecret}
          placeholder="Your API secret..."
        />
        <div className="flex gap-2">
          <button
            onClick={() => setSecret(generateSecret())}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 bg-white/5 hover:bg-white/10 border border-dark-border rounded-lg transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Regenerate
          </button>
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(secret).catch(() => {})
              setCopied(true)
              setTimeout(() => setCopied(false), 2000)
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 bg-white/5 hover:bg-white/10 border border-dark-border rounded-lg transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 flex gap-3">
        <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
        <p className="text-xs text-amber-300">
          Save this secret somewhere safe. You'll need it to authenticate API requests and won't
          be able to retrieve it later.
        </p>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-400 hover:text-slate-200 bg-white/5 hover:bg-white/10 border border-dark-border rounded-xl transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Back
        </button>
        <button
          onClick={copyAndContinue}
          disabled={!secret.trim() || saving}
          className="flex-1 flex items-center justify-center gap-2 px-6 py-2.5 bg-accent-purple hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-colors"
        >
          {saving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
          Copy & Continue
        </button>
      </div>
    </div>
  )
}

// ─── Step 2: AI Providers ─────────────────────────────────────────────────────

function StepProviders({
  onNext,
  onBack,
}: {
  onNext: () => void
  onBack: () => void
}) {
  const [anthropicKey, setAnthropicKey] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [anthropicStatus, setAnthropicStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle')
  const [openaiStatus, setOpenaiStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle')
  const [saving, setSaving] = useState(false)

  const testAnthropicKey = async () => {
    if (!anthropicKey.trim()) return
    setAnthropicStatus('testing')
    try {
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': anthropicKey.trim(),
          'anthropic-version': '2023-06-01',
        },
      })
      setAnthropicStatus(res.ok ? 'ok' : 'error')
    } catch {
      setAnthropicStatus('error')
    }
  }

  const testOpenAIKey = async () => {
    if (!openaiKey.trim()) return
    setOpenaiStatus('testing')
    try {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${openaiKey.trim()}` },
      })
      setOpenaiStatus(res.ok ? 'ok' : 'error')
    } catch {
      setOpenaiStatus('error')
    }
  }

  const handleContinue = async () => {
    setSaving(true)
    try {
      if (anthropicKey.trim() || openaiKey.trim()) {
        await saveApiKeys({
          anthropicKey: anthropicKey.trim() || undefined,
          openaiKey: openaiKey.trim() || undefined,
        })
      }
    } catch (err) {
      console.warn('[Setup] Failed to save API keys:', err)
    }
    setSaving(false)
    onNext()
  }

  const StatusIcon = ({ status }: { status: 'idle' | 'testing' | 'ok' | 'error' }) => {
    if (status === 'testing') return <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
    if (status === 'ok') return <CheckCircle className="w-4 h-4 text-green-400" />
    if (status === 'error') return <AlertCircle className="w-4 h-4 text-red-400" />
    return null
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-1">Connect AI providers</h2>
        <p className="text-slate-400 text-sm">
          Both are optional — you can configure these later.
        </p>
      </div>

      {/* Anthropic */}
      <div className="bg-dark-bg border border-dark-border rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center justify-center text-base">
            🤖
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-200">Anthropic Claude</p>
            <p className="text-xs text-slate-500">claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5</p>
          </div>
          <StatusIcon status={anthropicStatus} />
          {anthropicStatus === 'ok' && (
            <span className="text-xs text-green-400 font-medium">Connected</span>
          )}
          {anthropicStatus === 'error' && (
            <span className="text-xs text-red-400 font-medium">Invalid</span>
          )}
        </div>
        <PasswordInput
          value={anthropicKey}
          onChange={(v) => { setAnthropicKey(v); setAnthropicStatus('idle') }}
          placeholder="sk-ant-..."
        />
        <button
          onClick={testAnthropicKey}
          disabled={!anthropicKey.trim() || anthropicStatus === 'testing'}
          className="text-xs text-accent-purple hover:text-purple-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Test connection
        </button>
      </div>

      {/* OpenAI */}
      <div className="bg-dark-bg border border-dark-border rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-green-500/10 border border-green-500/20 flex items-center justify-center text-base">
            ⚡
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-200">OpenAI</p>
            <p className="text-xs text-slate-500">gpt-5.2, gpt-5-mini, o3, o4-mini and more</p>
          </div>
          <StatusIcon status={openaiStatus} />
          {openaiStatus === 'ok' && (
            <span className="text-xs text-green-400 font-medium">Connected</span>
          )}
          {openaiStatus === 'error' && (
            <span className="text-xs text-red-400 font-medium">Invalid</span>
          )}
        </div>
        <PasswordInput
          value={openaiKey}
          onChange={(v) => { setOpenaiKey(v); setOpenaiStatus('idle') }}
          placeholder="sk-..."
        />
        <button
          onClick={testOpenAIKey}
          disabled={!openaiKey.trim() || openaiStatus === 'testing'}
          className="text-xs text-accent-purple hover:text-purple-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          Test connection
        </button>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-400 hover:text-slate-200 bg-white/5 hover:bg-white/10 border border-dark-border rounded-xl transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Back
        </button>
        <button
          onClick={handleContinue}
          disabled={saving}
          className="flex-1 flex items-center justify-center gap-2 px-6 py-2.5 bg-accent-purple hover:bg-purple-600 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Continue
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

// ─── Step 3: Telegram ─────────────────────────────────────────────────────────

function StepTelegram({
  onNext,
  onBack,
}: {
  onNext: () => void
  onBack: () => void
}) {
  const [botToken, setBotToken] = useState('')
  const [authorizedUsers, setAuthorizedUsers] = useState('')
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle')
  const [botInfo, setBotInfo] = useState<{ botName?: string; botId?: number } | null>(null)
  const [saving, setSaving] = useState(false)

  const handleTest = async () => {
    if (!botToken.trim()) return
    setTestStatus('testing')
    try {
      const result = await testTelegram(botToken.trim())
      if (result.valid) {
        setTestStatus('ok')
        setBotInfo({ botName: result.botName, botId: result.botId })
      } else {
        setTestStatus('error')
        setBotInfo(null)
      }
    } catch {
      setTestStatus('error')
      setBotInfo(null)
    }
  }

  const handleContinue = async () => {
    if (!botToken.trim()) {
      onNext()
      return
    }
    setSaving(true)
    try {
      await saveTelegramConfig({ botToken: botToken.trim(), authorizedUsers })
    } catch (err) {
      console.warn('[Setup] Failed to save Telegram config:', err)
    }
    setSaving(false)
    onNext()
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-1">Connect Telegram Bot</h2>
        <p className="text-slate-400 text-sm">
          Get notifications and control agents from Telegram. Completely optional.
        </p>
      </div>

      <div className="bg-dark-bg border border-dark-border rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <Send className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-semibold text-slate-200">Bot Token</span>
          {testStatus === 'ok' && (
            <span className="ml-auto flex items-center gap-1 text-xs text-green-400">
              <CheckCircle className="w-3.5 h-3.5" />
              @{botInfo?.botName} connected
            </span>
          )}
          {testStatus === 'error' && (
            <span className="ml-auto flex items-center gap-1 text-xs text-red-400">
              <AlertCircle className="w-3.5 h-3.5" />
              Invalid token
            </span>
          )}
        </div>

        <PasswordInput
          value={botToken}
          onChange={(v) => { setBotToken(v); setTestStatus('idle'); setBotInfo(null) }}
          placeholder="123456789:ABCdefGHIjklMNOpqrSTUvwxYZ"
        />

        <button
          onClick={handleTest}
          disabled={!botToken.trim() || testStatus === 'testing'}
          className="flex items-center gap-1.5 text-xs text-accent-purple hover:text-purple-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {testStatus === 'testing' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : null}
          Test Connection
        </button>
      </div>

      <div className="bg-dark-bg border border-dark-border rounded-xl p-4 space-y-3">
        <label className="block text-sm font-semibold text-slate-200">
          Authorized User IDs
        </label>
        <input
          type="text"
          value={authorizedUsers}
          onChange={(e) => setAuthorizedUsers(e.target.value)}
          placeholder="123456789, 987654321"
          className="w-full bg-dark-card border border-dark-border rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent-purple transition-colors"
        />
        <p className="text-xs text-slate-500">
          Comma-separated Telegram user IDs. Only these users can control agents.
        </p>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-400 hover:text-slate-200 bg-white/5 hover:bg-white/10 border border-dark-border rounded-xl transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Back
        </button>
        <button
          onClick={onNext}
          className="px-4 py-2.5 text-sm text-slate-400 hover:text-slate-200 bg-white/5 hover:bg-white/10 border border-dark-border rounded-xl transition-colors"
        >
          Skip
        </button>
        <button
          onClick={handleContinue}
          disabled={saving}
          className="flex-1 flex items-center justify-center gap-2 px-6 py-2.5 bg-accent-purple hover:bg-purple-600 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Continue
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

// ─── Step 3.5: Connect Local Agents ──────────────────────────────────────────

type CLIStatus = 'unknown' | 'checking' | 'available' | 'not-found'

interface LocalAgentState {
  claudeCode: CLIStatus
  codex: CLIStatus
  openclaw: CLIStatus
  openclawVersion: string
}

function StepLocalAgents({
  onNext,
  onBack,
}: {
  onNext: () => void
  onBack: () => void
}) {
  const [state, setState] = useState<LocalAgentState>({
    claudeCode: 'unknown',
    codex: 'unknown',
    openclaw: 'unknown',
    openclawVersion: '',
  })

  const checkAll = useCallback(async () => {
    setState({
      claudeCode: 'checking',
      codex: 'checking',
      openclaw: 'checking',
      openclawVersion: '',
    })

    // Check OpenClaw via the backend endpoint
    discoverOpenclaw('localhost', 18789)
      .then((result) => {
        setState((prev) => ({
          ...prev,
          openclaw: result.connected ? 'available' : 'not-found',
          openclawVersion: result.version || '',
        }))
      })
      .catch(() => {
        setState((prev) => ({ ...prev, openclaw: 'not-found' }))
      })

    // We cannot check Claude Code / Codex CLI from the browser.
    // We mark them as 'unknown' since we cannot run shell commands here.
    // The backend executor will surface errors when agents actually run.
    setTimeout(() => {
      setState((prev) => ({
        ...prev,
        claudeCode: prev.claudeCode === 'checking' ? 'unknown' : prev.claudeCode,
        codex: prev.codex === 'checking' ? 'unknown' : prev.codex,
      }))
    }, 500)
  }, [])

  useEffect(() => {
    checkAll()
  }, [checkAll])

  const StatusBadge = ({ status, version }: { status: CLIStatus; version?: string }) => {
    if (status === 'checking') {
      return (
        <span className="flex items-center gap-1 text-xs text-slate-400">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking...
        </span>
      )
    }
    if (status === 'available') {
      return (
        <span className="flex items-center gap-1 text-xs text-green-400 font-medium">
          <CheckCircle className="w-3.5 h-3.5" />
          Available{version ? ` v${version}` : ''}
        </span>
      )
    }
    if (status === 'not-found') {
      return (
        <span className="flex items-center gap-1 text-xs text-amber-400">
          <AlertCircle className="w-3.5 h-3.5" /> Not detected
        </span>
      )
    }
    return (
      <span className="text-xs text-slate-500">Cannot check from browser</span>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-1">Connect Local Agents</h2>
        <p className="text-slate-400 text-sm">
          Optional — detect AI tools installed on this machine. You can skip this step.
        </p>
      </div>

      <div className="space-y-3">
        {/* Claude Code */}
        <div className="bg-dark-bg border border-dark-border rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">🤖</span>
              <div>
                <p className="text-sm font-semibold text-slate-200">Claude Code CLI</p>
                <p className="text-xs text-slate-500">claude-code agent type</p>
              </div>
            </div>
            <StatusBadge status={state.claudeCode} />
          </div>
          {state.claudeCode !== 'available' && (
            <div className="pl-7">
              <code className="text-xs text-slate-400 bg-white/5 px-2 py-1 rounded font-mono">
                npm install -g @anthropic-ai/claude-code
              </code>
            </div>
          )}
        </div>

        {/* OpenAI Codex CLI */}
        <div className="bg-dark-bg border border-dark-border rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">⚡</span>
              <div>
                <p className="text-sm font-semibold text-slate-200">OpenAI Codex CLI</p>
                <p className="text-xs text-slate-500">openai-codex agent type</p>
              </div>
            </div>
            <StatusBadge status={state.codex} />
          </div>
          {state.codex !== 'available' && (
            <div className="pl-7">
              <code className="text-xs text-slate-400 bg-white/5 px-2 py-1 rounded font-mono">
                npm install -g @openai/codex
              </code>
            </div>
          )}
        </div>

        {/* OpenClaw */}
        <div className="bg-dark-bg border border-dark-border rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">🦞</span>
              <div>
                <p className="text-sm font-semibold text-slate-200">OpenClaw</p>
                <p className="text-xs text-slate-500">localhost:18789 — openclaw agent type</p>
              </div>
            </div>
            <StatusBadge status={state.openclaw} version={state.openclawVersion} />
          </div>
          {state.openclaw === 'not-found' && (
            <div className="pl-7">
              <p className="text-xs text-slate-500">
                Start OpenClaw or visit{' '}
                <a
                  href="https://docs.openclaw.ai"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-purple underline hover:text-purple-400"
                >
                  docs.openclaw.ai
                </a>
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-400 hover:text-slate-200 bg-white/5 hover:bg-white/10 border border-dark-border rounded-xl transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Back
        </button>
        <button
          onClick={checkAll}
          className="flex items-center gap-1.5 px-4 py-2.5 text-sm text-slate-400 hover:text-slate-200 bg-white/5 hover:bg-white/10 border border-dark-border rounded-xl transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Check Again
        </button>
        <button
          onClick={onNext}
          className="flex-1 flex items-center justify-center gap-2 px-6 py-2.5 bg-accent-purple hover:bg-purple-600 text-white text-sm font-medium rounded-xl transition-colors"
        >
          Continue
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

// ─── Step 4: First Agent ──────────────────────────────────────────────────────

interface AgentTypeOption {
  type: AgentType
  icon: React.ReactNode
  label: string
  desc: string
  color: string
}

const AGENT_TYPES: AgentTypeOption[] = [
  {
    type: 'http',
    icon: <Globe className="w-5 h-5" />,
    label: 'HTTP Agent',
    desc: 'Call any web endpoint',
    color: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  },
  {
    type: 'claude',
    icon: <Bot className="w-5 h-5" />,
    label: 'Claude Agent',
    desc: 'Use Anthropic Claude',
    color: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
  },
  {
    type: 'openai',
    icon: <Zap className="w-5 h-5" />,
    label: 'OpenAI Agent',
    desc: 'Use OpenAI GPT',
    color: 'text-green-400 bg-green-500/10 border-green-500/20',
  },
  {
    type: 'bash',
    icon: <Terminal className="w-5 h-5" />,
    label: 'Bash Agent',
    desc: 'Run shell commands',
    color: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  },
]

// Preset card for the first agent step
function PresetCard({
  preset,
  onSelect,
}: {
  preset: AgentPreset
  onSelect: (p: AgentPreset) => void
}) {
  return (
    <button
      onClick={() => onSelect(preset)}
      className="flex items-start gap-3 p-3 rounded-xl border border-dark-border bg-dark-bg hover:border-accent-purple/60 hover:bg-accent-purple/5 transition-all text-left w-full"
    >
      <span className="text-xl leading-none mt-0.5 shrink-0">{preset.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-200 truncate">{preset.name}</p>
        <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{preset.description}</p>
      </div>
    </button>
  )
}

function StepFirstAgent({
  onNext,
  onBack,
}: {
  onNext: () => void
  onBack: () => void
}) {
  const [selectedType, setSelectedType] = useState<AgentType | null>(null)
  const [agentName, setAgentName] = useState('')
  const [agentDesc, setAgentDesc] = useState('')
  const [agentConfig, setAgentConfig] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [view, setView] = useState<'presets' | 'manual'>('presets')
  const [searchPreset, setSearchPreset] = useState('')

  const { data: presetsData } = (useState(() => null) as any) // placeholder — fetch below
  const [presets, setPresets] = useState<AgentPreset[]>([])

  useEffect(() => {
    getPresets()
      .then((d) => setPresets(d.data || []))
      .catch(() => {})
  }, [])

  const filteredPresets = presets.filter(
    (p) =>
      !searchPreset ||
      p.name.toLowerCase().includes(searchPreset.toLowerCase()) ||
      p.description.toLowerCase().includes(searchPreset.toLowerCase())
  )

  const defaultConfig: Record<AgentType, string> = {
    http: JSON.stringify({ endpoint: 'https://api.example.com/webhook', timeout: 30000 }, null, 2),
    claude: JSON.stringify({ model: 'claude-sonnet-4-6', systemPrompt: 'You are a helpful assistant.', max_tokens: 4096 }, null, 2),
    openai: JSON.stringify({ model: 'gpt-4o', systemPrompt: 'You are a helpful assistant.', max_tokens: 4096 }, null, 2),
    bash: JSON.stringify({ command: 'echo "Hello from agent!"', timeout: 30000 }, null, 2),
  }

  const handleSelectType = (type: AgentType) => {
    setSelectedType(type)
    setAgentConfig(defaultConfig[type])
    setError('')
  }

  const handleSelectPreset = (preset: AgentPreset) => {
    setAgentName(preset.name)
    setAgentDesc(preset.description)
    setAgentConfig(JSON.stringify(preset.defaultConfig, null, 2))
    // Map preset type to AgentType for config display (may not be a core type)
    const coreTypes: AgentType[] = ['http', 'claude', 'openai', 'bash']
    setSelectedType(coreTypes.includes(preset.type as any) ? (preset.type as AgentType) : null)
    setView('manual')
    setError('')
  }

  const handleCreate = async () => {
    if (!agentName.trim()) return
    setCreating(true)
    setError('')
    try {
      let config: Record<string, unknown> = {}
      try {
        config = JSON.parse(agentConfig)
      } catch {
        setError('Invalid JSON in configuration field')
        setCreating(false)
        return
      }
      await createAgent({
        name: agentName.trim(),
        description: agentDesc.trim() || undefined,
        type: (selectedType || 'claude') as any,
        config,
        status: 'active',
      })
      onNext()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create agent')
    }
    setCreating(false)
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-2xl font-bold text-white mb-1">Create your first agent</h2>
        <p className="text-slate-400 text-sm">
          Choose from a preset or configure manually. You can always create more later.
        </p>
      </div>

      {/* View toggle */}
      <div className="flex gap-1 p-1 bg-dark-bg border border-dark-border rounded-xl">
        {(['presets', 'manual'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              view === v
                ? 'bg-accent-purple text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {v === 'presets' ? '⚡ From Preset' : '⚙️ Manual Setup'}
          </button>
        ))}
      </div>

      {view === 'presets' ? (
        <>
          <div className="relative">
            <input
              type="text"
              value={searchPreset}
              onChange={(e) => setSearchPreset(e.target.value)}
              placeholder="Search presets..."
              className="w-full bg-dark-bg border border-dark-border rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent-purple transition-colors"
            />
          </div>
          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {filteredPresets.length === 0 ? (
              <p className="text-center text-xs text-slate-500 py-4">No presets found</p>
            ) : (
              filteredPresets.map((p) => (
                <PresetCard key={p.id} preset={p} onSelect={handleSelectPreset} />
              ))
            )}
          </div>
        </>
      ) : (
        <>
          {/* Type selection */}
          <div className="grid grid-cols-2 gap-3">
            {AGENT_TYPES.map((opt) => (
              <button
                key={opt.type}
                onClick={() => handleSelectType(opt.type)}
                className={`flex items-start gap-3 p-3 rounded-xl border transition-all text-left ${
                  selectedType === opt.type
                    ? 'border-accent-purple bg-accent-purple/10'
                    : 'border-dark-border bg-dark-bg hover:border-dark-border/80 hover:bg-white/5'
                }`}
              >
                <div className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${opt.color}`}>
                  {opt.icon}
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-200">{opt.label}</p>
                  <p className="text-xs text-slate-500">{opt.desc}</p>
                </div>
              </button>
            ))}
          </div>

          {/* Mini-form */}
          <div className="bg-dark-bg border border-dark-border rounded-xl p-4 space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                Agent Name *
              </label>
              <input
                type="text"
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                placeholder={`My ${selectedType || 'claude'} agent`}
                className="w-full bg-dark-card border border-dark-border rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent-purple transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                Description
              </label>
              <input
                type="text"
                value={agentDesc}
                onChange={(e) => setAgentDesc(e.target.value)}
                placeholder="Optional description..."
                className="w-full bg-dark-card border border-dark-border rounded-lg px-3 py-2.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-accent-purple transition-colors"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5">
                Configuration (JSON)
              </label>
              <textarea
                value={agentConfig}
                onChange={(e) => setAgentConfig(e.target.value)}
                rows={4}
                spellCheck={false}
                className="w-full bg-dark-card border border-dark-border rounded-lg px-3 py-2.5 text-xs text-slate-300 font-mono placeholder-slate-600 focus:outline-none focus:border-accent-purple transition-colors resize-none"
              />
            </div>
            {error && (
              <div className="flex items-center gap-2 text-xs text-red-400">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {error}
              </div>
            )}
          </div>
        </>
      )}

      <div className="flex gap-3">
        <button
          onClick={onBack}
          className="flex items-center gap-2 px-4 py-2.5 text-sm text-slate-400 hover:text-slate-200 bg-white/5 hover:bg-white/10 border border-dark-border rounded-xl transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Back
        </button>
        <button
          onClick={onNext}
          className="px-4 py-2.5 text-sm text-slate-400 hover:text-slate-200 bg-white/5 hover:bg-white/10 border border-dark-border rounded-xl transition-colors"
        >
          Skip
        </button>
        {view === 'manual' && (
          <button
            onClick={handleCreate}
            disabled={!agentName.trim() || creating}
            className="flex-1 flex items-center justify-center gap-2 px-6 py-2.5 bg-accent-purple hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-colors"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Create Agent
          </button>
        )}
        {view === 'presets' && (
          <button
            onClick={onNext}
            className="flex-1 flex items-center justify-center gap-2 px-6 py-2.5 bg-accent-purple hover:bg-purple-600 text-white text-sm font-medium rounded-xl transition-colors"
          >
            Continue
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Step 5: Done ─────────────────────────────────────────────────────────────

function StepDone({
  status,
  onFinish,
}: {
  status: SetupStatus | null
  onFinish: () => void
}) {
  const configured: string[] = []
  if (status?.steps.apiKeys) configured.push('AI providers configured')
  if (status?.steps.telegram) configured.push('Telegram bot connected')
  if (status?.steps.firstAgent) configured.push('First agent created')

  return (
    <div className="text-center space-y-6">
      {/* Success animation */}
      <div className="flex justify-center">
        <div className="relative">
          <div className="w-20 h-20 rounded-full bg-green-500/20 border-2 border-green-500/40 flex items-center justify-center animate-pulse-slow">
            <div className="w-14 h-14 rounded-full bg-green-500/30 flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-green-400" />
            </div>
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-3xl font-bold text-white mb-2">AgentHub is ready!</h2>
        <p className="text-slate-400">
          Your setup is complete. Time to build something great.
        </p>
      </div>

      {configured.length > 0 && (
        <div className="bg-dark-bg border border-dark-border rounded-xl p-4 text-left space-y-2">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
            What was configured
          </p>
          {configured.map((item) => (
            <div key={item} className="flex items-center gap-2 text-sm text-slate-300">
              <Check className="w-4 h-4 text-green-400 shrink-0" />
              {item}
            </div>
          ))}
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <Check className="w-4 h-4 text-green-400 shrink-0" />
            {status?.dbMode === 'postgres' ? 'PostgreSQL' : 'SQLite'} database ready
          </div>
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <Check className="w-4 h-4 text-green-400 shrink-0" />
            {status?.schedulerMode === 'bullmq' ? 'BullMQ' : 'node-cron'} scheduler running
          </div>
        </div>
      )}

      <button
        onClick={onFinish}
        className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-accent-purple hover:bg-purple-600 text-white font-medium rounded-xl transition-colors shadow-lg shadow-accent-purple/25"
      >
        Open Dashboard
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  )
}

// ─── Main Setup Component ─────────────────────────────────────────────────────

const TOTAL_STEPS = 7 // 0=Welcome, 1=Security, 2=Providers, 3=Telegram, 3.5=LocalAgents, 4=FirstAgent, 5=Done

export default function Setup() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [direction, setDirection] = useState<'forward' | 'back'>('forward')
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [loading, setLoading] = useState(true)

  // Check setup status on mount
  useEffect(() => {
    ;(async () => {
      try {
        const s = await getSetupStatus()
        setStatus(s)
        if (s.complete) {
          navigate('/', { replace: true })
        }
      } catch {
        // If setup endpoint is unavailable, just show the wizard
      } finally {
        setLoading(false)
      }
    })()
  }, [navigate])

  const goNext = useCallback(() => {
    setDirection('forward')
    setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1))
    // Refresh status for the Done screen
    if (step === TOTAL_STEPS - 2) {
      getSetupStatus().then(setStatus).catch(() => {})
    }
  }, [step])

  const goBack = useCallback(() => {
    setDirection('back')
    setStep((s) => Math.max(s - 1, 0))
  }, [])

  const handleFinish = async () => {
    try {
      await completeSetup()
    } catch {
      // Don't block navigation if this fails
    }
    navigate('/', { replace: true })
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-dark-bg flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-accent-purple" />
      </div>
    )
  }

  const steps = [
    <StepWelcome key={0} status={status} onNext={goNext} />,
    <StepSecurity key={1} onNext={goNext} onBack={goBack} />,
    <StepProviders key={2} onNext={goNext} onBack={goBack} />,
    <StepTelegram key={3} onNext={goNext} onBack={goBack} />,
    <StepLocalAgents key={4} onNext={goNext} onBack={goBack} />,
    <StepFirstAgent key={5} onNext={goNext} onBack={goBack} />,
    <StepDone key={6} status={status} onFinish={handleFinish} />,
  ]

  return (
    <div className="min-h-screen bg-dark-bg flex items-center justify-center p-4">
      {/* Subtle background glow */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-accent-purple/5 rounded-full blur-3xl" />
      </div>

      <div className="w-full max-w-[560px] relative">
        {/* Card */}
        <div className="bg-dark-card border border-dark-border rounded-2xl shadow-2xl shadow-black/50 p-8">
          {/* Progress bar (hidden on welcome and done) */}
          {step > 0 && step < TOTAL_STEPS - 1 && (
            <ProgressBar current={step} total={TOTAL_STEPS - 1} />
          )}

          {/* Step content with slide transition */}
          <div
            key={step}
            style={{
              animation: `${direction === 'forward' ? 'slideInRight' : 'slideInLeft'} 0.2s ease-out`,
            }}
          >
            {steps[step]}
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-slate-600 mt-4">
          AgentHub v1.0.0 · Powered by Claude
        </p>
      </div>

      <style>{`
        @keyframes slideInRight {
          from { opacity: 0; transform: translateX(20px); }
          to   { opacity: 1; transform: translateX(0); }
        }
        @keyframes slideInLeft {
          from { opacity: 0; transform: translateX(-20px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  )
}
